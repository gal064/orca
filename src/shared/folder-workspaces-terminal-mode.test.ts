/**
 * Terminal-mode groups deliberately have no folder root, so the persisted-state
 * normalizer has to keep their workspaces anyway — otherwise every vertical tab
 * disappears on the next app load.
 */
import { describe, expect, it } from 'vitest'
import { normalizeFolderWorkspaces } from './folder-workspaces'
import { TERMINAL_MODE_GROUP_NAME } from './terminal-mode-group'
import type { ProjectGroup } from './types'

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

const terminalModeGroup = group({ id: 'hidden', name: TERMINAL_MODE_GROUP_NAME })

const vtab = {
  id: 'vtab',
  projectGroupId: 'hidden',
  name: 'orca',
  folderPath: '/home/dev/orca',
  terminalModeAutoName: false,
  createdAt: 5,
  updatedAt: 5
}

describe('normalizeFolderWorkspaces', () => {
  it('keeps vertical tabs whose group has no folder root', () => {
    const result = normalizeFolderWorkspaces([vtab], [terminalModeGroup])
    expect(result.map((entry) => entry.id)).toEqual(['vtab'])
    expect(result[0].folderPath).toBe('/home/dev/orca')
  })

  it('round-trips the pinned-name flag', () => {
    expect(normalizeFolderWorkspaces([vtab], [terminalModeGroup])[0].terminalModeAutoName).toBe(
      false
    )
    const auto = normalizeFolderWorkspaces(
      [{ ...vtab, terminalModeAutoName: undefined }],
      [terminalModeGroup]
    )[0]
    expect(auto.terminalModeAutoName).toBeUndefined()
  })

  it('still drops workspaces under an ordinary group with no folder root', () => {
    const classic = group({ id: 'classic', name: 'Work' })
    expect(normalizeFolderWorkspaces([{ ...vtab, projectGroupId: 'classic' }], [classic])).toEqual(
      []
    )
  })
})
