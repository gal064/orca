import type { AppState } from './types'
import { getTerminalModeGroupIds } from '../../../shared/terminal-mode-group'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { NO_GROUPS, NO_WORKSPACES, cacheByBothSources } from './workspace-catalog-cache'
import { isTerminalMode } from '@/lib/terminal-mode'

type CatalogState = Pick<AppState, 'projectGroups' | 'folderWorkspaces'>

const terminalModeKeysCache = new WeakMap<object, WeakMap<object, ReadonlySet<string>>>()

/**
 * Workspace keys (`folder:<id>`) owned by terminal mode — for surfaces keyed by
 * workspace. Re-exported by `classic-workspace-catalog.ts`, which is the choke point
 * classic surfaces read; it lives here so store slices can read it without importing
 * that module's hooks (and, through them, the store itself) at init time.
 */
export function selectTerminalModeWorkspaceKeys(state: CatalogState): ReadonlySet<string> {
  return cacheByBothSources(
    terminalModeKeysCache,
    state.projectGroups,
    state.folderWorkspaces,
    () => {
      const groupIds = getTerminalModeGroupIds(state.projectGroups ?? NO_GROUPS)
      const keys = new Set<string>()
      if (groupIds.size > 0) {
        for (const workspace of state.folderWorkspaces ?? NO_WORKSPACES) {
          if (groupIds.has(workspace.projectGroupId)) {
            keys.add(folderWorkspaceKey(workspace.id))
          }
        }
      }
      return keys
    }
  )
}

/**
 * True only for a live vertical tab with terminal mode on — a classic folder
 * workspace shares the `folder:` key shape and must keep classic behavior.
 */
export function isTerminalModeVerticalTabKey(
  state: CatalogState & Pick<AppState, 'settings'>,
  workspaceKey: string | null | undefined
): boolean {
  return (
    !!workspaceKey &&
    isTerminalMode(state.settings) &&
    selectTerminalModeWorkspaceKeys(state).has(workspaceKey)
  )
}
