import { describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../shared/terminal-mode-group'
import { ensureTerminalModeGroup } from './terminal-mode-group'

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

describe('ensureTerminalModeGroup', () => {
  it('creates the hidden group once and reuses it', () => {
    const store = makeStore()

    const first = ensureTerminalModeGroup(store)
    const second = ensureTerminalModeGroup(store)

    expect(first.name).toBe(TERMINAL_MODE_GROUP_NAME)
    expect(second.id).toBe(first.id)
    expect(store.created).toBe(1)
  })

  it('invents no folder root — a vertical tab owns its own start directory', () => {
    // A fabricated parentPath would feed the authorized-filesystem scope and the
    // connection-id migration a directory the user never opened.
    const store = makeStore()
    expect(ensureTerminalModeGroup(store).parentPath).toBeNull()
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

    const local = ensureTerminalModeGroup(store)

    expect(local.id).not.toBe('ssh-group')
    expect(store.created).toBe(1)
  })

  it('keeps one hidden group per host, and never crosses them', () => {
    // A vertical tab's terminals live on its group's host, so a group minted for
    // one host must never be handed to another (docs/terminal-mode-design.md Phase 1).
    const store = makeStore()

    const local = ensureTerminalModeGroup(store, null)
    const ssh = ensureTerminalModeGroup(store, 'box')
    const sshAgain = ensureTerminalModeGroup(store, 'box')
    const otherSsh = ensureTerminalModeGroup(store, 'other')

    expect(local.connectionId).toBeNull()
    expect(ssh.connectionId).toBe('box')
    expect(sshAgain.id).toBe(ssh.id)
    expect(new Set([local.id, ssh.id, otherSsh.id]).size).toBe(3)
    expect(store.created).toBe(3)
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

    expect(ensureTerminalModeGroup(store).id).not.toBe('classic')
  })
})
