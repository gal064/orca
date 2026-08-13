import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  encodeTerminalStreamText
} from '../../../shared/terminal-stream-protocol'
import {
  getRemoteRuntimeTerminalMultiplexer,
  resetRemoteRuntimeTerminalMultiplexersForTests
} from './remote-runtime-terminal-multiplexer'
import { replaceRuntimeEnvironmentRevisions } from './runtime-environment-revision'

// Metadata (opcode 12) has been on the wire since v1.4.120; only the client's
// decode is new, so this exercises the frame the real host already sends
// (rpc/methods/terminal.ts, outputBatcher meta.cwd branch).
type SubscribeCallbacks = {
  onResponse: (response: unknown) => void
  onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
}

describe('remote terminal Metadata cwd decoding', () => {
  let streamId = 0
  let toClient: (bytes: Uint8Array<ArrayBufferLike>) => void
  let clientFrames: { opcode: TerminalStreamOpcode; payload: Uint8Array }[]
  const cwdEvents: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    cwdEvents.length = 0
    clientFrames = []
    resetRemoteRuntimeTerminalMultiplexersForTests()
    replaceRuntimeEnvironmentRevisions([])

    const subscribe = vi.fn(async (_args: unknown, callbacks: SubscribeCallbacks) => {
      toClient = (bytes) => callbacks.onBinary?.(bytes)
      queueMicrotask(() => callbacks.onResponse({ ok: true, result: { type: 'ready' } }))
      return {
        unsubscribe: vi.fn(),
        sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => {
          const frame = decodeTerminalStreamFrame(bytes)
          if (!frame) {
            return
          }
          clientFrames.push({ opcode: frame.opcode, payload: frame.payload })
          if (frame.opcode === TerminalStreamOpcode.Subscribe) {
            streamId = decodeTerminalStreamJson<{ streamId: number }>(frame.payload)?.streamId ?? 0
            send(
              TerminalStreamOpcode.SnapshotStart,
              encodeTerminalStreamJson({ cols: 80, rows: 24 })
            )
            send(TerminalStreamOpcode.SnapshotEnd, new Uint8Array())
          }
        }
      }
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { subscribe } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function send(opcode: TerminalStreamOpcode, payload: Uint8Array): void {
    toClient(encodeTerminalStreamFrame({ opcode, streamId, seq: 0, payload }))
  }

  async function subscribeTerminal(): Promise<{
    data: string[]
    stream: Awaited<
      ReturnType<ReturnType<typeof getRemoteRuntimeTerminalMultiplexer>['subscribeTerminal']>
    >
  }> {
    const data: string[] = []
    const stream = await getRemoteRuntimeTerminalMultiplexer('env-1').subscribeTerminal({
      terminal: 'terminal-1',
      client: { id: 'desktop-1', type: 'desktop' },
      callbacks: {
        onData: (chunk) => data.push(chunk),
        onSnapshot: () => {},
        onCwd: (cwd) => cwdEvents.push(cwd)
      }
    })
    return { data, stream }
  }

  it('delivers the host-reported cwd to the stream that owns the PTY', async () => {
    await subscribeTerminal()
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ cwd: '/srv/project' }))

    expect(cwdEvents).toEqual(['/srv/project'])
  })

  it('never renders the frame as output and never acknowledges it', async () => {
    const { data } = await subscribeTerminal()
    const framesBefore = clientFrames.length
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ cwd: '/srv/project' }))

    expect(data).toEqual([])
    // Metadata carries no transport credit, so an Ack would over-credit the host.
    expect(clientFrames.length).toBe(framesBefore)
  })

  it('ignores frames with no usable cwd', async () => {
    await subscribeTerminal()
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ cwd: '' }))
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ seq: 4 }))
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ cwd: 42 }))
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamText('not json'))

    expect(cwdEvents).toEqual([])
  })

  it('ignores cwd frames for a stream the renderer already closed', async () => {
    const { stream } = await subscribeTerminal()
    stream.close()
    send(TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ cwd: '/srv/project' }))

    expect(cwdEvents).toEqual([])
  })
})
