import { useSyncExternalStore } from 'react'
import { DIGIT_INDEX_SHORTCUT_COUNT } from '../../../../shared/keybindings'
import {
  getPublishedVisibleWorktreeIds,
  subscribePublishedVisibleWorktreeIds
} from './visible-worktrees'

// Why a module-level memo keyed on array identity: every card calls this, and
// rebuilding the lookup per card would make sidebar render O(n²). WorktreeList
// publishes an identity-stable array, so this recomputes only on real reorders.
let cachedIds: readonly string[] | null = null
let cachedPositions: Map<string, number> = new Map()

function positionsFor(ids: readonly string[] | null): Map<string, number> {
  if (ids === cachedIds) {
    return cachedPositions
  }
  const positions = new Map<string, number>()
  if (ids) {
    // Only the addressable range is worth indexing — deeper rows have no chord.
    for (let index = 0; index < Math.min(ids.length, DIGIT_INDEX_SHORTCUT_COUNT); index += 1) {
      positions.set(ids[index], index)
    }
  }
  cachedIds = ids
  cachedPositions = positions
  return positions
}

/**
 * The zero-based Cmd/Ctrl+1–9 position of a workspace, or null when it sits
 * past the ninth visible row (no chord can reach it).
 *
 * Reads the same published order `getVisibleWorktreeIds()` hands the shortcut
 * handler, so a badge can never name a digit that activates a different card.
 */
export function useWorkspaceShortcutIndex(worktreeId: string): number | null {
  const ids = useSyncExternalStore(
    subscribePublishedVisibleWorktreeIds,
    getPublishedVisibleWorktreeIds,
    // Why null on the server/initial snapshot: no sidebar has rendered yet, so
    // no position is addressable and no badge should claim one.
    () => null
  )
  return positionsFor(ids).get(worktreeId) ?? null
}
