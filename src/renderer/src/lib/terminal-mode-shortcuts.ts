import type { AppState } from '@/store/types'
import { resolveActiveVerticalTabId, selectVerticalTabs } from '@/store/slices/vertical-tabs'
import { isTerminalMode } from './terminal-mode'

/**
 * Terminal mode reuses the classic chords rather than adding new ones
 * (docs/terminal-mode-design.md, resolved question 4), so each shared handler
 * asks these helpers first. They return true when the chord was fully handled,
 * which is also what keeps every branch a one-line guard in upstream files.
 */
export function getActiveVerticalTabId(
  state: Pick<AppState, 'activeWorkspaceKey' | 'folderWorkspaces' | 'projectGroups'>
): string | null {
  return resolveActiveVerticalTabId(
    state.activeWorkspaceKey,
    selectVerticalTabs(state.folderWorkspaces, state.projectGroups)
  )
}

export function handleTerminalModeWorkspaceCreate(state: AppState): boolean {
  if (!isTerminalMode(state.settings)) {
    return false
  }
  void state.createVerticalTab()
  return true
}

/** Mod+Shift+W closes the focused vtab through the same confirmation the row menu uses. */
export function handleTerminalModeWorkspaceDelete(state: AppState): boolean {
  if (!isTerminalMode(state.settings)) {
    return false
  }
  const activeTabId = getActiveVerticalTabId(state)
  if (activeTabId) {
    state.requestVerticalTabClose(activeTabId)
  }
  return true
}

export function handleTerminalModeWorkspaceIndex(state: AppState, index: number): boolean {
  if (!isTerminalMode(state.settings)) {
    return false
  }
  const tab = selectVerticalTabs(state.folderWorkspaces, state.projectGroups)[index]
  if (tab) {
    state.activateVerticalTab(tab.id)
  }
  return true
}
