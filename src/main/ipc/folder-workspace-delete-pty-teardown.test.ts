/**
 * Deleting a folder workspace used to prune persisted state only, leaving its ptys
 * running with nothing left referencing them (docs/terminal-mode-design.md, resolved
 * question 6). The delete handler must sweep them, and must do so before the store
 * drop — the sweep resolves the workspace's host from the row it is about to remove.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, mockStore } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  mockStore: {
    getRepos: vi.fn().mockReturnValue([]),
    removeFolderWorkspace: vi.fn().mockReturnValue(true),
    deleteProjectGroup: vi.fn().mockReturnValue(true)
  }
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))
vi.mock('../git/repo', () => ({
  isGitRepo: vi.fn().mockReturnValue(true),
  getRepoName: vi.fn(),
  getBaseRefDefault: vi.fn().mockResolvedValue('origin/main'),
  searchBaseRefs: vi.fn().mockResolvedValue([]),
  BASE_REF_SEARCH_ARGS: ['for-each-ref'],
  filterBaseRefSearchOutput: vi.fn().mockReturnValue([])
}))
vi.mock('./filesystem-auth', () => ({ invalidateAuthorizedRootsCache: vi.fn() }))
vi.mock('../providers/ssh-git-dispatch', () => ({ getSshGitProvider: vi.fn() }))
vi.mock('./ssh', () => ({ getActiveMultiplexer: vi.fn() }))

const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }

async function registerHandlers(teardown?: {
  teardownFolderWorkspaceTerminals?: (folderWorkspaceId: string) => Promise<void>
  teardownProjectGroupTerminals?: (projectGroupId: string) => Promise<void>
}): Promise<void> {
  vi.resetModules()
  const repos = await import('./repos')
  repos.registerRepoHandlers(mainWindow as never, mockStore as never)
  if (teardown) {
    repos.setFolderWorkspaceTerminalTeardown(teardown as never)
  }
}

beforeEach(() => {
  handlers.clear()
  handleMock.mockReset()
  handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
    handlers.set(channel, handler)
  })
  mockStore.removeFolderWorkspace.mockClear().mockReturnValue(true)
  mockStore.deleteProjectGroup.mockClear().mockReturnValue(true)
})

describe('folderWorkspaces:delete pty teardown', () => {
  it('kills the workspace ptys before dropping it from the store', async () => {
    const order: string[] = []
    mockStore.removeFolderWorkspace.mockImplementation(() => {
      order.push('store-remove')
      return true
    })
    await registerHandlers({
      teardownFolderWorkspaceTerminals: async (id) => {
        order.push(`teardown:${id}`)
      }
    })

    await expect(
      handlers.get('folderWorkspaces:delete')!(null, { folderWorkspaceId: 'ws-1' })
    ).resolves.toBe(true)

    expect(order).toEqual(['teardown:ws-1', 'store-remove'])
  })

  it('still deletes when no teardown is wired (headless registration order)', async () => {
    await registerHandlers()

    await expect(
      handlers.get('folderWorkspaces:delete')!(null, { folderWorkspaceId: 'ws-2' })
    ).resolves.toBe(true)
    expect(mockStore.removeFolderWorkspace).toHaveBeenCalledWith('ws-2')
  })

  it('rejects malformed args before touching the store', async () => {
    const teardownFolderWorkspaceTerminals = vi.fn(async () => {})
    await registerHandlers({ teardownFolderWorkspaceTerminals })

    await expect(handlers.get('folderWorkspaces:delete')!(null, {})).rejects.toThrow()
    expect(teardownFolderWorkspaceTerminals).not.toHaveBeenCalled()
    expect(mockStore.removeFolderWorkspace).not.toHaveBeenCalled()
  })
})

describe('projectGroups:delete pty teardown', () => {
  it('sweeps the cascaded folder workspaces before the group is dropped', async () => {
    const order: string[] = []
    mockStore.deleteProjectGroup.mockImplementation(() => {
      order.push('store-delete-group')
      return true
    })
    await registerHandlers({
      teardownProjectGroupTerminals: async (id) => {
        order.push(`teardown:${id}`)
      }
    })

    await expect(handlers.get('projectGroups:delete')!(null, { groupId: 'group-1' })).resolves.toBe(
      true
    )

    expect(order).toEqual(['teardown:group-1', 'store-delete-group'])
  })

  it('still deletes when no teardown is wired', async () => {
    await registerHandlers()

    await expect(handlers.get('projectGroups:delete')!(null, { groupId: 'group-2' })).resolves.toBe(
      true
    )
    expect(mockStore.deleteProjectGroup).toHaveBeenCalledWith('group-2')
  })
})

describe('reserved project-group name', () => {
  it('refuses to create or rename a group to the terminal-mode sentinel', async () => {
    await registerHandlers()

    expect(() =>
      handlers.get('projectGroups:create')!(null, { name: '__terminal-mode__' })
    ).toThrow('project_group_name_reserved')
    expect(() =>
      handlers.get('projectGroups:update')!(null, {
        groupId: 'g',
        updates: { name: '  __terminal-mode__  ' }
      })
    ).toThrow('project_group_name_reserved')
  })
})
