import React, { useCallback } from 'react'
import { useAppStore } from '@/store'
import VerticalTabCloseConfirmDialog from './VerticalTabCloseConfirmDialog'

/**
 * The close confirmation lives here rather than in the tab strip because
 * Mod+Shift+W must still work while the sidebar is collapsed.
 */
function TerminalModeSidebarHost(): React.JSX.Element {
  const closeVerticalTab = useAppStore((s) => s.closeVerticalTab)
  const requestVerticalTabClose = useAppStore((s) => s.requestVerticalTabClose)
  const pendingCloseId = useAppStore((s) => s.verticalTabPendingCloseId)

  const handleCancel = useCallback(() => {
    requestVerticalTabClose(null)
  }, [requestVerticalTabClose])
  const handleConfirm = useCallback(() => {
    if (pendingCloseId) {
      void closeVerticalTab(pendingCloseId)
    }
  }, [closeVerticalTab, pendingCloseId])

  return (
    <VerticalTabCloseConfirmDialog
      open={pendingCloseId !== null}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  )
}

export default React.memo(TerminalModeSidebarHost)
