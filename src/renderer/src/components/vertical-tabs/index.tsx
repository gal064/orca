import React from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Terminal-mode left sidebar. Phase 0 scaffold: the tab list and the "+" action
 *  arrive with the vertical-tabs store slice (docs/terminal-mode-design.md Phase 1). */
function VerticalTabsSidebar(): React.JSX.Element {
  // Why: this memo boundary needs its own language subscription — the persisted
  // locale lands after boot, and nothing else re-renders this subtree.
  useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="vertical-tabs-sidebar">
      <div className="mt-2 flex h-8 shrink-0 items-center justify-between gap-2 px-2">
        <span className="pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80 select-none">
          {translate('auto.components.verticalTabs.VerticalTabsSidebar.title', 'Terminals')}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Why: wrap in a span so the trigger still fires while the button is disabled. */}
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                // Disabled rather than a no-op click: nothing can be created until Phase 1.
                disabled
                // Why: the label carries the disabled reason too — a disabled
                // button's tooltip never reaches keyboard or screen-reader users.
                aria-label={translate(
                  'auto.components.verticalTabs.VerticalTabsSidebar.newTab',
                  'New terminal tab (under construction)'
                )}
                data-testid="vertical-tabs-new-tab"
              >
                <Plus className="size-3.5" strokeWidth={2.25} />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate(
              'auto.components.verticalTabs.VerticalTabsSidebar.newTab',
              'New terminal tab (under construction)'
            )}
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        className="worktree-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-1"
        data-testid="vertical-tabs-list"
      >
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {translate('auto.components.verticalTabs.VerticalTabsSidebar.empty', 'No terminal tabs')}
        </p>
      </div>
    </div>
  )
}

export default React.memo(VerticalTabsSidebar)
