import type { GitWorktreeInfo, Repo, Worktree, WorktreeMeta } from '../../shared/types'
import { DEFAULT_WORKSPACE_STATUS_ID } from '../../shared/workspace-statuses'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../../shared/worktree-id'

// Reuse-checkout workspaces open an additional workspace over a repo's existing
// checkout without running `git worktree add`. They borrow the folder-workspace
// `::workspace:<uuid>` id scheme (multiple instances over one directory) but stay
// on a `kind: 'git'` repo, so `splitWorktreeIdForFilesystem` resolves them to
// `repo.path` and Source Control / diffs / terminal stay fully enabled.

export function getReuseCheckoutWorkspaceRootId(repo: Repo): string {
  return `${repo.id}::${repo.path}`
}

export function getReuseCheckoutWorkspaceInstanceId(repo: Repo, instanceId: string): string {
  return `${getReuseCheckoutWorkspaceRootId(repo)}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}${instanceId}`
}

export function isReuseCheckoutWorkspaceInstanceId(worktreeId: string): boolean {
  return worktreeId.includes(FOLDER_WORKSPACE_INSTANCE_SEPARATOR)
}

// Pick the checkout a reuse workspace should sit on: the repo's primary working
// tree (its branch/head become the workspace's real, non-empty git state).
export function pickReuseCheckoutTarget(
  worktrees: GitWorktreeInfo[],
  repoPath: string
): GitWorktreeInfo | undefined {
  return worktrees.find((gw) => gw.isMainWorktree) ?? worktrees.find((gw) => gw.path === repoPath)
}

// Like mergeWorktree, but keeps the real branch/head of the reused checkout while
// forcing isMainWorktree:false — a reuse instance is an extra workspace, never the
// primary worktree (so main-only delete/UI guards do not misfire).
export function mergeReuseCheckoutWorkspace(
  repo: Repo,
  worktreeId: string,
  meta: WorktreeMeta,
  checkout: Pick<GitWorktreeInfo, 'path' | 'head' | 'branch' | 'isBare'>
): Worktree {
  return {
    id: worktreeId,
    ...(meta.instanceId !== undefined ? { instanceId: meta.instanceId } : {}),
    repoId: repo.id,
    ...(meta.projectId !== undefined ? { projectId: meta.projectId } : {}),
    ...(meta.hostId !== undefined ? { hostId: meta.hostId } : {}),
    ...(meta.projectHostSetupId !== undefined
      ? { projectHostSetupId: meta.projectHostSetupId }
      : {}),
    path: checkout.path,
    head: checkout.head,
    branch: checkout.branch,
    isBare: checkout.isBare,
    isMainWorktree: false,
    displayName: meta.displayName || repo.displayName,
    comment: meta.comment || '',
    linkedIssue: meta.linkedIssue ?? null,
    linkedPR: meta.linkedPR ?? null,
    linkedLinearIssue: meta.linkedLinearIssue ?? null,
    linkedLinearIssueWorkspaceId: meta.linkedLinearIssueWorkspaceId ?? null,
    linkedLinearIssueOrganizationUrlKey: meta.linkedLinearIssueOrganizationUrlKey ?? null,
    linkedGitLabMR: meta.linkedGitLabMR ?? null,
    linkedGitLabIssue: meta.linkedGitLabIssue ?? null,
    linkedBitbucketPR: meta.linkedBitbucketPR ?? null,
    linkedAzureDevOpsPR: meta.linkedAzureDevOpsPR ?? null,
    linkedGiteaPR: meta.linkedGiteaPR ?? null,
    isArchived: meta.isArchived ?? false,
    isUnread: meta.isUnread ?? false,
    isPinned: meta.isPinned ?? false,
    sortOrder: meta.sortOrder ?? 0,
    ...(meta.manualOrder !== undefined ? { manualOrder: meta.manualOrder } : {}),
    lastActivityAt: meta.lastActivityAt ?? 0,
    ...(meta.createdAt !== undefined ? { createdAt: meta.createdAt } : {}),
    ...(meta.createdWithAgent !== undefined ? { createdWithAgent: meta.createdWithAgent } : {}),
    ...(meta.baseRef !== undefined ? { baseRef: meta.baseRef } : {}),
    ...(meta.automationProvenance !== undefined
      ? { automationProvenance: meta.automationProvenance }
      : {}),
    ...(meta.priorWorktreeIds !== undefined ? { priorWorktreeIds: meta.priorWorktreeIds } : {}),
    workspaceStatus: meta.workspaceStatus ?? DEFAULT_WORKSPACE_STATUS_ID,
    diffComments: meta.diffComments,
    mobileDiffReview: meta.mobileDiffReview
  }
}

// Synthesize the reuse-checkout workspace rows for a git repo from persisted
// metadata. Git does not report these instances (they have no real worktree), so
// listing must add them back — mirrors listFolderWorkspaces for folder repos.
export function listReuseCheckoutWorkspaces(
  allMeta: Record<string, WorktreeMeta>,
  repo: Repo,
  checkout: Pick<GitWorktreeInfo, 'path' | 'head' | 'branch' | 'isBare'>
): Worktree[] {
  const prefix = `${getReuseCheckoutWorkspaceRootId(repo)}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}`
  return Object.entries(allMeta)
    .filter(([worktreeId, meta]) => meta.reuseCheckout === true && worktreeId.startsWith(prefix))
    .map(([worktreeId, meta]) => mergeReuseCheckoutWorkspace(repo, worktreeId, meta, checkout))
}
