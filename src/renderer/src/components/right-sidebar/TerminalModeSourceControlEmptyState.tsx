import React from 'react'
import { translate } from '@/i18n/i18n'

/**
 * Source Control's state for a vertical tab whose pwd is outside every
 * repository. The spec asks for a quiet one that doubles as the affordance
 * explaining how to get changes here (terminal-mode-spec.md §4).
 */
function TerminalModeSourceControlEmptyStateInner({
  pending
}: {
  /** The repo lookup has not answered yet — say nothing rather than claim "no repo". */
  pending: boolean
}): React.JSX.Element | null {
  if (pending) {
    return null
  }
  return (
    <div
      className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground"
      data-testid="terminal-mode-source-control-empty"
    >
      {translate(
        'auto.components.right.sidebar.TerminalModeSourceControlEmptyState.noRepo',
        'Not a git repository — cd into one to see changes.'
      )}
    </div>
  )
}

export const TerminalModeSourceControlEmptyState = React.memo(
  TerminalModeSourceControlEmptyStateInner
)
