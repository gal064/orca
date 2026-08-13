import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPtyProvider } from '../providers/types'

const killAllProcessesForWorktree = vi.fn(
  async (_worktreeId: string, _deps: Record<string, unknown>) => ({
    runtimeStopped: 0,
    providerStopped: 0,
    registryStopped: 0
  })
)

vi.mock('./worktree-teardown', () => ({ killAllProcessesForWorktree }))

const { getFolderWorkspaceIdsInProjectGroups, teardownFolderWorkspaceTerminals } =
  await import('./folder-workspace-terminal-teardown')

const localProvider = { id: 'local' } as unknown as IPtyProvider
const sshProvider = { id: 'ssh' } as unknown as IPtyProvider

describe('teardownFolderWorkspaceTerminals', () => {
  beforeEach(() => {
    killAllProcessesForWorktree.mockClear()
  })

  it('sweeps the workspace key so the deleted workspace cannot strand its ptys', async () => {
    await teardownFolderWorkspaceTerminals('ws-1', { getLocalProvider: () => localProvider })

    expect(killAllProcessesForWorktree).toHaveBeenCalledTimes(1)
    const [worktreeId, deps] = killAllProcessesForWorktree.mock.calls[0]
    expect(worktreeId).toBe('folder:ws-1')
    expect(deps.resolvedWorktreeId).toBe('folder:ws-1')
    expect(deps.localProvider).toBe(localProvider)
    expect(deps.resolvedConnectionId).toBeUndefined()
    expect(deps.includeLocalRegistry).toBeUndefined()
  })

  it('routes an SSH-owned workspace to its own provider and skips the local registry', async () => {
    await teardownFolderWorkspaceTerminals('ws-2', {
      connectionId: 'box',
      getLocalProvider: () => localProvider,
      getSshProvider: () => sshProvider
    })

    const [, deps] = killAllProcessesForWorktree.mock.calls[0]
    expect(deps.localProvider).toBe(sshProvider)
    expect(deps.resolvedConnectionId).toBe('box')
    expect(deps.includeProviderInventory).toBe(true)
    expect(deps.includeLocalRegistry).toBe(false)
  })

  it('does nothing when no provider is installed', async () => {
    await teardownFolderWorkspaceTerminals('ws-3', { getLocalProvider: () => null })
    expect(killAllProcessesForWorktree).not.toHaveBeenCalled()
  })

  it('never lets a wedged sweep block the delete the user asked for', async () => {
    killAllProcessesForWorktree.mockRejectedValueOnce(new Error('provider wedged'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      teardownFolderWorkspaceTerminals('ws-4', { getLocalProvider: () => localProvider })
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('getFolderWorkspaceIdsInProjectGroups', () => {
  it('collects every workspace under the deleted group subtree', () => {
    const workspaces = [
      { id: 'a', projectGroupId: 'g1' },
      { id: 'b', projectGroupId: 'g2' },
      { id: 'c', projectGroupId: 'other' }
    ]
    expect(getFolderWorkspaceIdsInProjectGroups(workspaces, new Set(['g1', 'g2']))).toEqual([
      'a',
      'b'
    ])
  })
})
