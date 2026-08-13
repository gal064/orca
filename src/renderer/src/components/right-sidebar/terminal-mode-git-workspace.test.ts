import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/types'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { buildTerminalModeGitWorkspace } from './terminal-mode-git-workspace'

const vtab: FolderWorkspace = {
  id: 'vtab-1',
  projectGroupId: 'group-terminal',
  name: 'orca',
  folderPath: '/home/user',
  comment: '',
  linkedTask: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 1,
  createdAt: 42,
  updatedAt: 1
}

describe('buildTerminalModeGitWorkspace', () => {
  it('roots the workspace pair at the repository enclosing the pwd', () => {
    const result = buildTerminalModeGitWorkspace(vtab, '/dev/orca')
    expect(result.pending).toBe(false)
    expect(result.worktree?.path).toBe('/dev/orca')
    // The workspace key is unchanged, so tabs, status caches and diff tabs stay
    // keyed to the vertical tab.
    expect(result.worktree?.id).toBe('folder:vtab-1')
    expect(result.repo?.path).toBe('/dev/orca')
    expect(result.repo?.displayName).toBe('orca')
    expect(result.repo && isGitRepoKind(result.repo)).toBe(true)
    expect(result.worktree?.repoId).toBe(result.repo?.id)
  })

  it('reports the empty state when the pwd is outside every repository', () => {
    expect(buildTerminalModeGitWorkspace(vtab, null)).toEqual({
      worktree: null,
      repo: null,
      pending: false
    })
  })

  it('reports pending while the repo lookup has not answered', () => {
    expect(buildTerminalModeGitWorkspace(vtab, undefined)).toEqual({
      worktree: null,
      repo: null,
      pending: true
    })
  })

  it('gives two tabs in the same repository the same synthetic repo id', () => {
    const first = buildTerminalModeGitWorkspace(vtab, '/dev/orca')
    const second = buildTerminalModeGitWorkspace({ ...vtab, id: 'vtab-2' }, '/dev/orca')
    expect(first.repo?.id).toBe(second.repo?.id)
  })
})
