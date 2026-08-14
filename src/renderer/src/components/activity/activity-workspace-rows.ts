import type { AppState } from '@/store/types'
import type { FolderWorkspace, Worktree } from '../../../../shared/types'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { getWorktreeMapFromState } from '@/store/selectors'
import { isTerminalMode } from '@/lib/terminal-mode'
import { selectTerminalModeFolderWorkspaces } from '@/store/classic-workspace-catalog'

type ActivityWorkspaceState = Pick<
  AppState,
  'worktreesByRepo' | 'folderWorkspaces' | 'projectGroups' | 'settings'
>

/**
 * The Activity page's "which workspace does this thread belong to, and can I jump to it"
 * index.
 *
 * `getWorktreeMapFromState` is built from `worktreesByRepo`, so a terminal-mode vertical
 * tab — a folder workspace — is absent from it. The page then labels its threads
 * "Standalone terminal", disables the jump action and suppresses the pane preview, which
 * would make the Phase 5 sidebar bell lead somewhere it cannot act. Adding the vertical
 * tabs here fixes all of those at once, because they all consult this one map.
 *
 * Scoped to terminal mode on purpose: a *classic* folder workspace is also missing from
 * the Activity page's map, but that is a pre-existing upstream gap and fixing it here
 * would be an unscoped change to a classic surface.
 */
export function selectActivityWorktreeMap(state: ActivityWorkspaceState): Map<string, Worktree> {
  const worktreeMap = getWorktreeMapFromState(state)
  if (!isTerminalMode(state.settings)) {
    return worktreeMap
  }
  // Why the choke point and not the raw catalog: every enumeration goes through it, so
  // the isolation tripwire stays meaningful (`terminal-mode-isolation.test.ts`).
  const verticalTabs = selectTerminalModeFolderWorkspaces(state)
  if (verticalTabs.length === 0) {
    return worktreeMap
  }
  return cachedVerticalTabMap(worktreeMap, verticalTabs)
}

/**
 * Identity-stable per (worktree map, vertical tabs): this selector runs inside a
 * `useShallow`, so returning a fresh Map on every store write would compare unequal every
 * time and spin `getSnapshot`.
 */
const mapCache = new WeakMap<object, WeakMap<object, Map<string, Worktree>>>()

function cachedVerticalTabMap(
  worktreeMap: Map<string, Worktree>,
  verticalTabs: readonly FolderWorkspace[]
): Map<string, Worktree> {
  let byWorkspaces = mapCache.get(worktreeMap)
  if (!byWorkspaces) {
    byWorkspaces = new WeakMap<object, Map<string, Worktree>>()
    mapCache.set(worktreeMap, byWorkspaces)
  }
  const cached = byWorkspaces.get(verticalTabs)
  if (cached) {
    return cached
  }
  const merged = new Map(worktreeMap)
  for (const workspace of verticalTabs) {
    const worktree = folderWorkspaceToWorktree(workspace)
    merged.set(worktree.id, worktree)
  }
  byWorkspaces.set(verticalTabs, merged)
  return merged
}
