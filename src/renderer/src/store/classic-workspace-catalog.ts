import { useAppStore } from '@/store'
import type { AppState } from './types'
import type { FolderWorkspace, ProjectGroup } from '../../../shared/types'
import {
  excludeTerminalModeFolderWorkspaces,
  excludeTerminalModeGroups,
  getTerminalModeGroupIds
} from '../../../shared/terminal-mode-group'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'

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

/**
 * Every result depends on BOTH source arrays, so the cache is keyed on both — a groups
 * update that leaves `folderWorkspaces` identical must not serve a stale, unfiltered
 * array (zustand compares by identity, so nothing would ever correct it).
 */
function cacheByBothSources<T>(
  cache: WeakMap<object, WeakMap<object, T>>,
  groups: object | undefined,
  workspaces: object | undefined,
  derive: () => T
): T {
  // Why tolerated at runtime while the type stays required: test fixtures cast partial
  // states through `as unknown as AppState`. Production callers still get a build error.
  if (!groups || !workspaces) {
    return derive()
  }
  let byWorkspaces = cache.get(groups)
  if (!byWorkspaces) {
    byWorkspaces = new WeakMap<object, T>()
    cache.set(groups, byWorkspaces)
  }
  const cached = byWorkspaces.get(workspaces)
  if (cached !== undefined) {
    return cached
  }
  const derived = derive()
  byWorkspaces.set(workspaces, derived)
  return derived
}

// Why frozen module constants and not `?? []`: a fresh array would hand zustand a new
// identity on every store update, re-rendering every subscriber.
const NO_GROUPS: readonly ProjectGroup[] = Object.freeze([])
const NO_WORKSPACES: readonly FolderWorkspace[] = Object.freeze([])

const classicGroupsCache = new WeakMap<object, WeakMap<object, readonly ProjectGroup[]>>()
const classicWorkspacesCache = new WeakMap<object, WeakMap<object, readonly FolderWorkspace[]>>()
const terminalModeKeysCache = new WeakMap<object, WeakMap<object, ReadonlySet<string>>>()

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

/** Workspace keys (`folder:<id>`) owned by terminal mode — for surfaces keyed by workspace. */
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

export function useClassicProjectGroups(): readonly ProjectGroup[] {
  return useAppStore(selectClassicProjectGroups)
}

export function useClassicFolderWorkspaces(): readonly FolderWorkspace[] {
  return useAppStore(selectClassicFolderWorkspaces)
}
