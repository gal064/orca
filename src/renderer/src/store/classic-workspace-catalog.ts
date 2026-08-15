import { useAppStore } from '@/store'
import type { AppState } from './types'
import type { FolderWorkspace, ProjectGroup } from '../../../shared/types'
import {
  excludeTerminalModeFolderWorkspaces,
  excludeTerminalModeGroups,
  getTerminalModeGroupIds
} from '../../../shared/terminal-mode-group'
import { isTerminalMode } from '@/lib/terminal-mode'
import { NO_GROUPS, NO_WORKSPACES, cacheByBothSources } from './workspace-catalog-cache'

/**
 * The one place classic UI reads the workspace catalog.
 *
 * Terminal-mode vertical tabs are folder workspaces under a reserved project group
 * (`src/shared/terminal-mode-group.ts`). They must live in the same `projectGroups` /
 * `folderWorkspaces` state as everything else — the tab system, session persistence
 * and, crucially, execution-host resolution all read a folder workspace's group — so
 * they cannot be split out at catalog ingress. Instead every classic enumeration goes
 * through these selectors, in BOTH modes, since the data outlives the experimental
 * flag. `terminal-mode-isolation.test.ts` is the tripwire for surfaces that forget.
 *
 * Results are cached per source array, so a consumer's memo dependencies stay stable
 * and a user with no vertical tabs pays nothing.
 */
/**
 * Required, not Partial: a caller that narrows the store and forgets these two fields
 * would silently get an empty catalog and filter nothing. That must be a build error.
 */
type CatalogState = Pick<AppState, 'projectGroups' | 'folderWorkspaces'>

const classicGroupsCache = new WeakMap<object, WeakMap<object, readonly ProjectGroup[]>>()
const classicWorkspacesCache = new WeakMap<object, WeakMap<object, readonly FolderWorkspace[]>>()
const terminalModeWorkspacesCache = new WeakMap<
  object,
  WeakMap<object, readonly FolderWorkspace[]>
>()

export function selectClassicProjectGroups(state: CatalogState): readonly ProjectGroup[] {
  return cacheByBothSources(classicGroupsCache, state.projectGroups, state.folderWorkspaces, () =>
    excludeTerminalModeGroups(state.projectGroups ?? NO_GROUPS)
  )
}

export function selectClassicFolderWorkspaces(state: CatalogState): readonly FolderWorkspace[] {
  return cacheByBothSources(
    classicWorkspacesCache,
    state.projectGroups,
    state.folderWorkspaces,
    () =>
      excludeTerminalModeFolderWorkspaces(
        state.folderWorkspaces ?? NO_WORKSPACES,
        state.projectGroups ?? NO_GROUPS
      )
  )
}

/**
 * Workspaces whose unread state a badge may count.
 *
 * A vertical tab is neither visible nor clearable with the flag off, so counting one in
 * classic mode produces a badge no surface can render and no click can dismiss — and it
 * survives restarts. In terminal mode they are the whole point, so the raw catalog is
 * correct there. Both badge surfaces call this instead of branching for themselves.
 *
 * Identity-stable in both arms: terminal mode returns the store array untouched, classic
 * returns the cached classic selection.
 */
export function selectBadgeCountableFolderWorkspaces(
  state: CatalogState & Pick<AppState, 'settings'>
): readonly FolderWorkspace[] {
  return isTerminalMode(state.settings)
    ? (state.folderWorkspaces ?? NO_WORKSPACES)
    : selectClassicFolderWorkspaces(state)
}

/**
 * The vertical tabs themselves — the complement of `selectClassicFolderWorkspaces`.
 *
 * For the few surfaces that must render terminal mode's own workspaces rather than hide
 * them. Lives here so those surfaces still read the catalog through the choke point and
 * the isolation tripwire keeps its meaning.
 */
export function selectTerminalModeFolderWorkspaces(
  state: CatalogState
): readonly FolderWorkspace[] {
  return cacheByBothSources(
    terminalModeWorkspacesCache,
    state.projectGroups,
    state.folderWorkspaces,
    () => {
      const groupIds = getTerminalModeGroupIds(state.projectGroups ?? NO_GROUPS)
      if (groupIds.size === 0) {
        return NO_WORKSPACES
      }
      return (state.folderWorkspaces ?? NO_WORKSPACES).filter((workspace) =>
        groupIds.has(workspace.projectGroupId)
      )
    }
  )
}

export function useClassicProjectGroups(): readonly ProjectGroup[] {
  return useAppStore(selectClassicProjectGroups)
}

export function useClassicFolderWorkspaces(): readonly FolderWorkspace[] {
  return useAppStore(selectClassicFolderWorkspaces)
}
