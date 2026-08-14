import { describe, expect, it, vi } from 'vitest'

const runFileWatchStream = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => undefined)
)
vi.mock('./file-watch-stream-lifecycle', () => ({ runFileWatchStream }))

const { FILE_METHODS } = await import('./files')

function method(name: string) {
  const found = FILE_METHODS.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`missing method ${name}`)
  }
  return found
}

function invoke(name: string, params: unknown, ctx: Record<string, unknown>): Promise<unknown> {
  const target = method(name)
  return Promise.resolve(
    (target.handler as (p: unknown, c: unknown, emit?: unknown) => unknown)(
      target.params ? target.params.parse(params) : params,
      ctx,
      () => undefined
    )
  )
}

const runtime = {
  readFileExplorerDir: vi.fn(async () => []),
  statRuntimeFile: vi.fn(async () => ({ exists: true }))
}

describe('absolute-path scope params are refused for paired mobile clients', () => {
  it.each(['files.readDir', 'files.stat', 'files.watch'])('%s', async (name) => {
    await expect(
      invoke(
        name,
        { worktree: 'id:folder:vtab', relativePath: '', absolutePath: '/tmp/elsewhere' },
        { runtime, clientKind: 'mobile' }
      )
    ).rejects.toThrow('absolute_path_scope_unavailable_for_mobile_clients')
  })
})

describe('files.watch', () => {
  it('forwards the terminal-mode directory to the watcher', async () => {
    runFileWatchStream.mockClear()
    await invoke(
      'files.watch',
      { worktree: 'id:folder:vtab', absolutePath: '/tmp/elsewhere' },
      { runtime, clientKind: 'runtime', connectionId: 'conn-1' }
    )
    expect(runFileWatchStream).toHaveBeenCalledWith(
      expect.objectContaining({ worktree: 'id:folder:vtab', absolutePath: '/tmp/elsewhere' })
    )
  })

  it('omits the key entirely when no directory was sent, so old behavior is byte-identical', async () => {
    runFileWatchStream.mockClear()
    await invoke('files.watch', { worktree: 'id:folder:vtab' }, { runtime, clientKind: 'runtime' })
    expect(runFileWatchStream.mock.calls[0]?.[0]).not.toHaveProperty('absolutePath')
  })

  it('strips an unknown param the way an older host would', () => {
    // Rule 1: the schema ignores keys it does not know, which is exactly why the
    // client must hard-gate on the capability rather than hope for an error.
    const parsed = method('files.watch').params?.parse({
      worktree: 'id:folder:vtab',
      somethingNew: 1
    })
    expect(parsed).toEqual({ worktree: 'id:folder:vtab' })
  })
})
