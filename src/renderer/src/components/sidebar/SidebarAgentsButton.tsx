import React from 'react'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type SidebarAgentsButtonProps = {
  active: boolean
  unreadCount: number
  onClick: () => void
  className?: string
  'data-testid'?: string
}

/**
 * The Agents row, shared by the classic sidebar nav and the terminal-mode strip.
 *
 * Why shared rather than copied: the two surfaces have to agree on what "unread"
 * means, and the first copy of this button drifted immediately — its badge counted
 * worktrees only, so the row could not see a vertical tab.
 */
function SidebarAgentsButton({
  active,
  unreadCount,
  onClick,
  className,
  'data-testid': testId
}: SidebarAgentsButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8',
        className
      )}
    >
      <Bell
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">
        {translate('auto.components.sidebar.SidebarNav.9c95e1ce91', 'Agents')}
      </span>
      {unreadCount > 0 ? (
        <span
          className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground"
          data-testid={testId ? `${testId}-unread` : undefined}
        >
          {unreadCount}
        </span>
      ) : null}
    </button>
  )
}

export default React.memo(SidebarAgentsButton)
