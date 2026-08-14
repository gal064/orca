import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { ClosingAgent } from '@/lib/terminal-mode-close-agents'

export type VerticalTabCloseConfirmDialogProps = {
  open: boolean
  /** Agents the close would kill. Non-empty whenever the dialog is shown at all —
   *  a tab with nothing running closes without asking. */
  agents: readonly ClosingAgent[]
  onCancel: () => void
  onConfirm: () => void
}

/** Agent-aware confirmation: it names what closing would kill, so the user is
 *  answering a real question rather than dismissing a habitual one. */
function VerticalTabCloseConfirmDialog({
  open,
  agents,
  onCancel,
  onConfirm
}: VerticalTabCloseConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[420px]" data-testid="vertical-tab-close-confirm">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.verticalTabs.VerticalTabCloseConfirmDialog.title',
              'Close terminal tab?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.verticalTabs.VerticalTabCloseConfirmDialog.description',
              'Closing this tab kills every process running in it.'
            )}
          </DialogDescription>
        </DialogHeader>
        {agents.length > 0 ? (
          <ul
            className="scrollbar-sleek max-h-40 space-y-1 overflow-y-auto rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
            data-testid="vertical-tab-close-confirm-agents"
          >
            {agents.map((agent) => (
              <li key={agent.paneKey} className="truncate">
                {agent.label}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {translate(
              'auto.components.verticalTabs.VerticalTabCloseConfirmDialog.cancel',
              'Cancel'
            )}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            data-testid="vertical-tab-close-confirm-action"
          >
            {translate(
              'auto.components.verticalTabs.VerticalTabCloseConfirmDialog.action',
              'Close tab'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(VerticalTabCloseConfirmDialog)
