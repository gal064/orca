import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace, WorktreeMeta } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'

const electronMocks = vi.hoisted(() => ({
  BrowserWindow: { fromId: vi.fn((_id: number): unknown => null) },
  webContents: { fromId: vi.fn((_id: number): unknown => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))

vi.mock('electron', () => electronMocks)

const WORKTREE_ID = 'repo-1::/repo/worktree'
const PANE_KEY = '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222'

type TestStatus = Parameters<OrcaRuntimeService['observeAgentStatusForHeadlessUnread']>[0]

function status(overrides: Partial<TestStatus> = {}): TestStatus {
  return {
    paneKey: PANE_KEY,
    worktreeId: WORKTREE_ID,
    state: 'done' as const,
    stateStartedAt: 100,
    receivedAt: 200,
    ...overrides
  }
}

function worktreeRuntime() {
  let meta = { isUnread: false } as WorktreeMeta
  const setWorktreeMeta = vi.fn((_worktreeId: string, updates: Partial<WorktreeMeta>) => {
    meta = { ...meta, ...updates }
    return meta
  })
  const runtime = new OrcaRuntimeService({
    getWorktreeMeta: (worktreeId: string) => (worktreeId === WORKTREE_ID ? meta : undefined),
    setWorktreeMeta
  } as never)
  const worktreesChanged = vi.fn()
  runtime.setNotifier({ worktreesChanged } as never)
  return {
    runtime,
    setRead: () => {
      meta = { ...meta, isUnread: false }
    },
    setWorktreeMeta,
    worktreesChanged
  }
}

describe('headless agent unread', () => {
  beforeEach(() => {
    electronMocks.BrowserWindow.fromId.mockReset()
    electronMocks.BrowserWindow.fromId.mockReturnValue(null)
  })

  it('marks a completed worktree unread and invalidates the mobile summary', () => {
    const { runtime, setWorktreeMeta, worktreesChanged } = worktreeRuntime()

    expect(runtime.observeAgentStatusForHeadlessUnread(status())).toBe(true)
    expect(setWorktreeMeta).toHaveBeenCalledWith(WORKTREE_ID, {
      isUnread: true,
      lastActivityAt: 200
    })
    expect(worktreesChanged).toHaveBeenCalledWith('repo-1')
  })

  it('does not resurrect an acknowledged turn but marks a later turn', () => {
    const { runtime, setRead, setWorktreeMeta } = worktreeRuntime()

    expect(runtime.observeAgentStatusForHeadlessUnread(status())).toBe(true)
    setRead()
    expect(runtime.observeAgentStatusForHeadlessUnread(status())).toBe(false)
    expect(
      runtime.observeAgentStatusForHeadlessUnread(status({ stateStartedAt: 300, receivedAt: 400 }))
    ).toBe(true)
    expect(setWorktreeMeta).toHaveBeenCalledTimes(2)
  })

  it('ignores replay and leaves renderer-owned visibility semantics unchanged', () => {
    const replay = worktreeRuntime()
    expect(replay.runtime.observeAgentStatusForHeadlessUnread(status({ isReplay: true }))).toBe(
      false
    )
    expect(replay.setWorktreeMeta).not.toHaveBeenCalled()

    const attached = worktreeRuntime()
    electronMocks.BrowserWindow.fromId.mockReturnValue({ isDestroyed: () => false })
    attached.runtime.attachWindow(1)
    attached.runtime.markGraphReady(1)
    expect(attached.runtime.observeAgentStatusForHeadlessUnread(status())).toBe(false)
    expect(attached.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('marks folder workspaces unread through their owning store path', () => {
    let workspace = { id: 'folder-1', isUnread: false } as FolderWorkspace
    const updateFolderWorkspace = vi.fn(
      (_id: string, updates: Partial<FolderWorkspace>): FolderWorkspace => {
        workspace = { ...workspace, ...updates }
        return workspace
      }
    )
    const runtime = new OrcaRuntimeService({
      getFolderWorkspaces: () => [workspace],
      updateFolderWorkspace
    } as never)
    const reposChanged = vi.fn()
    runtime.setNotifier({ reposChanged } as never)

    expect(
      runtime.observeAgentStatusForHeadlessUnread(status({ worktreeId: 'folder:folder-1' }))
    ).toBe(true)
    expect(updateFolderWorkspace).toHaveBeenCalledWith('folder-1', {
      isUnread: true,
      lastActivityAt: 200
    })
    expect(reposChanged).toHaveBeenCalledOnce()
  })
})
