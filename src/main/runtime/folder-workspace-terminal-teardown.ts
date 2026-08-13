import type { FolderWorkspace } from '../../shared/types'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import type { IPtyProvider } from '../providers/types'
import type { OrcaRuntimeService } from './orca-runtime'
import { killAllProcessesForWorktree } from './worktree-teardown'

export type FolderWorkspacePtyTeardownDeps = {
  runtime?: OrcaRuntimeService
  /** SSH target owning the workspace's ptys, when it is not a local folder. */
  connectionId?: string | null
  getLocalProvider: () => IPtyProvider | null | undefined
  getSshProvider?: (connectionId: string) => IPtyProvider | null | undefined
  onPtyStopped?: (ptyId: string) => void
  /** Shrinks the per-sweep budget so a cascade stays inside one overall deadline. */
  timeoutMs?: number
}

/**
 * A folder workspace's ptys are tagged with its `folder:<id>` workspace key, and
 * nothing else ever sweeps them: deletion has no Git removal phase, and the
 * missing-worktree reconciliation sweep skips ids without a `repoId::` prefix.
 * Without this the processes outlive every reference to them.
 */
export async function teardownFolderWorkspaceTerminals(
  folderWorkspaceId: string,
  deps: FolderWorkspacePtyTeardownDeps
): Promise<void> {
  await sweepWorkspaceTerminals(folderWorkspaceKey(folderWorkspaceId), deps)
}

/**
 * Shared by the folder-workspace delete path and the folder-repo removal branch in
 * `orca-runtime.ts`: both need "kill everything this workspace id owns, on whichever
 * provider owns it, best effort".
 */
export async function sweepWorkspaceTerminals(
  workspaceKey: string,
  deps: FolderWorkspacePtyTeardownDeps
): Promise<void> {
  // Why the whole body is guarded, provider lookup included: both delete paths now
  // await this *before* dropping the store row, so anything that throws here would
  // cancel the delete the user asked for.
  try {
    const connectionId = deps.connectionId?.trim() || null
    const sshProvider = connectionId ? deps.getSshProvider?.(connectionId) : undefined
    const provider = sshProvider ?? deps.getLocalProvider()
    if (!provider) {
      return
    }
    await killAllProcessesForWorktree(workspaceKey, {
      ...(deps.runtime ? { runtime: deps.runtime } : {}),
      // Why: the workspace row is about to disappear, so the sweep cannot re-resolve the id itself.
      resolvedWorktreeId: workspaceKey,
      ...(connectionId ? { resolvedConnectionId: connectionId } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      localProvider: provider,
      ...(deps.onPtyStopped ? { onPtyStopped: deps.onPtyStopped } : {}),
      ...(connectionId
        ? { includeProviderInventory: Boolean(sshProvider), includeLocalRegistry: false }
        : {})
    })
  } catch (err) {
    // Best effort: a wedged provider must not block the delete the user asked for.
    console.warn(`[workspace-teardown] failed for ${workspaceKey}:`, err)
  }
}

/**
 * Deleting a project group cascades into every folder workspace beneath it, so
 * that path needs the same sweep as a single delete.
 */
export function getFolderWorkspaceIdsInProjectGroups(
  folderWorkspaces: readonly Pick<FolderWorkspace, 'id' | 'projectGroupId'>[],
  projectGroupIds: ReadonlySet<string>
): string[] {
  return folderWorkspaces
    .filter((workspace) => projectGroupIds.has(workspace.projectGroupId))
    .map((workspace) => workspace.id)
}
