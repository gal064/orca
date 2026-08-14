import type { AppState } from '@/store/types'
import { isTerminalMode } from '@/lib/terminal-mode'
import { selectTerminalModeWorkspaceKeys } from '@/store/classic-workspace-catalog'
import { translate } from '@/i18n/i18n'

/** No vertical tabs — the flag-off answer, and the default for callers outside the page. */
export const NO_ACTIVITY_TERMINAL_TAB_KEYS: ReadonlySet<string> = Object.freeze(new Set<string>())

/** Group key for the "project" grouping — one bucket for every vertical tab. */
export const ACTIVITY_TERMINAL_TABS_GROUP_KEY = 'project:terminal-tabs'

/**
 * Workspace keys the Activity page should present as terminal tabs rather than as a
 * project. Hidden-group membership, never the `folder:` key shape: a *classic* folder
 * workspace also reaches this page (as a standalone workspace) and is not a terminal tab.
 *
 * Empty with the flag off, so classic users see exactly what they saw before.
 */
export function selectActivityTerminalTabKeys(
  state: Pick<AppState, 'settings' | 'folderWorkspaces' | 'projectGroups'>
): ReadonlySet<string> {
  return isTerminalMode(state.settings)
    ? selectTerminalModeWorkspaceKeys(state)
    : NO_ACTIVITY_TERMINAL_TAB_KEYS
}

/**
 * Heading for a thread that belongs to a vertical tab. Its `repoId` is the synthetic
 * `folder-workspace:` stamp, so no project row matches it and the page would otherwise
 * label it "Unknown project" (docs/terminal-mode-design.md Phase 6, item 0b).
 *
 * Null for anything else, whose own project label wins.
 */
export function getActivityTerminalTabProjectLabel(
  worktreeId: string,
  terminalTabKeys: ReadonlySet<string>
): string | null {
  return terminalTabKeys.has(worktreeId)
    ? translate('auto.components.activity.terminalTabsProject', 'Terminal tabs')
    : null
}
