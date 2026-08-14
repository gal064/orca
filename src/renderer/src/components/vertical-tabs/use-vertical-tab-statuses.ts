import { useMemo } from 'react'
import type { FolderWorkspace } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { useWorktreeActivityStatuses } from '@/components/sidebar/use-worktree-activity-statuses'
import type { WorktreeStatus } from '@/lib/worktree-status'

/**
 * Agent status per vertical tab, by folder-workspace id.
 *
 * Reuses the classic status *source* rather than the card: agent rows are attributed
 * to a workspace through `tabsByWorktree`, which is keyed by workspace key, so a
 * vertical tab's `folder:` key resolves with no special casing. The hook it wraps
 * returns a shallow-stable map, so an agent working in one tab does not re-render the
 * whole strip.
 *
 * The Codex attention debounce does not need handling here: it delays only the OS
 * notification, never the store entry this reads (agent-completion-coordinator.ts).
 */
export function useVerticalTabStatuses(
  tabs: readonly FolderWorkspace[]
): Map<string, WorktreeStatus> {
  // Why keyed on ids: `tabs` is a fresh array whenever the catalog changes, and the
  // wrapped hook memoizes on the identity of the id list it is given.
  const workspaceKeys = useMemo(() => tabs.map((tab) => folderWorkspaceKey(tab.id)), [tabs])
  const statusByWorkspaceKey = useWorktreeActivityStatuses(workspaceKeys)
  return useMemo(() => {
    const byTabId = new Map<string, WorktreeStatus>()
    for (const tab of tabs) {
      const status = statusByWorkspaceKey.get(folderWorkspaceKey(tab.id))
      if (status) {
        byTabId.set(tab.id, status)
      }
    }
    return byTabId
  }, [statusByWorkspaceKey, tabs])
}
