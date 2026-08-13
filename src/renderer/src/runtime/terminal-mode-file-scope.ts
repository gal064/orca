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
