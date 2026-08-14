import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeSshConnectFailure,
  ensureSshTargetConnectedForVerticalTab
} from './terminal-mode-ssh-connect'
import {
  beginSshConnect,
  endSshConnect,
  isSshConnectInFlight,
  resetSshConnectInFlightForTests
} from '@/ssh/ssh-connect-in-flight'
import { SSH_RECONNECT_UI_TIMEOUT_MS } from '@/ssh/ssh-connect-ui-timeout'
import type { SshConnectionState, SshConnectionStatus } from '../../../shared/ssh-types'

const connect = vi.fn()
const onConnected = vi.fn()
let status: SshConnectionStatus | undefined

function deps() {
  return { getStatus: () => status, onConnected }
}

beforeEach(() => {
  connect.mockReset()
  onConnected.mockReset()
  connect.mockResolvedValue({ targetId: 'box', status: 'connected' } as SshConnectionState)
  status = 'disconnected'
  resetSshConnectInFlightForTests()
  ;(globalThis as { window?: unknown }).window = { api: { ssh: { connect } } }
})

afterEach(() => {
  vi.useRealTimers()
  resetSshConnectInFlightForTests()
  delete (globalThis as { window?: unknown }).window
})

describe('ensureSshTargetConnectedForVerticalTab', () => {
  it('dials a disconnected target and publishes the resolved state', async () => {
    await ensureSshTargetConnectedForVerticalTab('box', deps())
    expect(connect).toHaveBeenCalledWith({ targetId: 'box' })
    // ssh.connect can resolve before the state-change IPC lands, and the pty attach that
    // follows reads the renderer store.
    expect(onConnected).toHaveBeenCalledWith({ targetId: 'box', status: 'connected' })
  })

  it('dials a target with no known state', async () => {
    status = undefined
    await ensureSshTargetConnectedForVerticalTab('box', deps())
    expect(connect).toHaveBeenCalledOnce()
  })

  it('skips a connected target', async () => {
    status = 'connected'
    await ensureSshTargetConnectedForVerticalTab('box', deps())
    expect(connect).not.toHaveBeenCalled()
  })

  it('waits out a host-driven transient instead of dialing again', async () => {
    status = 'deploying-relay'
    const pending = ensureSshTargetConnectedForVerticalTab('box', deps())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(connect).not.toHaveBeenCalled()
    status = 'connected'
    await pending
    expect(connect).not.toHaveBeenCalled()
  })

  it('waits out another surface dial rather than raising a second credential prompt', async () => {
    beginSshConnect('box')
    const pending = ensureSshTargetConnectedForVerticalTab('box', deps())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(connect).not.toHaveBeenCalled()
    status = 'connected'
    endSshConnect('box')
    await pending
  })

  it('gives up on a wait once the other dial has failed', async () => {
    status = 'connecting'
    const pending = ensureSshTargetConnectedForVerticalTab('box', deps())
    status = 'auth-failed'
    await expect(pending).rejects.toThrow(/not connected/i)
  })

  it('holds the shared in-flight lock so a second surface cannot raise a second prompt', async () => {
    let settle: ((state: SshConnectionState | null) => void) | undefined
    connect.mockReturnValue(
      new Promise<SshConnectionState | null>((resolve) => {
        settle = resolve
      })
    )
    const pending = ensureSshTargetConnectedForVerticalTab('box', deps())
    await Promise.resolve()
    expect(isSshConnectInFlight('box')).toBe(true)
    settle?.(null)
    await pending
    expect(isSshConnectInFlight('box')).toBe(false)
  })

  it('uses the reconnect budget, not the composer budget', async () => {
    vi.useFakeTimers()
    connect.mockReturnValue(new Promise(() => {}))
    const pending = ensureSshTargetConnectedForVerticalTab('box', deps())
    const assertion = expect(pending).rejects.toThrow(/timed out/i)
    // A passphrase prompt alone allows 120 s host-side; a 20 s fence would toast here.
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(SSH_RECONNECT_UI_TIMEOUT_MS)
    await assertion
  })

  it('rejects rather than creating a tab that would fail on the path', async () => {
    status = 'auth-failed'
    connect.mockRejectedValue(new Error('Authentication failed'))
    await expect(ensureSshTargetConnectedForVerticalTab('box', deps())).rejects.toThrow(
      'Authentication failed'
    )
  })

  it('strips the IPC wrapper so the toast reads as a connection failure', async () => {
    status = 'disconnected'
    connect.mockRejectedValue(
      new Error(
        "Error invoking remote method 'ssh:connect': Error: connect ECONNREFUSED 127.0.0.1:59"
      )
    )
    await expect(ensureSshTargetConnectedForVerticalTab('box', deps())).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:59'
    )
    await expect(ensureSshTargetConnectedForVerticalTab('box', deps())).rejects.not.toThrow(
      /invoking remote method/
    )
  })
})

describe('describeSshConnectFailure', () => {
  it('keeps a already-readable message', () => {
    expect(describeSshConnectFailure(new Error('All authentication methods failed'))).toBe(
      'All authentication methods failed'
    )
  })

  it('falls back when the wrapper is all there was', () => {
    expect(
      describeSshConnectFailure(new Error("Error invoking remote method 'ssh:connect':"))
    ).toMatch(/could not connect/i)
  })
})
