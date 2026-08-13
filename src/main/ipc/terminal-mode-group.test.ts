import { describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../shared/terminal-mode-group'
import { ensureLocalTerminalModeGroup } from './terminal-mode-group'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))

function makeStore(initial: ProjectGroup[] = []): {
  getProjectGroups: () => ProjectGroup[]
  createProjectGroup: (input: {
    name: string
    parentPath?: string | null
    connectionId?: string | null
    parentGroupId?: string | null
    createdFrom: ProjectGroup['createdFrom']
  }) => ProjectGroup
  created: number
} {
  const groups = [...initial]
  const store = {
    getProjectGroups: () => groups,
    createProjectGroup: (input: {
      name: string
      parentPath?: string | null
      connectionId?: string | null
      parentGroupId?: string | null
      createdFrom: ProjectGroup['createdFrom']
    }): ProjectGroup => {
      const group: ProjectGroup = {
        id: `group-${groups.length + 1}`,
        name: input.name,
        parentPath: input.parentPath ?? null,
        connectionId: input.connectionId ?? null,
        executionHostId: null,
        parentGroupId: input.parentGroupId ?? null,
        createdFrom: input.createdFrom,
        tabOrder: groups.length,
        isCollapsed: false,
        color: null,
        createdAt: 0,
        updatedAt: 0
      }
      groups.push(group)
      store.created += 1
      return group
    },
    created: 0
  }
  return store
}

describe('ensureLocalTerminalModeGroup', () => {
  it('creates the hidden group once and reuses it', () => {
    const store = makeStore()

    const first = ensureLocalTerminalModeGroup(store)
    const second = ensureLocalTerminalModeGroup(store)

    expect(first.name).toBe(TERMINAL_MODE_GROUP_NAME)
    expect(second.id).toBe(first.id)
    expect(store.created).toBe(1)
  })

  it('invents no folder root — a vertical tab owns its own start directory', () => {
    // A fabricated parentPath would feed the authorized-filesystem scope and the
    // connection-id migration a directory the user never opened.
    const store = makeStore()
    expect(ensureLocalTerminalModeGroup(store).parentPath).toBeNull()
  })

  it('never reuses another host’s hidden group', () => {
    const store = makeStore([
      {
        id: 'ssh-group',
        name: TERMINAL_MODE_GROUP_NAME,
        parentPath: '/home/remote',
        connectionId: 'box',
        executionHostId: null,
        parentGroupId: null,
        createdFrom: 'manual',
        tabOrder: 0,
        isCollapsed: false,
        color: null,
        createdAt: 0,
        updatedAt: 0
      }
    ])

    const local = ensureLocalTerminalModeGroup(store)

    expect(local.id).not.toBe('ssh-group')
    expect(store.created).toBe(1)
  })

  it('does not adopt a classic group that merely exists locally', () => {
    const store = makeStore([
      {
        id: 'classic',
        name: 'Work',
        parentPath: '/work',
        connectionId: null,
        executionHostId: null,
        parentGroupId: null,
        createdFrom: 'manual',
        tabOrder: 0,
        isCollapsed: false,
        color: null,
        createdAt: 0,
        updatedAt: 0
      }
    ])

    expect(ensureLocalTerminalModeGroup(store).id).not.toBe('classic')
  })
})
