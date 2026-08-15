import React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, TerminalSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { useShortcutKeyDetails, type ShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { TerminalModeMainPaneState } from '@/store/terminal-mode-empty-workspace'
import { useVerticalTabs } from './use-vertical-tabs'

type EmptyPaneMode = {
  shortcut: ShortcutKeyComboDetails | null
  body: string
  hint: string
  action: string
  run: () => unknown
}

/**
 * What the main pane shows in terminal mode where classic renders `Landing`: a
 * vertical tab whose shells have all exited (its last one died rather than being
 * closed — a user close deletes the tab), no vertical tab selected, or none at all.
 * Deliberately carries no project/worktree concepts.
 */
export default function TerminalModeEmptyPane({
  state
}: {
  state: TerminalModeMainPaneState
}): React.JSX.Element {
  useTranslation()
  const createVerticalTab = useAppStore((s) => s.createVerticalTab)
  const activateVerticalTab = useAppStore((s) => s.activateVerticalTab)
  const openNewTerminalTab = useAppStore((s) => s.openNewTerminalTabInActiveWorkspace)
  const lastVerticalTabId = useVerticalTabs().at(-1)?.id ?? null
  const creating = useAppStore((s) => s.verticalTabCreatesInFlight > 0)
  const newTerminalShortcut = useShortcutKeyDetails('tab.newTerminal')
  const newTabShortcut = useShortcutKeyDetails('workspace.create')

  // One decision, five uses: copy, chord, action label and handler all follow it.
  const mode: EmptyPaneMode =
    state.kind === 'empty-vertical-tab'
      ? {
          shortcut: newTerminalShortcut,
          body: translate(
            'auto.components.verticalTabs.TerminalModeEmptyPane.noTerminals',
            'No terminals in this tab.'
          ),
          hint: translate(
            'auto.components.verticalTabs.TerminalModeEmptyPane.openHint',
            'opens one here'
          ),
          action: translate(
            'auto.components.verticalTabs.TerminalModeEmptyPane.openAction',
            'Open terminal'
          ),
          // The canonical new-horizontal-tab funnel, which owns the pwd inheritance
          // and the web-runtime routing a remote vertical tab needs.
          run: () => openNewTerminalTab()
        }
      : state.kind === 'no-active-vertical-tab' && lastVerticalTabId
        ? {
            shortcut: null,
            body: translate(
              'auto.components.verticalTabs.TerminalModeEmptyPane.noSelection',
              'No terminal tab selected.'
            ),
            hint: '',
            action: translate(
              'auto.components.verticalTabs.TerminalModeEmptyPane.selectAction',
              'Open terminal tab'
            ),
            run: () => activateVerticalTab(lastVerticalTabId)
          }
        : {
            shortcut: newTabShortcut,
            body: translate(
              'auto.components.verticalTabs.TerminalModeEmptyPane.noTabs',
              'No terminal tabs.'
            ),
            hint: translate(
              'auto.components.verticalTabs.TerminalModeEmptyPane.createHint',
              'opens a terminal tab'
            ),
            action: translate(
              'auto.components.verticalTabs.TerminalModeEmptyPane.createAction',
              'New terminal tab'
            ),
            run: () => createVerticalTab()
          }

  const [busy, setBusy] = React.useState(false)
  const pending = busy || creating

  return (
    <div
      className="flex flex-1 min-w-0 min-h-0 flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="terminal-mode-empty-pane"
    >
      <TerminalSquare className="size-7 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-sm text-muted-foreground">{mode.body}</p>
        {mode.shortcut && mode.shortcut.keys.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShortcutKeyCombo keys={mode.shortcut.keys} doubleTap={mode.shortcut.doubleTap} />
            {mode.hint}
          </span>
        ) : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        // Why a local busy flag too: opening a terminal is async, and a second
        // click before it lands would open a second one.
        onClick={() => {
          setBusy(true)
          void Promise.resolve(mode.run()).finally(() => setBusy(false))
        }}
        aria-busy={pending}
        disabled={pending}
        data-testid="terminal-mode-empty-pane-open"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {mode.action}
      </Button>
    </div>
  )
}
