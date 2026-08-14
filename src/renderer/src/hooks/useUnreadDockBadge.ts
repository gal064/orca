import { useEffect } from 'react'
import { getUnreadBadgeCount } from '@/lib/unread-badge-count'
import { useAppStore } from '@/store'
import { isTerminalMode } from '@/lib/terminal-mode'
import { selectClassicFolderWorkspaces } from '@/store/classic-workspace-catalog'

function setUnreadDockBadgeCountBestEffort(count: number): void {
  void window.api.app.setUnreadDockBadgeCount(count).catch(() => {
    // Dock sync is best-effort chrome; stale badge state should not affect app use.
  })
}

export function clearUnreadDockBadgeCount(): void {
  setUnreadDockBadgeCountBestEffort(0)
}

export function useUnreadDockBadge(): typeof clearUnreadDockBadgeCount {
  const unreadCount = useAppStore((state) =>
    getUnreadBadgeCount({
      worktreesByRepo: state.worktreesByRepo,
      // Why the mode branch: an unread vertical tab is only reachable — and only
      // clearable — in terminal mode. Counting one with the flag off produces a Dock
      // badge no surface can render and no click can dismiss, and it survives restarts.
      folderWorkspaces: isTerminalMode(state.settings)
        ? state.folderWorkspaces
        : selectClassicFolderWorkspaces(state),
      tabsByWorktree: state.tabsByWorktree,
      unreadTerminalTabs: state.unreadTerminalTabs
    })
  )

  // oxlint-disable-next-line react-doctor/no-derived-state-effect -- Why: this syncs an external OS dock badge, not React render state.
  useEffect(() => {
    setUnreadDockBadgeCountBestEffort(unreadCount)
  }, [unreadCount])

  return clearUnreadDockBadgeCount
}
