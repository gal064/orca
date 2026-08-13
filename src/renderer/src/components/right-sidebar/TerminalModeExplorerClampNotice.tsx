import React from 'react'
import { translate } from '@/i18n/i18n'
import { useTerminalModePanelClamped } from './use-terminal-mode-panels'

/**
 * Shown when a remote host cannot address directories outside the vertical tab's
 * start folder (no `terminal-mode.absolute-path-scope.v1`), so the explorer stayed
 * on that folder instead of following the shell. Renders nothing otherwise, which
 * is every classic-mode and local case.
 */
function TerminalModeExplorerClampNoticeInner({
  workspaceKey
}: {
  workspaceKey: string | null
}): React.JSX.Element | null {
  const clamped = useTerminalModePanelClamped(workspaceKey)
  if (!clamped) {
    return null
  }
  return (
    <div
      className="border-b border-border px-2 py-1 text-[11px] text-muted-foreground"
      data-testid="terminal-mode-explorer-clamp-notice"
    >
      {translate(
        'auto.components.right.sidebar.TerminalModeExplorerClampNotice.hint',
        'Host update needed to follow cd outside the start folder.'
      )}
    </div>
  )
}

export const TerminalModeExplorerClampNotice = React.memo(TerminalModeExplorerClampNoticeInner)
