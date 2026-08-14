import React, { useCallback } from 'react'
import { X } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import { WorktreeTitleInlineRename } from '@/components/sidebar/WorktreeTitleInlineRename'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type VerticalTabRowProps = {
  id: string
  name: string
  folderPath: string
  /** Non-local host this tab's terminals run on; absent for local tabs. */
  hostLabel?: string
  /** Rolled-up agent state for the tab (spec §2: status dots roll up to the vtab). */
  status: WorktreeStatus
  active: boolean
  onActivate: (id: string) => void
  onRename: (id: string, name: string) => void | Promise<void>
  onRequestClose: (id: string) => void
}

function VerticalTabRow({
  id,
  name,
  folderPath,
  hostLabel,
  status,
  active,
  onActivate,
  onRename,
  onRequestClose
}: VerticalTabRowProps): React.JSX.Element {
  const handleActivate = useCallback(() => onActivate(id), [id, onActivate])
  const handleRename = useCallback(
    (displayName: string) => onRename(id, displayName),
    [id, onRename]
  )
  const handleRequestClose = useCallback(() => onRequestClose(id), [id, onRequestClose])
  const handleCloseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      onRequestClose(id)
    },
    [id, onRequestClose]
  )
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Why target check: the inline rename input lives inside this row and owns its own keys.
      if (event.target !== event.currentTarget) {
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate(id)
      }
    },
    [id, onActivate]
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group/vtab flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
            active
              ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
              : 'text-foreground/80 hover:bg-worktree-sidebar-accent/60'
          )}
          data-testid="vertical-tab-row"
          data-vertical-tab-id={id}
          data-current={active ? 'true' : undefined}
          title={folderPath}
          role="button"
          tabIndex={0}
          aria-current={active ? 'true' : undefined}
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
        >
          <StatusIndicator status={status} aria-hidden="true" />
          <WorktreeTitleInlineRename
            className="flex-1 text-[13px]"
            displayName={name}
            onRename={handleRename}
          />
          {hostLabel ? (
            <span
              className="max-w-20 shrink-0 truncate rounded-sm bg-muted px-1 text-[10px] leading-4 text-muted-foreground"
              data-testid="vertical-tab-host-badge"
              title={hostLabel}
            >
              {hostLabel}
            </span>
          ) : null}
          <button
            type="button"
            aria-label={translate(
              'auto.components.verticalTabs.VerticalTabRow.close',
              'Close terminal tab'
            )}
            data-testid="vertical-tab-close"
            className="hidden size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring group-hover/vtab:flex"
            onClick={handleCloseClick}
          >
            <X className="size-3" strokeWidth={2.25} />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onSelect={handleRequestClose}>
          {translate('auto.components.verticalTabs.VerticalTabRow.close', 'Close terminal tab')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default React.memo(VerticalTabRow)
