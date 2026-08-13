// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY,
  ABSOLUTE_PATH_SCOPE_UPDATE_REQUIRED_MESSAGE,
  RUNTIME_CAPABILITIES
} from '../../../shared/protocol-version'
import { readRuntimeDirectory, statRuntimePath } from './runtime-file-client'
import { getRuntimeRepoRootForPath } from './runtime-repo-root-client'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import { createCompatibleRuntimeStatusResponse } from './runtime-compatibility-test-fixture'

const runtimeCall = vi.fn()
const readDirLocal = vi.fn()
const repoRootForPathLocal = vi.fn()

const REMOTE_CONTEXT = {
  settings: { activeRuntimeEnvironmentId: 'env-1' },
  worktreeId: 'folder:vtab-1',
  worktreePath: '/host/start'
}

function stubWindow(): void {
  vi.stubGlobal('window', {
    api: {
      fs: { readDir: readDirLocal, stat: vi.fn() },
      git: { repoRootForPath: repoRootForPathLocal },
      runtimeEnvironments: { call: runtimeCall, subscribe: vi.fn() }
    }
  })
}

/** Status response for a host that predates the absolute-path scope. The token is
 *  not in RUNTIME_CAPABILITIES yet (see protocol-version.ts), so the default
 *  fixture already describes such a host; this names the intent. */
function legacyStatusResponse(): ReturnType<typeof createCompatibleRuntimeStatusResponse> {
  return createCompatibleRuntimeStatusResponse()
}

/** Status response for the host Phase 4 will ship: one that advertises the token. */
function absoluteScopeStatusResponse(): ReturnType<typeof createCompatibleRuntimeStatusResponse> {
  const response = createCompatibleRuntimeStatusResponse()
  if (!response.ok) {
    return response
  }
  return {
    ...response,
    result: {
      ...response.result,
      capabilities: [...RUNTIME_CAPABILITIES, ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY]
    }
  }
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  runtimeCall.mockReset()
  readDirLocal.mockReset()
  repoRootForPathLocal.mockReset()
  stubWindow()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('absolute-path scope gating', () => {
  it('sends absolutePath only when the host advertises the capability', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? absoluteScopeStatusResponse()
        : { id: 'rpc', ok: true, result: [], _meta: { runtimeId: 'remote-runtime' } }
    )

    await readRuntimeDirectory({ ...REMOTE_CONTEXT, absolutePathScope: true }, '/elsewhere/dir')

    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'files.readDir',
        params: {
          worktree: 'id:folder:vtab-1',
          relativePath: '',
          absolutePath: '/elsewhere/dir'
        }
      })
    )
  })

  it('refuses to send absolutePath to a host without the capability', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? legacyStatusResponse()
        : { id: 'rpc', ok: true, result: [], _meta: { runtimeId: 'remote-runtime' } }
    )

    await expect(
      readRuntimeDirectory({ ...REMOTE_CONTEXT, absolutePathScope: true }, '/elsewhere/dir')
    ).rejects.toThrow(ABSOLUTE_PATH_SCOPE_UPDATE_REQUIRED_MESSAGE)

    expect(
      runtimeCall.mock.calls.some(
        ([args]) => (args as { method: string }).method === 'files.readDir'
      )
    ).toBe(false)
  })

  it('keeps the relative-path contract when the scope is not requested', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? createCompatibleRuntimeStatusResponse()
        : { id: 'rpc', ok: true, result: [], _meta: { runtimeId: 'remote-runtime' } }
    )

    await readRuntimeDirectory(REMOTE_CONTEXT, '/host/start/sub')

    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'files.readDir',
        params: { worktree: 'id:folder:vtab-1', relativePath: 'sub' }
      })
    )
  })

  it('never routes a local workspace through the runtime RPC', async () => {
    readDirLocal.mockResolvedValue([])
    await readRuntimeDirectory(
      {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId: 'folder:vtab-1',
        worktreePath: '/start',
        absolutePathScope: true
      },
      '/elsewhere/dir'
    )
    expect(readDirLocal).toHaveBeenCalledWith({
      dirPath: '/elsewhere/dir',
      connectionId: undefined
    })
    expect(runtimeCall).not.toHaveBeenCalled()
  })

  it('gates files.stat on the same capability', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? legacyStatusResponse()
        : {
            id: 'rpc',
            ok: true,
            result: { size: 0, isDirectory: true, mtime: 0 },
            _meta: { runtimeId: 'remote-runtime' }
          }
    )
    await expect(
      statRuntimePath({ ...REMOTE_CONTEXT, absolutePathScope: true }, '/elsewhere/dir')
    ).rejects.toThrow(ABSOLUTE_PATH_SCOPE_UPDATE_REQUIRED_MESSAGE)
  })
})

describe('getRuntimeRepoRootForPath', () => {
  it('uses the git IPC for local and SSH workspaces', async () => {
    repoRootForPathLocal.mockResolvedValue('/repo')
    await expect(
      getRuntimeRepoRootForPath(
        { settings: { activeRuntimeEnvironmentId: null }, connectionId: 'box' },
        '/repo/src'
      )
    ).resolves.toBe('/repo')
    expect(repoRootForPathLocal).toHaveBeenCalledWith({
      dirPath: '/repo/src',
      connectionId: 'box'
    })
  })

  it('degrades to "unsupported" when the host has no repo-root method', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? createCompatibleRuntimeStatusResponse()
        : {
            id: 'rpc',
            ok: false,
            error: { code: 'method_not_found', message: 'Unknown method' },
            _meta: { runtimeId: 'remote-runtime' }
          }
    )
    await expect(
      getRuntimeRepoRootForPath({ settings: { activeRuntimeEnvironmentId: 'env-1' } }, '/repo/src')
    ).resolves.toBe('unsupported')
  })

  it('propagates a real repo root from a current host', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? createCompatibleRuntimeStatusResponse()
        : { id: 'rpc', ok: true, result: '/host/repo', _meta: { runtimeId: 'remote-runtime' } }
    )
    await expect(
      getRuntimeRepoRootForPath(
        { settings: { activeRuntimeEnvironmentId: 'env-1' } },
        '/host/repo/x'
      )
    ).resolves.toBe('/host/repo')
  })
})
