import { describe, expect, it, vi } from 'vitest'
import {
  getEditorExternalWatchTargets,
  type EditorExternalWatchTargetState
} from './useEditorExternalWatch'
import type { TerminalModePanelScope } from '@/store/slices/terminal-mode-panels'

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('@/components/editor/editor-autosave', () => ({
  notifyEditorExternalFileChange: vi.fn(),
  getOpenFilesForExternalFileChange: vi.fn(() => [])
}))

const WORKSPACE_KEY = 'folder:vtab-1'

const folderWorkspace = {
  id: 'vtab-1',
  projectGroupId: 'group-terminal',
  name: 'tab',
  folderPath: '/home/user',
  comment: '',
  linkedTask: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
} as EditorExternalWatchTargetState['folderWorkspaces'][number]

const projectGroup = {
  id: 'group-terminal',
  name: '__terminal-mode__',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
} as EditorExternalWatchTargetState['projectGroups'][number]

function makeState(
  scope: TerminalModePanelScope | null,
  rightSidebarTab: EditorExternalWatchTargetState['rightSidebarTab'] = 'explorer'
): EditorExternalWatchTargetState {
  return {
    openFiles: [],
    worktreesByRepo: {},
    repos: [],
    activeWorktreeId: WORKSPACE_KEY,
    rightSidebarOpen: true,
    rightSidebarTab,
    rightSidebarExplorerView: 'files',
    gitStatusHugeByWorktree: {},
    sshConnectionStates: new Map(),
    folderWorkspaces: [folderWorkspace],
    projectGroups: [projectGroup],
    settings: null,
    terminalModePanelScope: scope
  } as EditorExternalWatchTargetState
}

const scope: TerminalModePanelScope = {
  workspaceKey: WORKSPACE_KEY,
  root: '/repo/src',
  workspaceRoot: '/repo',
  repoRoot: '/repo',
  addressing: 'relative',
  clampedToWorkspaceRoot: false
}

describe('external watch targets in terminal mode', () => {
  it('watches the start folder when terminal mode owns no scope', () => {
    expect(
      getEditorExternalWatchTargets(makeState(null)).targets.map((t) => t.worktreePath)
    ).toEqual(['/home/user'])
  })

  it('watches the explorer root and the repo root instead of the start folder', () => {
    expect(
      getEditorExternalWatchTargets(makeState(scope)).targets.map((t) => t.worktreePath)
    ).toEqual(['/repo/src', '/repo'])
  })

  it('produces a new snapshot when the root moves, so the subscription is replaced', () => {
    const before = getEditorExternalWatchTargets(makeState(scope))
    const after = getEditorExternalWatchTargets(
      makeState({ ...scope, root: '/repo/lib', repoRoot: '/repo' })
    )
    expect(after).not.toBe(before)
    expect(after.targetsKey).not.toBe(before.targetsKey)
    expect(after.targets.map((t) => t.worktreePath)).toEqual(['/repo/lib', '/repo'])
  })

  it('collapses to one target when the pwd is the repo root', () => {
    expect(
      getEditorExternalWatchTargets(makeState({ ...scope, root: '/repo' })).targets.map(
        (t) => t.worktreePath
      )
    ).toEqual(['/repo'])
  })

  it('watches the panel roots while Source Control is the open surface', () => {
    // A vertical tab has no classic repo, so the git panel would otherwise be the
    // one open surface with no watcher at all.
    expect(
      getEditorExternalWatchTargets(makeState(scope, 'source-control')).targets.map(
        (t) => t.worktreePath
      )
    ).toEqual(['/repo/src', '/repo'])
  })

  it('installs no watcher for Source Control when the pwd is outside any repository', () => {
    expect(
      getEditorExternalWatchTargets(
        makeState({ ...scope, root: '/tmp', repoRoot: null }, 'source-control')
      ).targets
    ).toEqual([])
  })

  it('watches only the pwd outside any repository', () => {
    expect(
      getEditorExternalWatchTargets(
        makeState({ ...scope, root: '/tmp', repoRoot: null })
      ).targets.map((t) => t.worktreePath)
    ).toEqual(['/tmp'])
  })
})
