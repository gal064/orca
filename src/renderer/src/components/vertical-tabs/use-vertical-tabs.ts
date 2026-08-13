import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { FolderWorkspace } from '../../../../shared/types'
import { resolveActiveVerticalTabId, selectVerticalTabs } from '@/store/slices/vertical-tabs'

/** Terminal-mode sidebar rows, in render order. */
export function useVerticalTabs(): readonly FolderWorkspace[] {
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const projectGroups = useAppStore((s) => s.projectGroups)
  // Why memo: the selector allocates, so subscribing to it directly would re-render forever.
  return useMemo(
    () => selectVerticalTabs(folderWorkspaces, projectGroups),
    [folderWorkspaces, projectGroups]
  )
}

/** Folder-workspace id of the active vtab, or null when the active workspace is not one. */
export function useActiveVerticalTabId(): string | null {
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const tabs = useVerticalTabs()
  return useMemo(
    () => resolveActiveVerticalTabId(activeWorkspaceKey, tabs),
    [activeWorkspaceKey, tabs]
  )
}
