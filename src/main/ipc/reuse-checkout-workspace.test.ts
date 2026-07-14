import { describe, expect, it } from 'vitest'
import type { GitWorktreeInfo, Repo, WorktreeMeta } from '../../shared/types'
import {
  getReuseCheckoutWorkspaceInstanceId,
  isReuseCheckoutWorkspaceInstanceId,
  listReuseCheckoutWorkspaces,
  mergeReuseCheckoutWorkspace,
  pickReuseCheckoutTarget
} from './reuse-checkout-workspace'

const repo: Repo = {
  id: 'repo-1',
  path: '/workspace/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 0
} as Repo

function makeMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    displayName: '',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

const mainCheckout: GitWorktreeInfo = {
  path: '/workspace/repo',
  head: 'abc123',
  branch: 'refs/heads/main',
  isBare: false,
  isMainWorktree: true
}

describe('reuse-checkout-workspace ids', () => {
  it('builds an instance id under the repo checkout root with the folder separator', () => {
    const id = getReuseCheckoutWorkspaceInstanceId(repo, 'inst-1')
    expect(id).toBe('repo-1::/workspace/repo::workspace:inst-1')
    expect(isReuseCheckoutWorkspaceInstanceId(id)).toBe(true)
  })

  it('does not treat a plain path-derived worktree id as a reuse instance', () => {
    expect(isReuseCheckoutWorkspaceInstanceId('repo-1::/workspace/repo-feature')).toBe(false)
  })
})

describe('pickReuseCheckoutTarget', () => {
  it('prefers the main worktree', () => {
    const linked: GitWorktreeInfo = {
      path: '/workspace/repo-feature',
      head: 'def456',
      branch: 'refs/heads/feature',
      isBare: false,
      isMainWorktree: false
    }
    expect(pickReuseCheckoutTarget([linked, mainCheckout], repo.path)).toBe(mainCheckout)
  })

  it('falls back to a path match when no worktree is flagged main', () => {
    const atRepoPath: GitWorktreeInfo = { ...mainCheckout, isMainWorktree: false }
    expect(pickReuseCheckoutTarget([atRepoPath], repo.path)).toBe(atRepoPath)
  })

  it('returns undefined when nothing matches', () => {
    expect(pickReuseCheckoutTarget([], repo.path)).toBeUndefined()
  })
})

describe('mergeReuseCheckoutWorkspace', () => {
  it('keeps the reused checkout branch/head but is never the main worktree', () => {
    const id = getReuseCheckoutWorkspaceInstanceId(repo, 'inst-1')
    const worktree = mergeReuseCheckoutWorkspace(
      repo,
      id,
      makeMeta({ instanceId: 'inst-1', displayName: 'My Session' }),
      mainCheckout
    )
    expect(worktree.id).toBe(id)
    expect(worktree.path).toBe('/workspace/repo')
    expect(worktree.head).toBe('abc123')
    expect(worktree.branch).toBe('refs/heads/main')
    expect(worktree.isMainWorktree).toBe(false)
    expect(worktree.displayName).toBe('My Session')
  })
})

describe('listReuseCheckoutWorkspaces', () => {
  it('synthesizes rows only for reuse-checkout metas under this repo', () => {
    const reuseId = getReuseCheckoutWorkspaceInstanceId(repo, 'inst-1')
    const allMeta: Record<string, WorktreeMeta> = {
      [reuseId]: makeMeta({ instanceId: 'inst-1', reuseCheckout: true }),
      // A folder-style instance id without the reuseCheckout flag must be ignored.
      'repo-1::/workspace/repo::workspace:folderish': makeMeta({ instanceId: 'folderish' }),
      // A normal worktree meta must be ignored.
      'repo-1::/workspace/repo-feature': makeMeta({ reuseCheckout: true }),
      // Another repo's reuse instance must be ignored.
      'repo-2::/other::workspace:inst-2': makeMeta({ reuseCheckout: true })
    }
    const rows = listReuseCheckoutWorkspaces(allMeta, repo, mainCheckout)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(reuseId)
    expect(rows[0].branch).toBe('refs/heads/main')
    expect(rows[0].isMainWorktree).toBe(false)
  })

  it('returns nothing when no reuse-checkout metadata exists', () => {
    expect(listReuseCheckoutWorkspaces({}, repo, mainCheckout)).toEqual([])
  })
})
