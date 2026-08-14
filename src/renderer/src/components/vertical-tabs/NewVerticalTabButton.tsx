import React, { useCallback } from 'react'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { useTerminalModeHostOptions } from './use-terminal-mode-host-options'

/**
 * The "+" split button (docs/terminal-mode-spec.md §2, "New vtab"): clicking it
 * creates a tab on the focused terminal's host — falling back to the configured
 * default and then local — while the chevron pins the tab to a host explicitly.
 *
 * The dropdown is rendered only when more than one host exists, so a
 * single-machine user sees the plain button Phase 1 shipped.
 */
function NewVerticalTabButton(): React.JSX.Element {
  const createVerticalTab = useAppStore((s) => s.createVerticalTab)
  const hosts = useTerminalModeHostOptions()
  // Why the store and not local state: creating on a disconnected SSH host connects it
  // first, which can take a relay deploy or a passphrase prompt (Phase 6, item 0a), and
  // Cmd+T and the empty-state button start the same wait from outside this component.
  const creating = useAppStore((s) => s.verticalTabCreatesInFlight > 0)

  const handleCreate = useCallback(() => {
    void createVerticalTab()
  }, [createVerticalTab])
  const handleCreateOnHost = useCallback(
    (hostId: ExecutionHostId) => {
      void createVerticalTab({ hostId })
    },
    [createVerticalTab]
  )

  const newTabLabel = translate(
    'auto.components.verticalTabs.VerticalTabsSidebar.newTab',
    'New terminal tab'
  )
  const creatingLabel = translate(
    'auto.components.verticalTabs.NewVerticalTabButton.creating',
    'Opening terminal tab…'
  )

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={creating ? creatingLabel : newTabLabel}
            aria-busy={creating}
            disabled={creating}
            data-testid="vertical-tabs-new-tab"
            data-creating={creating ? 'true' : undefined}
            onClick={handleCreate}
          >
            {creating ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
            ) : (
              <Plus className="size-3.5" strokeWidth={2.25} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {creating ? creatingLabel : newTabLabel}
        </TooltipContent>
      </Tooltip>
      {hosts.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-4 text-muted-foreground"
              disabled={creating}
              aria-label={translate(
                'auto.components.verticalTabs.NewVerticalTabButton.chooseHost',
                'New terminal tab on…'
              )}
              data-testid="vertical-tabs-new-tab-host"
            >
              <ChevronDown className="size-3" strokeWidth={2.25} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {translate(
                'auto.components.verticalTabs.NewVerticalTabButton.chooseHost',
                'New terminal tab on…'
              )}
            </DropdownMenuLabel>
            {hosts.map((host) => (
              <DropdownMenuItem
                key={host.id}
                disabled={!host.supported}
                data-testid="vertical-tabs-new-tab-host-option"
                data-host-id={host.id}
                onSelect={() => handleCreateOnHost(host.id)}
              >
                <span className="truncate">{host.label}</span>
                <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
                  {host.supported
                    ? host.detail
                    : translate(
                        'auto.components.verticalTabs.NewVerticalTabButton.hostNeedsUpdate',
                        'Server update needed'
                      )}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

export default React.memo(NewVerticalTabButton)
