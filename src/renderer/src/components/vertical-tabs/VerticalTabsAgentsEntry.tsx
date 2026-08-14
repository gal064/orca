import React from 'react'
import { useAppStore } from '@/store'
import { useActivityUnreadCount } from '@/components/activity/useActivityUnreadCount'
import SidebarAgentsButton from '@/components/sidebar/SidebarAgentsButton'
import { shouldShowAgentsButton } from '@/components/sidebar/agents-button-visibility'

/**
 * The notifications entry the terminal-mode sidebar owes the spec (§2, "Sidebar
 * contents"). `SidebarNav` — which carries the classic one — lives inside the
 * classic-only block, so terminal mode renders the shared button itself rather than
 * un-gating a nav full of surfaces this mode deliberately drops.
 *
 * Count, destination and *visibility* are the classic ones, so the two modes cannot
 * disagree about what "unread" means or about who has the Activity surface at all:
 * with `experimentalActivity` off the page cannot be opened, so a button here would
 * accrue a badge nothing can clear and do nothing when clicked.
 */
function VerticalTabsAgentsEntry(): React.JSX.Element | null {
  const openActivityPage = useAppStore((s) => s.openActivityPage)
  const activityActive = useAppStore((s) => s.activeView === 'activity')
  const showAgentsButton = useAppStore((s) => shouldShowAgentsButton(s.settings))
  const unreadCount = useActivityUnreadCount(showAgentsButton, 'sidebar-badge')

  if (!showAgentsButton) {
    return null
  }

  // Why the row wrapper lives here: hidden means hidden — the strip must not keep
  // the entry's padding when the flag is off.
  return (
    <div className="shrink-0 pb-2">
      <SidebarAgentsButton
        active={activityActive}
        unreadCount={unreadCount}
        onClick={openActivityPage}
        className="mx-2 w-auto"
        data-testid="vertical-tabs-agents-entry"
      />
    </div>
  )
}

export default React.memo(VerticalTabsAgentsEntry)
