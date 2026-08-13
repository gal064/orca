import React, { useCallback } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import VerticalTabRow from './VerticalTabRow'
import { useActiveVerticalTabId, useVerticalTabs } from './use-vertical-tabs'
import { useActiveVerticalTabPwd } from './use-active-vertical-tab-pwd'

/**
 * Terminal-mode left sidebar: the vertical tab strip (docs/terminal-mode-design.md
 * Phase 1). Mounted only while the sidebar is open — anything that must survive a
 * collapsed sidebar lives in TerminalModeSidebarHost instead.
 */
function VerticalTabsSidebar(): React.JSX.Element {
  // Why: this memo boundary needs its own language subscription — the persisted
  // locale lands after boot, and nothing else re-renders this subtree.
  useTranslation()
  const tabs = useVerticalTabs()
  const activeTabId = useActiveVerticalTabId()
  // Working directory the panels follow (Phase 3); shown here so the strip
  // states which terminal directory is in scope.
  const activePwd = useActiveVerticalTabPwd()
  const createVerticalTab = useAppStore((s) => s.createVerticalTab)
  const activateVerticalTab = useAppStore((s) => s.activateVerticalTab)
  const renameVerticalTab = useAppStore((s) => s.renameVerticalTab)
  const requestVerticalTabClose = useAppStore((s) => s.requestVerticalTabClose)

  const handleCreate = useCallback(() => {
    void createVerticalTab()
  }, [createVerticalTab])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="vertical-tabs-sidebar">
      <div className="mt-2 flex h-8 shrink-0 items-center justify-between gap-2 px-2">
        <span className="pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80 select-none">
          {translate('auto.components.verticalTabs.VerticalTabsSidebar.title', 'Terminals')}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={translate(
                'auto.components.verticalTabs.VerticalTabsSidebar.newTab',
                'New terminal tab'
              )}
              data-testid="vertical-tabs-new-tab"
              onClick={handleCreate}
            >
              <Plus className="size-3.5" strokeWidth={2.25} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate(
              'auto.components.verticalTabs.VerticalTabsSidebar.newTab',
              'New terminal tab'
            )}
          </TooltipContent>
        </Tooltip>
      </div>

      {activePwd ? (
        <div
          className="truncate px-4 pb-1 text-[11px] text-muted-foreground select-none"
          data-testid="vtab-active-pwd"
          title={activePwd}
        >
          {activePwd}
        </div>
      ) : null}

      <div
        className="worktree-sidebar-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1"
        data-testid="vertical-tabs-list"
      >
        {tabs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {translate(
              'auto.components.verticalTabs.VerticalTabsSidebar.empty',
              'No terminal tabs'
            )}
          </p>
        ) : (
          tabs.map((tab) => (
            <VerticalTabRow
              key={tab.id}
              id={tab.id}
              name={tab.name}
              folderPath={tab.folderPath}
              active={tab.id === activeTabId}
              onActivate={activateVerticalTab}
              onRename={renameVerticalTab}
              onRequestClose={requestVerticalTabClose}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default React.memo(VerticalTabsSidebar)
