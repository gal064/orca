import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { GIT_METHODS } from './git'
import { FILE_METHODS } from './files'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('absolute-path scope on the host', () => {
  it('forwards files.readDir absolutePath to the runtime', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      readFileExplorerDir: vi.fn().mockResolvedValue([])
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: FILE_METHODS })

    await dispatcher.dispatch(
      makeRequest('files.readDir', {
        worktree: 'id:folder:vtab-1',
        relativePath: '',
        absolutePath: '/elsewhere'
      })
    )

    expect(runtime.readFileExplorerDir).toHaveBeenCalledWith('id:folder:vtab-1', '', '/elsewhere')
  })

  it('leaves absolutePath undefined for a relative-path read', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      readFileExplorerDir: vi.fn().mockResolvedValue([])
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: FILE_METHODS })

    await dispatcher.dispatch(
      makeRequest('files.readDir', { worktree: 'id:wt-1', relativePath: 'src' })
    )

    expect(runtime.readFileExplorerDir).toHaveBeenCalledWith('id:wt-1', 'src', undefined)
  })

  it('forwards files.stat absolutePath to the runtime', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      statRuntimeFile: vi.fn().mockResolvedValue({ size: 0, isDirectory: true, mtime: 0 })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: FILE_METHODS })

    await dispatcher.dispatch(
      makeRequest('files.stat', {
        worktree: 'id:folder:vtab-1',
        relativePath: '',
        absolutePath: '/elsewhere'
      })
    )

    expect(runtime.statRuntimeFile).toHaveBeenCalledWith('id:folder:vtab-1', '', '/elsewhere')
  })

  it('answers git.repoRootForPath from the runtime', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      getRuntimeRepoRootForPath: vi.fn().mockResolvedValue('/repo')
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: GIT_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('git.repoRootForPath', { path: '/repo/src' })
    )

    expect(runtime.getRuntimeRepoRootForPath).toHaveBeenCalledWith('/repo/src')
    expect(response).toMatchObject({ ok: true, result: '/repo' })
  })

  it('rejects git.repoRootForPath without a path', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      getRuntimeRepoRootForPath: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: GIT_METHODS })

    const response = await dispatcher.dispatch(makeRequest('git.repoRootForPath', {}))

    expect(response).toMatchObject({ ok: false })
    expect(runtime.getRuntimeRepoRootForPath).not.toHaveBeenCalled()
  })
})
