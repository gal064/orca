import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectTerminalModePanelScopeForWorkspace } from '@/store/slices/terminal-mode-panels'
import type { RuntimeFileOperationArgs } from './runtime-file-client'

/**
 * Remote-runtime file routing for terminal mode.
 *
 * A remote workspace's files are addressed by a path relative to the workspace
 * root, but the explorer is rooted at the shell's pwd — so the base the caller
 * passes must stay the *workspace* root even while the tree is showing a
 * subdirectory, or the host resolves the wrong directory and silently returns the
 * wrong listing. When the pwd escapes the workspace root entirely and the host
 * advertises `terminal-mode.absolute-path-scope.v1`, the path is sent absolute
 * instead; otherwise the root was clamped and the relative contract still holds.
 *
 * Returns nothing in classic mode and for a workspace terminal mode does not own,
 * so no existing call path changes. Local and SSH routes ignore both fields:
 * their file APIs already take absolute paths.
 */
export function terminalModeFileScopeArgs(
  worktreeId: string | null | undefined,
  state: Pick<AppState, 'terminalModePanelScope'> = useAppStore.getState()
): Partial<Pick<RuntimeFileOperationArgs, 'worktreePath' | 'absolutePathScope'>> {
  const scope = selectTerminalModePanelScopeForWorkspace(state, worktreeId)
  if (!scope) {
    return {}
  }
  return scope.addressing === 'absolute'
    ? { worktreePath: scope.workspaceRoot, absolutePathScope: true }
    : { worktreePath: scope.workspaceRoot }
}

/**
 * Directory a terminal-mode watch should follow on a remote host, or `undefined`
 * when the relative contract still holds (classic mode, a workspace terminal mode
 * does not own, or a pwd inside the workspace root, which the selector already
 * covers). `files.watch` watches the selector's workspace root without it, so
 * sending it is the only way a remote tab sees changes under a pwd outside.
 */
export function terminalModeAbsoluteWatchPath(
  worktreeId: string | null | undefined,
  watchPath: string | null | undefined,
  state: Pick<AppState, 'terminalModePanelScope'> = useAppStore.getState()
): string | undefined {
  const scope = selectTerminalModePanelScopeForWorkspace(state, worktreeId)
  return scope?.addressing === 'absolute' && watchPath ? watchPath : undefined
}
