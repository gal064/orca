// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'
import {
  LAST_CWD_PERSIST_DEBOUNCE_MS,
  useTerminalModeLastCwdPersistence
} from './use-terminal-mode-last-cwd'

const VTAB_KEY = 'folder:vtab-1'

const hiddenGroup: ProjectGroup = {
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
} as never

const vtab: FolderWorkspace = {
  id: 'vtab-1',
  projectGroupId: 'hidden',
  name: 'vtab-1',
  folderPath: '/home/dev',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  createdAt: 0,
  updatedAt: 0
} as never

function seedStore(overrides: Record<string, unknown> = {}): void {
  useAppStore.setState({
    projectGroups: [hiddenGroup],
    folderWorkspaces: [vtab],
    tabsByWorktree: {
      [VTAB_KEY]: [{ id: 'tab-1', worktreeId: VTAB_KEY, startupCwd: '/home/dev' } as never]
    },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    terminalLayoutsByTabId: {},
    cwdByPtyId: { 'pty-1': { cwd: '/tmp/work', source: 'osc7' } },
    ...overrides
  } as never)
}

function lastCwd(): string | undefined {
  return useAppStore.getState().tabsByWorktree[VTAB_KEY]?.[0]?.lastCwd
}

const getCwd = vi.fn(async () => '/tmp/work')

beforeEach(() => {
  vi.useFakeTimers()
  getCwd.mockClear()
  getCwd.mockResolvedValue('/tmp/work')
  ;(window as never as { api: unknown }).api = { pty: { getCwd } }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useAppStore.setState({
    projectGroups: [],
    folderWorkspaces: [],
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    cwdByPtyId: {}
  } as never)
})

describe('useTerminalModeLastCwdPersistence', () => {
  it('persists a corroborated pwd on the debounce, not on the `cd` itself', async () => {
    seedStore()
    renderHook(() => useTerminalModeLastCwdPersistence())

    expect(lastCwd()).toBeUndefined()
    expect(getCwd).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)

    expect(getCwd).toHaveBeenCalledWith('pty-1')
    expect(lastCwd()).toBe('/tmp/work')
  })

  it('persists what main read, not the reported OSC 7 path, and probes it once', async () => {
    // A local shell inside `ssh`/`docker` reports the remote shell's directory;
    // the corroborated read is the one that exists on this host.
    getCwd.mockResolvedValue('/home/dev')
    seedStore()
    const view = renderHook(() => useTerminalModeLastCwdPersistence())

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)
    expect(lastCwd()).toBe('/home/dev')

    // The tracked value still disagrees, which must not re-probe every window.
    view.rerender()
    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS * 4)
    expect(getCwd).toHaveBeenCalledTimes(1)
  })

  it('persists a poll-sourced pwd without a round trip', async () => {
    // The poll value already came from `pty.getCwd`, so it is corroborated.
    seedStore({ cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'poll' } } })
    renderHook(() => useTerminalModeLastCwdPersistence())

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)

    expect(getCwd).not.toHaveBeenCalled()
    expect(lastCwd()).toBe('/srv/app')
  })

  it('persists nothing when the host cannot corroborate the directory', async () => {
    getCwd.mockResolvedValue('')
    seedStore()
    renderHook(() => useTerminalModeLastCwdPersistence())

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)

    expect(lastCwd()).toBeUndefined()
  })

  it('persists nothing for a directory deleted under the shell', async () => {
    // `/proc/<pid>/cwd` resolves to "<path> (deleted)" there — a path that can
    // never be reopened, in either the OSC 7 or the polled arm.
    getCwd.mockResolvedValue('/tmp/gone (deleted)')
    seedStore()
    const view = renderHook(() => useTerminalModeLastCwdPersistence())
    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)
    expect(lastCwd()).toBeUndefined()

    view.unmount()
    seedStore({ cwdByPtyId: { 'pty-1': { cwd: '/tmp/gone (deleted)', source: 'poll' } } })
    renderHook(() => useTerminalModeLastCwdPersistence())
    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)
    expect(lastCwd()).toBeUndefined()
  })

  it('retries a failed probe on the next window instead of marking it done', async () => {
    getCwd.mockRejectedValueOnce(new Error('pty gone')).mockResolvedValue('/tmp/work')
    seedStore()
    renderHook(() => useTerminalModeLastCwdPersistence())

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)
    expect(lastCwd()).toBeUndefined()

    // A second tab moving re-arms the window; the failure must not be sticky.
    act(() => {
      useAppStore.setState({
        tabsByWorktree: {
          [VTAB_KEY]: [
            { id: 'tab-1', worktreeId: VTAB_KEY, startupCwd: '/home/dev' },
            { id: 'tab-2', worktreeId: VTAB_KEY, startupCwd: '/home/dev' }
          ]
        },
        ptyIdsByTabId: { 'tab-1': ['pty-1'], 'tab-2': ['pty-2'] },
        cwdByPtyId: {
          'pty-1': { cwd: '/tmp/work', source: 'osc7' },
          'pty-2': { cwd: '/srv/app', source: 'poll' }
        }
      } as never)
    })
    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS)
    expect(lastCwd()).toBe('/tmp/work')
  })

  it('never writes for a workspace outside terminal mode', async () => {
    seedStore({ projectGroups: [], folderWorkspaces: [] })
    renderHook(() => useTerminalModeLastCwdPersistence())

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS * 2)

    expect(getCwd).not.toHaveBeenCalled()
    expect(lastCwd()).toBeUndefined()
  })

  it('never writes for a remote-runtime PTY, whose restart story is reattach', async () => {
    seedStore({
      ptyIdsByTabId: { 'tab-1': ['remote:env-1@@terminal-1'] },
      cwdByPtyId: { 'remote:env-1@@terminal-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    renderHook(() => useTerminalModeLastCwdPersistence())

    await vi.advanceTimersByTimeAsync(LAST_CWD_PERSIST_DEBOUNCE_MS * 2)

    expect(getCwd).not.toHaveBeenCalled()
    expect(lastCwd()).toBeUndefined()
  })
})
