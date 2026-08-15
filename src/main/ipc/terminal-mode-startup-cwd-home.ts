import { homedir } from 'node:os'
import { isTerminalModeGroup } from '../../shared/terminal-mode-group'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import type { FolderWorkspace, ProjectGroup } from '../../shared/types'

type TerminalModeWorkspaceStore = {
  getFolderWorkspace?: (id: string) => FolderWorkspace | undefined
  getProjectGroups?: () => ProjectGroup[]
}

/**
 * Last resort for a startup cwd nothing else can recover. Every other workspace
 * has a usable root to land in; a terminal-mode vertical tab's root *is* the
 * start folder that just failed, so without this it spawns into a directory the
 * shell cannot enter and dies with no explanation (docs/terminal-mode-spec.md §4).
 * Scoped to vertical tabs so a classic worktree on an unmounted volume keeps
 * surfacing the provider's own error instead of silently opening `$HOME`.
 */
export function resolveTerminalModeStartupCwdHome(
  store: TerminalModeWorkspaceStore | undefined,
  worktreeId: string | undefined
): string | undefined {
  const scope = typeof worktreeId === 'string' ? parseWorkspaceKey(worktreeId) : null
  if (!store || scope?.type !== 'folder') {
    return undefined
  }
  const workspace = store.getFolderWorkspace?.(scope.folderWorkspaceId)
  if (!workspace) {
    return undefined
  }
  const group = store
    .getProjectGroups?.()
    .find((candidate) => candidate.id === workspace.projectGroupId)
  return isTerminalModeGroup(group) ? homedir() || undefined : undefined
}
