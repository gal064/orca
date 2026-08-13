import type { FolderWorkspace } from '../../../../shared/types'
import { getVerticalTabAutoName } from '@/store/slices/vertical-tabs'

/**
 * Auto-titling (docs/terminal-mode-spec.md §4): a vertical tab is named after the
 * basename of its focused terminal's pwd until the user renames it, which sets
 * `terminalModeAutoName: false` and pins the name permanently.
 *
 * Derivation is display-side. Persisting on every `cd` would write the store (and
 * the remote host) once per prompt; a slow debounce carries the name across a
 * restart, which is the only thing persistence buys here.
 */
export function isVerticalTabAutoNamed(
  tab: Pick<FolderWorkspace, 'terminalModeAutoName'>
): boolean {
  return tab.terminalModeAutoName !== false
}

export function resolveVerticalTabDisplayName(
  tab: Pick<FolderWorkspace, 'name' | 'terminalModeAutoName'>,
  pwd: string | null | undefined
): string {
  if (!isVerticalTabAutoNamed(tab)) {
    return tab.name
  }
  const trimmed = pwd?.trim()
  return trimmed ? getVerticalTabAutoName(trimmed) : tab.name
}

/** The tabs whose persisted name has drifted from their auto-title. */
export function collectVerticalTabNamePersists(
  tabs: readonly FolderWorkspace[],
  pwdByTabId: Readonly<Record<string, string | null>>
): { id: string; name: string }[] {
  const updates: { id: string; name: string }[] = []
  for (const tab of tabs) {
    const name = resolveVerticalTabDisplayName(tab, pwdByTabId[tab.id])
    if (name !== tab.name) {
      updates.push({ id: tab.id, name })
    }
  }
  return updates
}
