import type { FolderWorkspace, ProjectGroup } from '../../../shared/types'

/**
 * Every catalog result depends on BOTH source arrays, so the cache is keyed on both — a
 * groups update that leaves `folderWorkspaces` identical must not serve a stale,
 * unfiltered array (zustand compares by identity, so nothing would ever correct it).
 *
 * Why its own module: the catalog selectors are read from store slices at module init,
 * so anything they import must not reach back into `@/store`.
 */
export function cacheByBothSources<T>(
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
export const NO_GROUPS: readonly ProjectGroup[] = Object.freeze([])
export const NO_WORKSPACES: readonly FolderWorkspace[] = Object.freeze([])
