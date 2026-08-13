import type { FolderWorkspace, Repo, Worktree } from '../../../../shared/types'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { getRuntimePathBasename } from '../../../../shared/cross-platform-path'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../../shared/constants'

/**
 * Source Control keyed off a vertical tab's pwd instead of a workspace path.
 *
 * The panel and the git-status poller both read a `Worktree` + `Repo` pair, and
 * a vertical tab is a folder workspace — which resolves to no repo at all, so
 * every git surface disables itself. Rather than thread a second path through
 * ~150 call sites in an 8k-line upstream file, terminal mode substitutes that
 * pair: the same workspace key (so tabs, status caches and diff tabs stay keyed
 * to the vertical tab) rooted at the repository enclosing the pwd.
 */
export type TerminalModeGitWorkspace = {
  /** Null when the pwd is outside every repository — the quiet empty state. */
  worktree: Worktree | null
  repo: Repo | null
  /** True while the repo lookup has not answered; panels wait instead of flashing. */
  pending: boolean
}

/** Synthetic and path-derived so two tabs in the same repo share caches keyed by it. */
export function terminalModeGitRepoId(repoRoot: string): string {
  return `terminal-mode-repo:${repoRoot}`
}

export function buildTerminalModeGitWorkspace(
  folderWorkspace: FolderWorkspace,
  repoRoot: string | null | undefined
): TerminalModeGitWorkspace {
  if (repoRoot === undefined) {
    return { worktree: null, repo: null, pending: true }
  }
  if (repoRoot === null) {
    return { worktree: null, repo: null, pending: false }
  }
  const repoId = terminalModeGitRepoId(repoRoot)
  return {
    worktree: { ...folderWorkspaceToWorktree(folderWorkspace), repoId, path: repoRoot },
    repo: {
      id: repoId,
      path: repoRoot,
      displayName: getRuntimePathBasename(repoRoot) || repoRoot,
      badgeColor: DEFAULT_REPO_BADGE_COLOR,
      addedAt: folderWorkspace.createdAt,
      // Why explicit: `kind` decides `isGitRepoKind`, which is what re-enables the
      // Source Control tab, the git-status poll and the diff actions.
      kind: 'git',
      connectionId: folderWorkspace.connectionId ?? null,
      ...(folderWorkspace.executionHostId
        ? { executionHostId: folderWorkspace.executionHostId }
        : {})
    },
    pending: false
  }
}
