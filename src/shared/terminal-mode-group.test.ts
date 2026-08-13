import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from './types'
import {
  TERMINAL_MODE_GROUP_NAME,
  excludeTerminalModeFolderWorkspaces,
  excludeTerminalModeGroups,
  findTerminalModeGroupForHost,
  getTerminalModeGroupIds,
  isTerminalModeGroup
} from './terminal-mode-group'

function group(overrides: Partial<ProjectGroup> & { id: string }): ProjectGroup {
  return {
    name: 'Group',
    parentPath: null,
    connectionId: null,
    executionHostId: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function workspace(id: string, projectGroupId: string): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: `/tmp/${id}`,
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
}

describe('isTerminalModeGroup', () => {
  it('matches only the reserved group name', () => {
    expect(isTerminalModeGroup(group({ id: 'a', name: TERMINAL_MODE_GROUP_NAME }))).toBe(true)
    expect(isTerminalModeGroup(group({ id: 'b', name: 'Work' }))).toBe(false)
    expect(isTerminalModeGroup(null)).toBe(false)
    expect(isTerminalModeGroup(undefined)).toBe(false)
  })
})

describe('findTerminalModeGroupForHost', () => {
  it('keys hidden groups per host', () => {
    const local = group({ id: 'local-group', name: TERMINAL_MODE_GROUP_NAME })
    const ssh = group({ id: 'ssh-group', name: TERMINAL_MODE_GROUP_NAME, connectionId: 'box' })
    const remote = group({
      id: 'remote-group',
      name: TERMINAL_MODE_GROUP_NAME,
      executionHostId: 'runtime:omarchy'
    })
    const groups = [local, ssh, remote]

    expect(findTerminalModeGroupForHost(groups, 'local')).toBe(local)
    expect(findTerminalModeGroupForHost(groups, 'ssh:box')).toBe(ssh)
    expect(findTerminalModeGroupForHost(groups, 'runtime:omarchy')).toBe(remote)
    expect(findTerminalModeGroupForHost(groups, 'ssh:other')).toBeUndefined()
  })

  it('ignores same-host groups that are not terminal-mode groups', () => {
    const classic = group({ id: 'classic', name: 'Work' })
    expect(findTerminalModeGroupForHost([classic], 'local')).toBeUndefined()
  })
})

describe('classic-surface exclusion', () => {
  const hidden = group({ id: 'hidden', name: TERMINAL_MODE_GROUP_NAME })
  const classic = group({ id: 'classic', name: 'Work' })

  it('collects hidden group ids', () => {
    expect([...getTerminalModeGroupIds([hidden, classic])]).toEqual(['hidden'])
  })

  it('drops hidden groups from classic lists', () => {
    expect(excludeTerminalModeGroups([hidden, classic])).toEqual([classic])
  })

  it('keeps the input reference when there is nothing to hide', () => {
    const groups = [classic]
    expect(excludeTerminalModeGroups(groups)).toBe(groups)
  })

  it('drops folder workspaces owned by a hidden group', () => {
    const vtab = workspace('vtab', 'hidden')
    const folder = workspace('folder', 'classic')
    expect(excludeTerminalModeFolderWorkspaces([vtab, folder], [hidden, classic])).toEqual([folder])
  })

  it('keeps the folder workspace reference when no hidden group exists', () => {
    const workspaces = [workspace('folder', 'classic')]
    expect(excludeTerminalModeFolderWorkspaces(workspaces, [classic])).toBe(workspaces)
  })
})
