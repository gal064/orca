import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import { selectTerminalModeWorkspaceKeys } from '@/store/terminal-mode-workspace-keys'
import {
  collectTerminalTabLastCwdCandidates,
  terminalTabLastCwdKey,
  type TerminalTabLastCwdCandidate
} from './terminal-mode-last-cwd'

/** Must stay longer than main's per-pid `getCwd` cache (`CACHE_TTL_MS`, 1500 ms
 *  in `main/providers/process-cwd.ts`) — inside that window a concurrent reader's
 *  pre-`cd` result is served instead. Do not lower below 2 s. */
export const LAST_CWD_PERSIST_DEBOUNCE_MS = 2500

/** Forget markers for PTYs that no longer exist — ids are reused across shell
 *  incarnations, and this keeps the map bounded by the live terminals. */
function pruneRetiredMarkers(
  marked: Map<string, string>,
  ptyIdsByTabId: Record<string, readonly string[] | undefined>
): void {
  const live = new Set<string>()
  for (const ptyIds of Object.values(ptyIdsByTabId)) {
    for (const ptyId of ptyIds ?? []) {
      live.add(ptyId)
    }
  }
  for (const ptyId of marked.keys()) {
    if (!live.has(ptyId)) {
      marked.delete(ptyId)
    }
  }
}

/** The directory **main** reads for this shell, not the OSC 7 path it reported:
 *  a shell inside `ssh`/`docker`/`tmux` reports the remote one (Phase 2's
 *  foreign-OSC 7 gap). A poll-sourced value already came from this call. */
async function corroborateCwd(candidate: TerminalTabLastCwdCandidate): Promise<string | null> {
  if (candidate.source === 'poll') {
    return usableCwd(candidate.trackedCwd)
  }
  try {
    return usableCwd((await window.api?.pty?.getCwd?.(candidate.ptyId)) ?? '')
  } catch {
    return null
  }
}

/** Linux's `/proc/<pid>/cwd` link resolves to `"<path> (deleted)"` for a shell
 *  whose directory was removed under it — a path that can never be reopened. */
function usableCwd(cwd: string): string | null {
  const trimmed = cwd.trim()
  return !trimmed || trimmed.endsWith(' (deleted)') ? null : trimmed
}

/**
 * Persists each vertical tab's last-known pwd onto its durable tab record so a
 * restarted shell reopens there (terminal-mode-spec.md §4). Mounted by
 * TerminalModeSidebarHost, so classic mode installs none of it; the write goes
 * to the store, which the existing session writer already batches to disk.
 *
 * Why it probes where `useTerminalCwdTracking` also does — and the rest of the
 * design — is in the design doc's Phase 7 notes.
 */
export function useTerminalModeLastCwdPersistence(): void {
  const recordTerminalTabLastCwd = useAppStore((s) => s.recordTerminalTabLastCwd)
  const cwdByPtyId = useAppStore((s) => s.cwdByPtyId)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const terminalModeWorkspaceKeys = useAppStore(selectTerminalModeWorkspaceKeys)

  const candidates = useMemo(
    () =>
      collectTerminalTabLastCwdCandidates(
        { cwdByPtyId, tabsByWorktree, ptyIdsByTabId, terminalLayoutsByTabId },
        terminalModeWorkspaceKeys
      ),
    [cwdByPtyId, ptyIdsByTabId, tabsByWorktree, terminalLayoutsByTabId, terminalModeWorkspaceKeys]
  )
  const pendingKey = terminalTabLastCwdKey(candidates)
  const pendingRef = useRef(candidates)
  useEffect(() => {
    pendingRef.current = candidates
  }, [candidates])

  // Why marked: a corroborated directory can legitimately differ from the
  // tracked one (a symlinked pwd resolves to its physical path), which would
  // otherwise leave the candidate standing and re-probe it every window.
  const corroboratedRef = useRef(new Map<string, string>())
  // Separate from the marker: this is the double-probe guard for the window
  // where a probe is in flight and a second run reaches the same PTY.
  const inFlightRef = useRef(new Set<string>())

  useEffect(() => {
    if (!pendingKey) {
      return
    }
    const timer = setTimeout(() => {
      const marked = corroboratedRef.current
      const inFlight = inFlightRef.current
      pruneRetiredMarkers(marked, useAppStore.getState().ptyIdsByTabId)
      // Why parallel: the probes are independent round trips, one per tab that
      // moved, and nothing downstream of them is ordered.
      void Promise.all(
        pendingRef.current.map(async (candidate) => {
          if (
            marked.get(candidate.ptyId) === candidate.trackedCwd ||
            inFlight.has(candidate.ptyId)
          ) {
            return
          }
          inFlight.add(candidate.ptyId)
          try {
            const cwd = await corroborateCwd(candidate)
            if (cwd) {
              // Marked only on an answer, so a failed probe is retried. Writing is
              // not gated on teardown: this very write tears the effect down.
              marked.set(candidate.ptyId, candidate.trackedCwd)
              recordTerminalTabLastCwd(candidate.workspaceKey, candidate.tabId, cwd)
            }
          } finally {
            inFlight.delete(candidate.ptyId)
          }
        })
      )
    }, LAST_CWD_PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values to
    // be written, not on the array identity that churns with every shell prompt.
  }, [pendingKey, recordTerminalTabLastCwd])
}
