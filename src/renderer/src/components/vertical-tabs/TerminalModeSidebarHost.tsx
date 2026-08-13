import React, { useCallback } from 'react'
import { useAppStore } from '@/store'
import VerticalTabCloseConfirmDialog from './VerticalTabCloseConfirmDialog'
import { useTerminalCwdTracking } from './use-terminal-cwd-tracking'
import { useTerminalModePanelScope } from './use-terminal-mode-panel-scope'
import { useTerminalModeAutoTitlePersistence } from './use-terminal-mode-auto-title'

/**
 * The close confirmation lives here rather than in the tab strip because
 * Mod+Shift+W must still work while the sidebar is collapsed — and so does pwd
 * tracking, panel re-rooting and auto-titling, which feed the right sidebar and
 * tab creation rather than the strip.
 */
function TerminalModeSidebarHost(): React.JSX.Element {
  useTerminalCwdTracking()
  useTerminalModePanelScope()
  useTerminalModeAutoTitlePersistence()
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
