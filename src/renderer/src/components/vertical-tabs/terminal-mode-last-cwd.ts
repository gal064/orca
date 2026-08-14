import type { AppState } from '@/store/types'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { resolveTabTerminalPtyId, type TerminalCwdSource } from '@/store/slices/terminal-cwd'

/** A tab whose tracked directory has moved away from the one persisted on it. */
export type TerminalTabLastCwdCandidate = {
  workspaceKey: string
  tabId: string
  ptyId: string
  /** Directory the tracker believes the tab is in — the *trigger*, not
   *  necessarily the value persisted: an OSC 7 path is corroborated first. */
  trackedCwd: string
  source: TerminalCwdSource
}

type LastCwdState = Pick<
  AppState,
  'cwdByPtyId' | 'ptyIdsByTabId' | 'tabsByWorktree' | 'terminalLayoutsByTabId'
>

/**
 * Tabs whose last-known pwd is worth re-persisting (terminal-mode-spec.md §4:
 * "local shells restart in last-known pwd").
 *
 * Vertical tabs only — `terminalModeWorkspaceKeys` comes from the catalog choke
 * point, so a classic workspace never gains a restored pwd even while the flag
 * is on.
 *
 * Local PTYs only, deliberately (see the design doc's Phase 7 notes):
 * - a **remote-runtime** tab restarts by reattaching to the live host session,
 *   which already holds the real directory;
 * - an **SSH** tab could be corroborated over the relay, but the spawn side has
 *   no missing-directory fallback there — a directory deleted between sessions
 *   would fail every retry with nothing to clear the field.
 */
export function collectTerminalTabLastCwdCandidates(
  state: LastCwdState,
  terminalModeWorkspaceKeys: ReadonlySet<string>
): TerminalTabLastCwdCandidate[] {
  const candidates: TerminalTabLastCwdCandidate[] = []
  for (const workspaceKey of terminalModeWorkspaceKeys) {
    for (const tab of state.tabsByWorktree[workspaceKey] ?? []) {
      const ptyId = resolveTabTerminalPtyId(state, tab.id)
      if (!ptyId || isRemoteRuntimePtyId(ptyId) || parseAppSshPtyId(ptyId) !== null) {
        continue
      }
      const entry = state.cwdByPtyId[ptyId]
      if (!entry || entry.cwd === tab.lastCwd) {
        continue
      }
      candidates.push({
        workspaceKey,
        tabId: tab.id,
        ptyId,
        trackedCwd: entry.cwd,
        source: entry.source
      })
    }
  }
  return candidates
}

/** Debounce key: the values that would be written, so unrelated store churn
 *  (agent status, output ticks) cannot keep resetting the timer. Empty for an
 *  empty list, so the caller's "nothing to do" short-circuit really short-circuits. */
export function terminalTabLastCwdKey(candidates: readonly TerminalTabLastCwdCandidate[]): string {
  return candidates.length === 0
    ? ''
    : JSON.stringify(candidates.map((c) => [c.workspaceKey, c.tabId, c.trackedCwd]))
}
