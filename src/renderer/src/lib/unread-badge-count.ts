import type { FolderWorkspace, TerminalTab, Worktree } from '../../../shared/types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'

export function getUnreadBadgeCount({
  worktreesByRepo,
  folderWorkspaces,
  tabsByWorktree,
  unreadTerminalTabs
}: {
  worktreesByRepo: Record<string, Worktree[]>
  /** Folder workspaces carry their own `isUnread`, and a terminal-mode vertical tab is one.
   *  Required, not optional: omitting it would silently ignore every vertical tab, and the
   *  answer differs by mode — pass `selectBadgeCountableFolderWorkspaces`, which decides
   *  which workspaces the user can actually reach and clear. */
  folderWorkspaces: readonly FolderWorkspace[]
  tabsByWorktree: Record<string, TerminalTab[]>
  unreadTerminalTabs: Record<string, true>
}): number {
  const unreadWorktreeIds = new Set<string>()

  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (worktree.isUnread) {
        unreadWorktreeIds.add(worktree.id)
      }
    }
  }
  for (const workspace of folderWorkspaces) {
    if (workspace.isUnread) {
      // The same key `tabsByWorktree` uses, so a workspace counted here is never
      // double-counted by the tab sweep below.
      unreadWorktreeIds.add(folderWorkspaceKey(workspace.id))
    }
  }

  const unreadTabIds = new Set(Object.keys(unreadTerminalTabs))
  if (unreadTabIds.size === 0) {
    return unreadWorktreeIds.size
  }

  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      if (!unreadTabIds.delete(tab.id)) {
        continue
      }
      unreadWorktreeIds.add(worktreeId)
    }
  }

  // Why: tab unread state should normally map to a live worktree, but counting
  // unmatched entries keeps the Dock badge honest during hydration races.
  return unreadWorktreeIds.size + unreadTabIds.size
}
