/**
 * A host restart kills every remote PTY while the client keeps the persisted ids that
 * named them. Before Phase 5 the pane learned that asynchronously and simply returned:
 * `attach` is fire-and-forget, so its `.catch` is the IIFE's own and the caller's
 * synchronous recovery never ran. The pane sat on a dead id, and nothing pruned it, so
 * every later launch reproduced the same dead pane.
 *
 * The contract pinned here: the transport reports the loss through `onPtySessionLost`
 * with the id that was asked for — and never through `onPtyExit`, which retires a PTY
 * that *was* live and can close the tab when it is the pane's only one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeCall = vi.fn()
const runtimeSubscribe = vi.fn()

const STALE_PTY_ID = 'remote:env-1@@terminal-gone'

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('../../runtime/remote-runtime-terminal-multiplexer')
  vi.doMock('@/runtime/web-runtime-session', () => ({
    refreshWebRuntimeSessionTabsSnapshot: vi.fn(async () => {})
  }))
  vi.clearAllMocks()
  runtimeSubscribe.mockImplementation(async () => ({
    unsubscribe: vi.fn(),
    sendBinary: vi.fn()
  }))
  vi.stubGlobal('window', {
    api: { runtimeEnvironments: { call: runtimeCall, subscribe: runtimeSubscribe } }
  })
})

async function attachToAGoneSession(resolvePaneOutcome: 'not-found' | 'method-missing') {
  runtimeCall.mockImplementation(async (request: { method: string }) => {
    if (request.method === 'terminal.resolvePane') {
      return resolvePaneOutcome === 'not-found'
        ? { ok: false, error: { code: 'invalid_argument', message: 'terminal_not_found' } }
        : { ok: false, error: { code: 'method_not_found', message: 'method_not_found' } }
    }
    if (request.method === 'session.tabs.list') {
      return {
        ok: true,
        result: {
          worktree: 'wt-1',
          publicationEpoch: 'epoch-1',
          snapshotVersion: 1,
          activeGroupId: null,
          activeTabId: null,
          activeTabType: 'terminal' as const,
          tabs: []
        }
      }
    }
    return { ok: true, result: {} }
  })

  const { createRemoteRuntimePtyTransport } = await import('./remote-runtime-pty-transport')
  const onError = vi.fn()
  const onPtyExit = vi.fn()
  const onPtySessionLost = vi.fn()
  const transport = createRemoteRuntimePtyTransport('env-1', {
    worktreeId: 'folder:vtab-1',
    tabId: 'tab-1',
    leafId: 'pane:1',
    onPtyExit,
    onPtySessionLost
  })
  transport.attach({
    existingPtyId: STALE_PTY_ID,
    cols: 80,
    rows: 24,
    callbacks: { onError }
  })
  return { transport, onError, onPtyExit, onPtySessionLost }
}

describe('a remote pane whose persisted session is gone', () => {
  it('tells the pane to recover, naming the id it was asked to attach to', async () => {
    const { onPtySessionLost, onError } = await attachToAGoneSession('not-found')

    await vi.waitFor(() => expect(onPtySessionLost).toHaveBeenCalledWith(STALE_PTY_ID))
    // The user still gets told why the pane they were looking at went away.
    expect(onError).toHaveBeenCalledWith('Remote terminal was closed.')
  })

  it('never routes it through onPtyExit, which would close the tab', async () => {
    // onPtyExit retires a PTY that was live; for a pane that is the tab's only one it
    // closes the tab. A server restart must not delete the user's terminal.
    const { onPtyExit, onPtySessionLost } = await attachToAGoneSession('not-found')

    await vi.waitFor(() => expect(onPtySessionLost).toHaveBeenCalled())
    expect(onPtyExit).not.toHaveBeenCalled()
  })

  it('leaves a host that does not implement resolvePane alone', async () => {
    // `method_not_found` means "this host is older", not "the session is gone" — the
    // transport adopts the persisted handle instead, so nothing may be retired.
    const { onPtySessionLost, onPtyExit } = await attachToAGoneSession('method-missing')

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onPtySessionLost).not.toHaveBeenCalled()
    expect(onPtyExit).not.toHaveBeenCalled()
  })
})
