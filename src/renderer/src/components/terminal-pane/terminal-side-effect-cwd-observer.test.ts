import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TerminalSideEffectBatch } from '../../../../shared/terminal-side-effect-facts'
import {
  _dispatchTerminalSideEffectBatchForTest,
  _resetTerminalSideEffectFactConsumersForTest,
  registerTerminalCwdFactObserver,
  registerTerminalSideEffectFactConsumer
} from './terminal-side-effect-facts-handler'

const PTY_ID = 'wt-1#1'

function batch(
  facts: TerminalSideEffectBatch['facts'],
  options: Partial<TerminalSideEffectBatch> = {}
): TerminalSideEffectBatch {
  return { ptyId: PTY_ID, seq: 0, facts, ...options }
}

describe('cwd fact observer', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window
  let observed: [string, string][]
  let unregister: () => void

  beforeEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    observed = []
    unregister = registerTerminalCwdFactObserver((ptyId, cwd) => observed.push([ptyId, cwd]))
  })

  afterEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('observes cwd facts for PTYs with no registered pane consumer', () => {
    // Why it matters: a parked or background terminal has no consumer, and its
    // directory still has to reach the store.
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'cwd', cwd: '/srv/app' }]))
    expect(observed).toEqual([[PTY_ID, '/srv/app']])
  })

  it('observes cwd facts alongside a registered consumer without disturbing it', () => {
    const titles: string[] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: { onTitleChange: (normalizedTitle) => titles.push(normalizedTitle) }
    })
    _dispatchTerminalSideEffectBatchForTest(
      batch([
        { kind: 'cwd', cwd: '/srv/app' },
        { kind: 'title', normalizedTitle: 'zsh', rawTitle: 'zsh' }
      ])
    )
    expect(observed).toEqual([[PTY_ID, '/srv/app']])
    expect(titles).toEqual(['zsh'])
  })

  it('applies the cwd carried by a replay snapshot', () => {
    // Replay is title-only for attention policy, but a re-attached pane must
    // still recover the shell's directory.
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'cwd', cwd: '/srv/app' }], { replay: true })
    )
    expect(observed).toEqual([[PTY_ID, '/srv/app']])
  })

  it('applies the snapshot cwd pulled on consumer registration', async () => {
    const snapshot = batch([{ kind: 'cwd', cwd: '/srv/restored' }], { replay: true })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: async () => snapshot } }
    }
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {},
      restoreTitleOnRegister: true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(observed).toEqual([[PTY_ID, '/srv/restored']])
  })

  it('never lets an in-flight replay snapshot regress a newer cd', async () => {
    // The snapshot is an async IPC round-trip: a `cd` observed while it was in
    // flight must win, and the title guard cannot help — it only advances on
    // title facts, which a static-title shell never emits.
    const snapshot = batch([{ kind: 'cwd', cwd: '/srv/old' }], { replay: true, seq: 10 })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: async () => snapshot } }
    }
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {},
      restoreTitleOnRegister: true
    })
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'cwd', cwd: '/srv/new' }], { seq: 20 }))
    await Promise.resolve()
    await Promise.resolve()

    expect(observed).toEqual([[PTY_ID, '/srv/new']])
  })

  it('stops observing once unregistered, and leaves other observers alone', () => {
    const other: string[] = []
    registerTerminalCwdFactObserver((_ptyId, cwd) => other.push(cwd))
    unregister()
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'cwd', cwd: '/srv/app' }]))
    expect(observed).toEqual([])
    expect(other).toEqual(['/srv/app'])
  })

  it('never lets cwd churn evict attention facts from the handoff buffer', () => {
    // The buffer only opens for a PTY whose consumer just unregistered — the
    // reveal-remount window a `cd`-churning shell could otherwise flush.
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: {} })()
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))
    for (let index = 0; index < 200; index += 1) {
      _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'cwd', cwd: `/tmp/${index}` }]))
    }
    const bells: number[] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: { onBell: () => bells.push(1) }
    })
    expect(bells).toEqual([1])
  })
})
