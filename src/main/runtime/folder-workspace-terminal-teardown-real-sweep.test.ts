/**
 * The companion suite mocks `killAllProcessesForWorktree` to assert routing. This one
 * runs the real sweep so the `folder:<id>@@<handle>` session-id contract — the only
 * thing that makes a folder workspace's daemon ptys reachable — is actually proven.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listRegisteredPtysMock } = vi.hoisted(() => ({ listRegisteredPtysMock: vi.fn() }))
vi.mock('../memory/pty-registry', () => ({ listRegisteredPtys: listRegisteredPtysMock }))

import type { IPtyProvider, PtyProcessInfo } from '../providers/types'
import { teardownFolderWorkspaceTerminals } from './folder-workspace-terminal-teardown'

function createProviderStub(listProcesses: () => Promise<PtyProcessInfo[]>): IPtyProvider {
  return {
    shutdown: vi.fn().mockResolvedValue(undefined),
    listProcesses: vi.fn(listProcesses)
  } as unknown as IPtyProvider
}

describe('teardownFolderWorkspaceTerminals (real sweep)', () => {
  beforeEach(() => {
    listRegisteredPtysMock.mockReset().mockReturnValue([])
  })

  it('kills the daemon sessions tagged with the workspace key and nothing else', async () => {
    const localProvider = createProviderStub(async () => [
      { id: 'folder:ws-1@@abcd1234', cwd: '/home/dev', title: 'shell' },
      { id: 'folder:ws-2@@efef5678', cwd: '/home/dev', title: 'shell' },
      { id: 'repo1::/w1@@1111aaaa', cwd: '/w1', title: 'shell' }
    ])

    await teardownFolderWorkspaceTerminals('ws-1', { getLocalProvider: () => localProvider })

    expect(localProvider.shutdown).toHaveBeenCalledWith(
      'folder:ws-1@@abcd1234',
      expect.objectContaining({ immediate: true })
    )
    expect(localProvider.shutdown).toHaveBeenCalledTimes(1)
  })

  it('kills registry-tracked ptys owned by the workspace key', async () => {
    const localProvider = createProviderStub(async () => [])
    listRegisteredPtysMock.mockReturnValue([
      { ptyId: 'pty-1', worktreeId: 'folder:ws-1', sessionId: null, paneKey: null, pid: 100 },
      { ptyId: 'pty-2', worktreeId: 'folder:ws-2', sessionId: null, paneKey: null, pid: 101 }
    ])

    await teardownFolderWorkspaceTerminals('ws-1', { getLocalProvider: () => localProvider })

    expect(localProvider.shutdown).toHaveBeenCalledWith(
      'pty-1',
      expect.objectContaining({ immediate: true })
    )
    expect(localProvider.shutdown).toHaveBeenCalledTimes(1)
  })

  it('resolves even when the provider hangs, so a delete can never wedge', async () => {
    const localProvider = createProviderStub(() => new Promise<PtyProcessInfo[]>(() => {}))

    vi.useFakeTimers()
    try {
      const settled = teardownFolderWorkspaceTerminals('ws-1', {
        getLocalProvider: () => localProvider
      })
      let done = false
      void settled.then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(11_000)
      await settled
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
