import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { selectAgentsAtRiskForVerticalTab } from '@/lib/terminal-mode-close-agents'
import VerticalTabCloseConfirmDialog from './VerticalTabCloseConfirmDialog'
import { useTerminalCwdTracking } from './use-terminal-cwd-tracking'
import { useTerminalModePanelScope } from './use-terminal-mode-panel-scope'
import { useTerminalModeAutoTitlePersistence } from './use-terminal-mode-auto-title'

const EMPTY_AGENTS: never[] = []

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
  // Why snapshotted at open and not subscribed: the list answers "what am I about to
  // kill", so a row vanishing under the cursor as an agent settles would change the
  // question mid-decision — and subscribing would re-render this host on every agent
  // status write for a dialog that is closed almost always.
  const agentList = useMemo(
    () =>
      pendingCloseId
        ? selectAgentsAtRiskForVerticalTab(useAppStore.getState(), pendingCloseId)
        : EMPTY_AGENTS,
    [pendingCloseId]
  )

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
      agents={agentList}
      open={pendingCloseId !== null}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  )
}

export default React.memo(TerminalModeSidebarHost)
