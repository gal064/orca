/**
 * The Activity page reads one map to answer three questions: what to call a thread's
 * workspace, whether "jump to workspace" is live, and whether to mount the pane preview.
 * Built from `worktreesByRepo` alone it answers all three wrongly for a vertical tab —
 * "Standalone terminal", no jump, no preview — which would make the terminal-mode sidebar
 * bell lead to a list it cannot act on.
 */
import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'
import { selectActivityWorktreeMap } from './activity-workspace-rows'

const HIDDEN: ProjectGroup = {
  id: 'hidden',
  name: TERMINAL_MODE_GROUP_NAME,
  parentPath: null,
  connectionId: null,
  executionHostId: 'local',
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
}

const VTAB: FolderWorkspace = {
  id: 'vtab-1',
  projectGroupId: 'hidden',
  name: 'deploy',
  folderPath: '/home/dev/app',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  createdAt: 0,
  updatedAt: 0
}

function stateWith(experimentalTerminalMode: boolean) {
  return {
    worktreesByRepo: {},
    projectGroups: [HIDDEN],
    folderWorkspaces: [VTAB],
    settings: { experimentalTerminalMode }
  } as never
}

describe('the Activity page workspace index', () => {
  it('names a vertical tab instead of calling it a standalone terminal', () => {
    const map = selectActivityWorktreeMap(stateWith(true))

    expect(map.get('folder:vtab-1')?.displayName).toBe('deploy')
  })

  it('makes the jump action and the pane preview reachable — both gate on `has`', () => {
    expect(selectActivityWorktreeMap(stateWith(true)).has('folder:vtab-1')).toBe(true)
  })

  it('leaves the classic map untouched with the flag off', () => {
    const state = stateWith(false)
    const map = selectActivityWorktreeMap(state)

    expect(map.has('folder:vtab-1')).toBe(false)
  })

  it('returns the same Map identity for the same inputs', () => {
    // It runs inside a `useShallow`; a fresh Map per store write would spin `getSnapshot`.
    const state = stateWith(true)

    expect(selectActivityWorktreeMap(state)).toBe(selectActivityWorktreeMap(state))
  })
})
