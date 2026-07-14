import type {
  AutomationWorkspaceProvenance,
  GitWorktreeInfo,
  OrcaWorkspaceLayout,
  Repo,
  TuiAgent,
  WorkspaceStatus,
  Worktree,
  WorktreeMeta
} from '../../shared/types'
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

// Fields of a create request that a reuse-checkout meta copies verbatim. Typed to
// the WorktreeMeta destination (nullable variants) so both the runtime and desktop
// (local + SSH) create callers — whose arg types differ slightly — are assignable.
type ReuseCheckoutMetaArgs = {
  automationProvenance?: AutomationWorkspaceProvenance
  linkedIssue?: number | null
  linkedPR?: number | null
  linkedLinearIssue?: string | null
  linkedLinearIssueWorkspaceId?: string | null
  linkedLinearIssueOrganizationUrlKey?: string | null
  linkedGitLabIssue?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
  comment?: string
  manualOrder?: number
  workspaceStatus?: WorkspaceStatus
}

// Build the persisted metadata for a reuse-checkout instance. Shared by all three
// create paths (runtime, desktop-local, desktop-SSH) so the marker fields stay in
// lockstep; callers resolve their own project-host-setup meta, display name, and
// creation source since those differ per surface.
export function buildReuseCheckoutMeta(input: {
  args: ReuseCheckoutMetaArgs
  instanceId: string
  now: number
  orcaCreationSource: NonNullable<WorktreeMeta['orcaCreationSource']>
  workspaceLayout: OrcaWorkspaceLayout
  projectHostSetupMeta: Partial<WorktreeMeta>
  displayName: string
  createdWithAgent: TuiAgent | undefined
}): Partial<WorktreeMeta> {
  const { args } = input
  return {
    instanceId: input.instanceId,
    ...input.projectHostSetupMeta,
    displayName: input.displayName,
    lastActivityAt: input.now,
    createdAt: input.now,
    orcaCreatedAt: input.now,
    orcaCreationSource: input.orcaCreationSource,
    orcaCreationWorkspaceLayout: input.workspaceLayout,
    reuseCheckout: true,
    // Why: the reused checkout dir and its branch predate this workspace; delete
    // must never prune the branch or remove the shared worktree.
    preserveBranchOnDelete: true,
    ...(args.automationProvenance ? { automationProvenance: args.automationProvenance } : {}),
    ...(input.createdWithAgent ? { createdWithAgent: input.createdWithAgent } : {}),
    ...(args.linkedIssue !== undefined ? { linkedIssue: args.linkedIssue } : {}),
    ...(args.linkedPR !== undefined ? { linkedPR: args.linkedPR } : {}),
    ...(args.linkedLinearIssue !== undefined ? { linkedLinearIssue: args.linkedLinearIssue } : {}),
    ...(args.linkedLinearIssueWorkspaceId !== undefined
      ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
      : {}),
    ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
      ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
      : {}),
    ...(args.linkedGitLabIssue !== undefined ? { linkedGitLabIssue: args.linkedGitLabIssue } : {}),
    ...(args.linkedGitLabMR !== undefined ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
    ...(args.linkedBitbucketPR !== undefined ? { linkedBitbucketPR: args.linkedBitbucketPR } : {}),
    ...(args.linkedAzureDevOpsPR !== undefined
      ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
      : {}),
    ...(args.linkedGiteaPR !== undefined ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
    ...(args.comment !== undefined ? { comment: args.comment } : {}),
    ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
    ...(args.workspaceStatus !== undefined ? { workspaceStatus: args.workspaceStatus } : {})
  }
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
