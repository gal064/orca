import { useEffect } from 'react'
import type { AppState } from './types'
import { useAppStore } from '.'
import { isTerminalMode } from '@/lib/terminal-mode'
import { selectTerminalModeWorkspaceKeys } from './terminal-mode-workspace-keys'

type ActiveVerticalTabFallbackState = Pick<
  AppState,
  'settings' | 'activeWorkspaceKey' | 'folderWorkspaces' | 'projectGroups'
>

/**
 * True when the flag is off while a vertical tab is still the active workspace. The
 * classic sidebar filters vertical tabs out, so that tab's terminal keeps rendering in the
 * main pane with no row to leave it by (docs/terminal-mode-design.md Phase 6, item 0b).
 *
 * Hidden-group membership, not the key shape: a *classic* folder workspace is a legitimate
 * classic-mode selection and must survive.
 */
export function shouldClearActiveVerticalTab(state: ActiveVerticalTabFallbackState): boolean {
  // Why the null check: settings arrive after boot, and treating "not loaded yet" as
  // "flag off" would drop a restored vertical tab on every launch.
  if (!state.activeWorkspaceKey || !state.settings || isTerminalMode(state.settings)) {
    return false
  }
  return selectTerminalModeWorkspaceKeys(state).has(state.activeWorkspaceKey)
}

/**
 * Falls back to the classic empty state when terminal mode is switched off.
 *
 * A null leaf mounted by `App`, not by the sidebar: the toggle lives in the Settings view,
 * where the sidebar is unmounted, and the guard has to be running at that moment.
 */
export function TerminalModeActiveTabFallbackGate(): null {
  const shouldClear = useAppStore(shouldClearActiveVerticalTab)
  useEffect(() => {
    if (shouldClear) {
      useAppStore.getState().setActiveWorktree(null)
    }
  }, [shouldClear])
  return null
}
