// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalModePanelScope } from '@/store/slices/terminal-mode-panels'

const setTerminalModePanelScope = vi.fn()
const collapseAllDirs = vi.fn()
const setPathScope = vi.fn()
const statRuntimePath = vi.fn()
const getRuntimeRepoRootForPath = vi.fn()
const runtimeEnvironmentSupportsCapability = vi.fn()
const activePwd = { current: null as string | null }
const owner = { current: { kind: 'local' } as Record<string, unknown> }

const TAB = {
  id: 'vtab-1',
  projectGroupId: 'group-terminal',
  name: 'tab',
  folderPath: '/start',
  createdAt: 1,
  sortOrder: 1
}
const GROUP = { id: 'group-terminal', name: '__terminal-mode__' }

const storeState = {
  activeWorkspaceKey: 'folder:vtab-1',
  folderWorkspaces: [TAB],
  projectGroups: [GROUP],
  setTerminalModePanelScope,
  collapseAllDirs
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))
vi.mock('@/runtime/runtime-file-client', () => ({ statRuntimePath }))
vi.mock('@/runtime/runtime-repo-root-client', () => ({ getRuntimeRepoRootForPath }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ runtimeEnvironmentSupportsCapability }))
vi.mock('./use-active-vertical-tab-pwd', () => ({
  useActiveVerticalTabPwd: () => activePwd.current
}))
vi.mock('@/components/right-sidebar/file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwnerFromState: () => owner.current
}))

const { useTerminalModePanelScope } = await import('./use-terminal-mode-panel-scope')

function lastScope(): TerminalModePanelScope | null {
  const calls = setTerminalModePanelScope.mock.calls
  return (calls.at(-1)?.[0] ?? null) as TerminalModePanelScope | null
}

beforeEach(() => {
  setTerminalModePanelScope.mockReset()
  collapseAllDirs.mockReset()
  setPathScope.mockReset()
  statRuntimePath.mockReset()
  getRuntimeRepoRootForPath.mockReset()
  runtimeEnvironmentSupportsCapability.mockReset()
  activePwd.current = '/start/sub'
  owner.current = { kind: 'local' }
  storeState.activeWorkspaceKey = 'folder:vtab-1'
  // Why not stubGlobal('window'): testing-library needs the real happy-dom
  // document; only the preload bridge is replaced.
  ;(window as unknown as { api: unknown }).api = { terminalMode: { setPathScope } }
})

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('local vertical tab', () => {
  it('publishes the pwd main corroborated, with the repository it resolved', async () => {
    setPathScope.mockResolvedValue({ accepted: true, repoRoot: '/start' })
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(setPathScope).toHaveBeenCalledWith({
      scope: { workspaceKey: 'folder:vtab-1', root: '/start/sub' }
    })
    expect(lastScope()).toMatchObject({
      root: '/start/sub',
      workspaceRoot: '/start',
      repoRoot: '/start',
      addressing: 'relative',
      clampedToWorkspaceRoot: false
    })
  })

  it('stays on the start folder when main refuses the reported pwd', async () => {
    setPathScope.mockImplementation(async ({ scope }: { scope: { root: string } | null }) =>
      scope?.root === '/start'
        ? { accepted: true, repoRoot: null }
        : { accepted: false, repoRoot: null }
    )
    activePwd.current = '/elsewhere/foreign'
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(lastScope()).toMatchObject({ root: '/start', repoRoot: null })
  })

  it('revokes the grant on unmount', async () => {
    setPathScope.mockResolvedValue({ accepted: true, repoRoot: null })
    const view = renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    view.unmount()
    expect(setPathScope).toHaveBeenLastCalledWith({ scope: null })
    expect(setTerminalModePanelScope).toHaveBeenLastCalledWith(null)
  })

  it('does not collapse the tree on the first resolve', async () => {
    setPathScope.mockResolvedValue({ accepted: true, repoRoot: null })
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(collapseAllDirs).not.toHaveBeenCalled()
  })
})

describe('remote vertical tab', () => {
  beforeEach(() => {
    owner.current = { kind: 'runtime', environmentId: 'env-1' }
    statRuntimePath.mockResolvedValue({ isDirectory: true })
    getRuntimeRepoRootForPath.mockResolvedValue(null)
  })

  it('follows a pwd outside the start folder when the host advertises the capability', async () => {
    runtimeEnvironmentSupportsCapability.mockResolvedValue(true)
    activePwd.current = '/elsewhere'
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(lastScope()).toMatchObject({
      root: '/elsewhere',
      addressing: 'absolute',
      clampedToWorkspaceRoot: false
    })
    expect(statRuntimePath).toHaveBeenCalledWith(
      expect.objectContaining({ absolutePathScope: true }),
      '/elsewhere'
    )
  })

  it('clamps to the start folder and never sends the param to an old host', async () => {
    runtimeEnvironmentSupportsCapability.mockResolvedValue(false)
    activePwd.current = '/elsewhere'
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(lastScope()).toMatchObject({
      root: '/start',
      addressing: 'relative',
      clampedToWorkspaceRoot: true
    })
    for (const [context] of statRuntimePath.mock.calls) {
      expect((context as { absolutePathScope?: boolean }).absolutePathScope).toBeUndefined()
    }
  })

  it('clamps a subdirectory pwd too, because relative paths are computed against the shown root', async () => {
    runtimeEnvironmentSupportsCapability.mockResolvedValue(false)
    activePwd.current = '/start/sub'
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(lastScope()).toMatchObject({
      root: '/start',
      addressing: 'relative',
      clampedToWorkspaceRoot: true
    })
  })

  it('stays on the start folder without probing when the shell never moved', async () => {
    activePwd.current = '/start'
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(lastScope()).toMatchObject({ root: '/start', addressing: 'relative' })
    expect(runtimeEnvironmentSupportsCapability).not.toHaveBeenCalled()
  })

  it('reports no repository when the host cannot answer the repo-root probe', async () => {
    runtimeEnvironmentSupportsCapability.mockResolvedValue(true)
    getRuntimeRepoRootForPath.mockResolvedValue('unsupported')
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(lastScope()).not.toBeNull())
    expect(lastScope()?.repoRoot).toBeNull()
  })
})

describe('no active vertical tab', () => {
  it('publishes nothing and revokes the grant', async () => {
    storeState.activeWorkspaceKey = 'worktree:classic'
    renderHook(() => useTerminalModePanelScope())
    await waitFor(() => expect(setTerminalModePanelScope).toHaveBeenCalledWith(null))
    expect(setPathScope).toHaveBeenCalledWith({ scope: null })
  })
})
