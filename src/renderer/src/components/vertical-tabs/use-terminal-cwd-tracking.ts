import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { registerTerminalCwdFactObserver } from '@/components/terminal-pane/terminal-side-effect-facts-handler'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import type { AppState } from '@/store/types'
import { resolveWorkspaceTerminalPtyId } from '@/store/slices/terminal-cwd'

// Why past the main-side cache: getCwd coalesces per-pid for 1.5s and shells
// out to `lsof` on a macOS miss, so poll slower than that TTL. Same cadence the
// Checks panel uses for the same call.
export const TERMINAL_CWD_POLL_MS = 4000

type PollState = Pick<
  AppState,
  | 'activeWorkspaceKey'
  | 'activeTabIdByWorktree'
  | 'cwdByPtyId'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
>

/**
 * PTY the process-cwd fallback still has to poll: the active vertical tab's
 * focused terminal, while no OSC 7 has been observed for it. Remote-runtime
 * PTYs are excluded — their host reports cwd on `Metadata` frames, and
 * `window.api.pty.getCwd` would look for a local process that does not exist.
 * SSH PTYs are included: their `getCwd` resolves over the relay.
 */
export function selectTerminalCwdPollPtyId(state: PollState): string | null {
  const workspaceKey = state.activeWorkspaceKey
  if (!workspaceKey) {
    return null
  }
  const ptyId = resolveWorkspaceTerminalPtyId(state, workspaceKey)
  if (!ptyId || parseRemoteRuntimePtyId(ptyId) !== null) {
    return null
  }
  // Why not "has no cwd": a shell with no integration never emits OSC 7, so its
  // polled value has to keep refreshing. OSC 7 arriving retires the poll.
  return state.cwdByPtyId[ptyId]?.source === 'osc7' ? null : ptyId
}

/**
 * Feeds `cwdByPtyId` while terminal mode is active: OSC 7 facts for PTYs whose
 * bytes transit main (local + SSH) and a process-cwd poll for shells that report
 * nothing. Remote hosts arrive through the multiplexer's `onCwd` callback in
 * remote-runtime-pty-transport.ts instead — that is where a stream's PTY id is
 * known. Mounted by TerminalModeSidebarHost, so classic mode installs none of it.
 */
export function useTerminalCwdTracking(): void {
  const setPtyCwd = useAppStore((state) => state.setPtyCwd)
  const clearPtyCwd = useAppStore((state) => state.clearPtyCwd)

  useEffect(
    () =>
      registerTerminalCwdFactObserver((ptyId, cwd) => {
        setPtyCwd(ptyId, cwd, 'osc7')
      }),
    [setPtyCwd]
  )

  // Why: PTY ids are reused across incarnations, so a retained directory would
  // be shown for the shell that replaces this one.
  // Optional-chained so surfaces without the preload bridge (web client, tests)
  // degrade to "no invalidation" instead of throwing during mount.
  useEffect(() => window.api?.pty?.onExit?.(({ id }) => clearPtyCwd(id)), [clearPtyCwd])

  const pollPtyId = useAppStore(selectTerminalCwdPollPtyId)

  useEffect(() => {
    if (!pollPtyId) {
      return
    }
    let disposed = false
    const refresh = async (): Promise<void> => {
      try {
        const cwd = await window.api.pty.getCwd(pollPtyId)
        if (!disposed) {
          setPtyCwd(pollPtyId, cwd, 'poll')
        }
      } catch {
        // Best-effort: a PTY that just exited or a provider without cwd support
        // keeps the last known value rather than blanking the panels.
      }
    }
    // Gated on window visibility so a hidden window spawns no `lsof` probes.
    const stopInterval = installWindowVisibilityInterval({
      run: () => void refresh(),
      intervalMs: TERMINAL_CWD_POLL_MS
    })
    return () => {
      disposed = true
      stopInterval()
    }
  }, [pollPtyId, setPtyCwd])
}
