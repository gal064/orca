import React from 'react'
import { useAppStore } from '@/store'
import { useActivityUnreadCount } from '@/components/activity/useActivityUnreadCount'
import SidebarAgentsButton from '@/components/sidebar/SidebarAgentsButton'

/**
 * The notifications entry the terminal-mode sidebar owes the spec (§2, "Sidebar
 * contents"). `SidebarNav` — which carries the classic one — lives inside the
 * classic-only block, so terminal mode renders the shared button itself rather than
 * un-gating a nav full of surfaces this mode deliberately drops.
 *
 * Count and destination are the classic ones, so the two modes cannot disagree about
 * what "unread" means.
 */
function VerticalTabsAgentsEntry(): React.JSX.Element {
  const openActivityPage = useAppStore((s) => s.openActivityPage)
  const activityActive = useAppStore((s) => s.activeView === 'activity')
  const unreadCount = useActivityUnreadCount(true, 'sidebar-badge')

  return (
    <SidebarAgentsButton
      active={activityActive}
      unreadCount={unreadCount}
      onClick={openActivityPage}
      className="mx-2 w-auto"
      data-testid="vertical-tabs-agents-entry"
    />
  )
}

export default React.memo(VerticalTabsAgentsEntry)
