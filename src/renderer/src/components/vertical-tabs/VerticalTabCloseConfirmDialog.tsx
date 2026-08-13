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

export type VerticalTabCloseConfirmDialogProps = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Plain confirmation for now; the agent-aware version lands in Phase 5. */
function VerticalTabCloseConfirmDialog({
  open,
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
