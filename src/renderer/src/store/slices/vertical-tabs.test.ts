import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'

vi.mock('@/lib/renderer-app-platform', () => ({ getRendererAppPlatform: () => 'linux' }))

const {
  ensureTerminalModeHostContext,
  ensureSshTargetConnectedForVerticalTab,
  toastError,
  terminalModeHostOptions
} = vi.hoisted(() => ({
  ensureTerminalModeHostContext: vi.fn(),
  ensureSshTargetConnectedForVerticalTab: vi.fn(),
  toastError: vi.fn(),
  terminalModeHostOptions: {
    current: [] as { id: string; label: string; detail: string; supported: boolean }[]
  }
}))
vi.mock('../terminal-mode-host-context', () => ({ ensureTerminalModeHostContext }))
vi.mock('../terminal-mode-ssh-connect', () => ({ ensureSshTargetConnectedForVerticalTab }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/lib/terminal-mode-host-options', () => ({
  selectTerminalModeHostOptions: () => terminalModeHostOptions.current
}))
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'
import {
  createVerticalTabsSlice,
  getVerticalTabAutoName,
  pickNextVerticalTabId,
  selectVerticalTabs
} from './vertical-tabs'

function group(id: string, name: string): ProjectGroup {
  return {
    id,
    name,
    parentPath: '/home/dev',
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
}

function tab(
  id: string,
  projectGroupId: string,
  createdAt: number,
  overrides: Partial<FolderWorkspace> = {}
): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: `/home/dev/${id}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

const hidden = group('hidden', TERMINAL_MODE_GROUP_NAME)
const classic = group('classic', 'Work')

describe('selectVerticalTabs', () => {
  it('orders vertical tabs oldest first so a new tab appends to the strip', () => {
    const tabs = selectVerticalTabs(
      [tab('c', 'hidden', 30), tab('a', 'hidden', 10), tab('b', 'hidden', 20)],
      [hidden]
    )
    expect(tabs.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks createdAt ties deterministically', () => {
    const tabs = selectVerticalTabs([tab('b', 'hidden', 5), tab('a', 'hidden', 5)], [hidden])
    expect(tabs.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('excludes classic folder workspaces', () => {
    const tabs = selectVerticalTabs(
      [tab('vtab', 'hidden', 1), tab('folder', 'classic', 2)],
      [hidden, classic]
    )
    expect(tabs.map((entry) => entry.id)).toEqual(['vtab'])
  })

  it('keeps an archived vertical tab, which would otherwise be invisible and unclosable', () => {
    const tabs = selectVerticalTabs(
      [tab('vtab', 'hidden', 1), tab('archived', 'hidden', 2, { isArchived: true })],
      [hidden]
    )
    expect(tabs.map((entry) => entry.id)).toEqual(['vtab', 'archived'])
  })

  it('is empty when no hidden group exists', () => {
    expect(selectVerticalTabs([tab('folder', 'classic', 1)], [classic])).toEqual([])
    expect(selectVerticalTabs(undefined, undefined)).toEqual([])
  })

  it('does not mutate the store array it filters from', () => {
    const source = [tab('c', 'hidden', 30), tab('a', 'hidden', 10)]
    selectVerticalTabs(source, [hidden])
    expect(source.map((entry) => entry.id)).toEqual(['c', 'a'])
  })
})

describe('pickNextVerticalTabId', () => {
  const tabs = [tab('a', 'hidden', 1), tab('b', 'hidden', 2), tab('c', 'hidden', 3)]

  it('prefers the right-hand neighbour', () => {
    expect(pickNextVerticalTabId(tabs, 'b')).toBe('c')
  })

  it('falls back to the left neighbour for the last tab', () => {
    expect(pickNextVerticalTabId(tabs, 'c')).toBe('b')
  })

  it('returns null when the closed tab was the only one or is unknown', () => {
    expect(pickNextVerticalTabId([tabs[0]], 'a')).toBeNull()
    expect(pickNextVerticalTabId(tabs, 'missing')).toBeNull()
  })
})

describe('getVerticalTabAutoName', () => {
  it('uses the basename of the start directory', () => {
    expect(getVerticalTabAutoName('/home/dev/orca')).toBe('orca')
    expect(getVerticalTabAutoName('/home/dev/orca/')).toBe('orca')
    expect(getVerticalTabAutoName('C:\\Users\\dev\\orca')).toBe('orca')
  })

  it('falls back to the raw path when there is no basename', () => {
    expect(getVerticalTabAutoName('/')).toBe('/')
  })
})

describe('closeVerticalTabIfEmptied', () => {
  function makeStore(overrides: Record<string, unknown> = {}) {
    const state: Record<string, unknown> = {
      settings: { experimentalTerminalMode: true },
      projectGroups: [hidden],
      folderWorkspaces: [tab('vtab', 'hidden', 1)],
      activeWorkspaceKey: 'folder:vtab',
      closeVerticalTab: vi.fn(async () => {}),
      ...overrides
    }
    const get = () => state as never
    const set = () => {}
    const slice = createVerticalTabsSlice(set as never, get as never, undefined as never)
    return { slice, state }
  }

  it('closes the vertical tab whose workspace a user close emptied', async () => {
    const { slice, state } = makeStore()
    slice.closeVerticalTabIfEmptied('folder:vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).toHaveBeenCalledWith('vtab', { wasActive: true })
  })

  it('does nothing with the experimental flag off', async () => {
    const { slice, state } = makeStore({ settings: {} })
    slice.closeVerticalTabIfEmptied('folder:vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).not.toHaveBeenCalled()
  })

  it('ignores classic worktrees and folder workspaces that are not vertical tabs', async () => {
    const { slice, state } = makeStore()
    slice.closeVerticalTabIfEmptied('worktree:repo::/w1')
    slice.closeVerticalTabIfEmptied('folder:not-a-vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).not.toHaveBeenCalled()
  })

  it('reports a background vertical tab as not active', async () => {
    const { slice, state } = makeStore({ activeWorkspaceKey: 'worktree:other' })
    slice.closeVerticalTabIfEmptied('folder:vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).toHaveBeenCalledWith('vtab', { wasActive: false })
  })

  it('trusts the caller over the store rather than inferring the focused tab', async () => {
    // The caller reports `wasActive` because only it knows: `closeUnifiedTab` used to
    // null activeWorkspaceKey before this ran, and since Phase 8 it deliberately does
    // not for a vertical tab — inferring here would be wrong in one era or the other.
    const { slice, state } = makeStore({ activeWorkspaceKey: null })
    slice.closeVerticalTabIfEmptied('folder:vtab', { wasActive: true })
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).toHaveBeenCalledWith('vtab', { wasActive: true })
  })
})

describe('createVerticalTab', () => {
  function makeStore(overrides: Record<string, unknown> = {}) {
    const createFolderWorkspace = vi.fn(async () => ({ id: 'new-vtab' }))
    const activateVerticalTab = vi.fn()
    const setSshConnectionState = vi.fn()
    // Applies patches, so the in-flight counter the "+" controls read is observable here.
    const setState = vi.fn((updater: unknown) => {
      const patch =
        typeof updater === 'function' ? (updater as (s: unknown) => object)(state) : updater
      Object.assign(state, patch)
    })
    const state: Record<string, unknown> = {
      settings: { experimentalTerminalMode: true },
      verticalTabCreatesInFlight: 0,
      setSshConnectionState,
      projectGroups: [hidden],
      folderWorkspaces: [tab('vtab', 'hidden', 1)],
      activeWorkspaceKey: 'folder:vtab',
      activeTabIdByWorktree: { 'folder:vtab': 'tab-1' },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      terminalLayoutsByTabId: {},
      unifiedTabsByWorktree: {},
      lastTerminalTabIdByWorkspace: {},
      cwdByPtyId: {},
      sshConnectionStates: new Map(),
      createFolderWorkspace,
      activateVerticalTab,
      ...overrides
    }
    const get = () => state as never
    const slice = createVerticalTabsSlice(setState as never, get as never, undefined as never)
    return { slice, createFolderWorkspace, activateVerticalTab, setSshConnectionState, state }
  }

  beforeEach(() => {
    ensureTerminalModeHostContext.mockReset()
    toastError.mockReset()
    ensureSshTargetConnectedForVerticalTab.mockReset()
    ensureSshTargetConnectedForVerticalTab.mockResolvedValue(undefined)
    ensureTerminalModeHostContext.mockResolvedValue({ projectGroup: hidden, homeDir: '/home/dev' })
    terminalModeHostOptions.current = [
      { id: 'local', label: 'Local', detail: 'This computer', supported: true },
      { id: 'runtime:env-1', label: 'Server', detail: 'Orca server', supported: true }
    ]
  })

  it('inherits the focused terminal pwd (ghostty-style)', async () => {
    const { slice, createFolderWorkspace } = makeStore({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    await slice.createVerticalTab()
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/srv/app', name: 'app' }),
      expect.anything()
    )
  })

  it('falls back to the host home directory when nothing is focused', async () => {
    const { slice, createFolderWorkspace } = makeStore({ activeWorkspaceKey: null })
    await slice.createVerticalTab()
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/home/dev' }),
      expect.anything()
    )
  })

  it('prefers an explicit start directory over the focused pwd', async () => {
    const { slice, createFolderWorkspace } = makeStore({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    await slice.createVerticalTab({ startDir: '/explicit' })
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/explicit' }),
      expect.anything()
    )
  })

  it('ensures the hidden group on the host before creating the workspace there', async () => {
    const remoteGroup = { ...group('hidden-remote', TERMINAL_MODE_GROUP_NAME) }
    ensureTerminalModeHostContext.mockResolvedValue({
      projectGroup: remoteGroup,
      homeDir: '/home/remote'
    })
    const { slice, createFolderWorkspace } = makeStore({ activeWorkspaceKey: null })
    await slice.createVerticalTab({ hostId: 'runtime:env-1' })
    expect(ensureTerminalModeHostContext).toHaveBeenCalledWith('runtime:env-1')
    // Ordering is the contract: the host hard-fails folderWorkspace.create on a
    // group it does not have (docs/terminal-mode-design.md, resolved question 2).
    expect(ensureTerminalModeHostContext.mock.invocationCallOrder[0]).toBeLessThan(
      createFolderWorkspace.mock.invocationCallOrder[0]
    )
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        projectGroupId: 'hidden-remote',
        folderPath: '/home/remote',
        connectionId: null
      }),
      { runtimeEnvironmentId: 'env-1' }
    )
  })

  it('routes an SSH host through the connection id, not a runtime environment', async () => {
    terminalModeHostOptions.current = [
      { id: 'local', label: 'Local', detail: '', supported: true },
      { id: 'ssh:box', label: 'box', detail: '', supported: true }
    ]
    const { slice, createFolderWorkspace } = makeStore({ activeWorkspaceKey: null })
    await slice.createVerticalTab({ hostId: 'ssh:box' })
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'box' }),
      { runtimeEnvironmentId: null }
    )
  })

  it('connects an SSH target before resolving its home directory', async () => {
    terminalModeHostOptions.current = [
      { id: 'local', label: 'Local', detail: '', supported: true },
      { id: 'ssh:box', label: 'box', detail: '', supported: true }
    ]
    const { slice } = makeStore({ activeWorkspaceKey: null })
    await slice.createVerticalTab({ hostId: 'ssh:box' })
    expect(ensureSshTargetConnectedForVerticalTab).toHaveBeenCalledWith('box', expect.anything())
    // Ordering is the fix: a disconnected target resolves `~` to the literal `~`.
    expect(ensureSshTargetConnectedForVerticalTab.mock.invocationCallOrder[0]).toBeLessThan(
      ensureTerminalModeHostContext.mock.invocationCallOrder[0]
    )
  })

  it('reads the live target status and publishes the connect result', async () => {
    terminalModeHostOptions.current = [
      { id: 'local', label: 'Local', detail: '', supported: true },
      { id: 'ssh:box', label: 'box', detail: '', supported: true }
    ]
    const { slice, setSshConnectionState } = makeStore({
      activeWorkspaceKey: null,
      sshConnectionStates: new Map([['box', { targetId: 'box', status: 'connected' }]])
    })
    await slice.createVerticalTab({ hostId: 'ssh:box' })
    const deps = ensureSshTargetConnectedForVerticalTab.mock.calls[0][1] as {
      getStatus: () => string | undefined
      onConnected: (state: unknown) => void
    }
    // Why live: the status can change during the connect the deps are handed to.
    expect(deps.getStatus()).toBe('connected')
    deps.onConnected({ targetId: 'box', status: 'connected' })
    expect(setSshConnectionState).toHaveBeenCalledWith('box', {
      targetId: 'box',
      status: 'connected'
    })
  })

  it('does not dial a connection for a local or runtime host', async () => {
    const { slice } = makeStore({ activeWorkspaceKey: null })
    await slice.createVerticalTab({ hostId: 'runtime:env-1' })
    expect(ensureSshTargetConnectedForVerticalTab).not.toHaveBeenCalled()
  })

  it('surfaces a failed SSH connect as a readable toast, not a created tab', async () => {
    terminalModeHostOptions.current = [
      { id: 'local', label: 'Local', detail: '', supported: true },
      { id: 'ssh:box', label: 'box', detail: '', supported: true }
    ]
    ensureSshTargetConnectedForVerticalTab.mockRejectedValue(new Error('Connection timed out.'))
    const { slice, createFolderWorkspace, state } = makeStore({ activeWorkspaceKey: null })
    await expect(slice.createVerticalTab({ hostId: 'ssh:box' })).resolves.toBeNull()
    expect(createFolderWorkspace).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Failed to create terminal tab', {
      description: 'Connection timed out.'
    })
    expect(state.verticalTabCreatesInFlight).toBe(0)
  })

  it('refuses a host that could not expand its home directory', async () => {
    // A relay-less SSH target answers `~` with `~`; creating there fails on a path the
    // user never chose, so the readable failure belongs here.
    ensureTerminalModeHostContext.mockResolvedValue({ projectGroup: hidden, homeDir: '~' })
    const { slice, createFolderWorkspace } = makeStore({ activeWorkspaceKey: null })
    await expect(slice.createVerticalTab()).resolves.toBeNull()
    expect(createFolderWorkspace).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][1].description).toMatch(/home directory/i)
  })

  it('reports creation as in flight while a host is being resolved', async () => {
    let release: (() => void) | undefined
    ensureTerminalModeHostContext.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ projectGroup: hidden, homeDir: '/home/dev' })
      })
    )
    const { slice, state } = makeStore({ activeWorkspaceKey: null })
    const pending = slice.createVerticalTab()
    await Promise.resolve()
    // The "+" control and the empty-state button both read this counter.
    expect(state.verticalTabCreatesInFlight).toBe(1)
    release?.()
    await pending
    expect(state.verticalTabCreatesInFlight).toBe(0)
  })

  it('inherits the pwd focused when the host finished, not when the click happened', async () => {
    let release: (() => void) | undefined
    ensureTerminalModeHostContext.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ projectGroup: hidden, homeDir: '/home/dev' })
      })
    )
    const { slice, createFolderWorkspace, state } = makeStore({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    const pending = slice.createVerticalTab()
    await Promise.resolve()
    // The user kept working during a connect that can last minutes.
    state.cwdByPtyId = { 'pty-1': { cwd: '/srv/other', source: 'osc7' } }
    release?.()
    await pending
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/srv/other' }),
      expect.anything()
    )
  })

  it('uses the configured default host when nothing is focused', async () => {
    const { slice } = makeStore({
      activeWorkspaceKey: null,
      settings: { experimentalTerminalMode: true, terminalModeDefaultHost: 'runtime:env-1' }
    })
    await slice.createVerticalTab()
    expect(ensureTerminalModeHostContext).toHaveBeenCalledWith('runtime:env-1')
  })

  it('falls back to local when the configured default host is gone', async () => {
    terminalModeHostOptions.current = [{ id: 'local', label: 'Local', detail: '', supported: true }]
    const { slice } = makeStore({
      activeWorkspaceKey: null,
      settings: { experimentalTerminalMode: true, terminalModeDefaultHost: 'runtime:env-gone' }
    })
    await slice.createVerticalTab()
    expect(ensureTerminalModeHostContext).toHaveBeenCalledWith('local')
  })

  it('never inherits a pwd across hosts', async () => {
    // /srv/app exists on the focused tab's machine, not on the picked one.
    const { slice, createFolderWorkspace } = makeStore({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    await slice.createVerticalTab({ hostId: 'runtime:env-1' })
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/home/dev' }),
      { runtimeEnvironmentId: 'env-1' }
    )
  })
})
