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
 * returns a shallow-stable map, so the strip is immune to the prompt/tool churn that
 * rewrites agent status entries without changing any tab's rolled-up state.
 *
 * The Codex attention debounce does not need handling here: it delays only the OS
 * notification, never the store entry this reads (agent-completion-coordinator.ts).
 */
export function useVerticalTabStatuses(
  tabs: readonly FolderWorkspace[]
): ReadonlyMap<string, WorktreeStatus> {
  // Why keyed on ids: `tabs` is a fresh array whenever the catalog changes, and the
  // wrapped hook memoizes on the identity of the id list it is given.
  const workspaceKeys = useMemo(() => tabs.map((tab) => folderWorkspaceKey(tab.id)), [tabs])
  // Returned workspace-keyed: re-keying to folder-workspace ids would recompute
  // `folderWorkspaceKey` for every tab a second time to answer the same question.
  return useWorktreeActivityStatuses(workspaceKeys)
}
