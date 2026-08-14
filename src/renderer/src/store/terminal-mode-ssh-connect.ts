import type { SshConnectionState } from '../../../shared/ssh-types'
import { isSshConnectInFlight, trackSshConnect } from '@/ssh/ssh-connect-in-flight'
import { canConnectSshStatus, isConnectingSshStatus } from '@/ssh/ssh-connection-recoverability'
import { SSH_RECONNECT_UI_TIMEOUT_MS, withUiConnectTimeout } from '@/ssh/ssh-connect-ui-timeout'
import { translate } from '@/i18n/i18n'

export type SshConnectDeps = {
  getStatus: () => SshConnectionState['status'] | undefined
  onConnected: (state: SshConnectionState) => void
}

const SETTLE_POLL_MS = 500

/**
 * Connects the SSH target a new vertical tab will live on, before anything asks the relay
 * for its home directory: a disconnected target resolves `~` to the literal `~` and the
 * create then fails with a path error the user cannot act on
 * (docs/terminal-mode-design.md Phase 6, item 0a).
 *
 * Dialing is what the two classic connect surfaces do, on their terms: never a second dial
 * while one is in flight or the host is in a driver-side transient (that is a second
 * credential prompt on a passphrase-gated target), the reconnect budget rather than the
 * composer's 20 s (a passphrase prompt alone allows 120 s), and the resolved state written
 * back because `ssh.connect` can resolve before the state-change IPC lands.
 */
export async function ensureSshTargetConnectedForVerticalTab(
  connectionId: string,
  deps: SshConnectDeps
): Promise<void> {
  if (deps.getStatus() === 'connected') {
    return
  }
  const connect = window.api?.ssh?.connect
  if (!connect) {
    throw new Error(
      translate(
        'auto.store.terminalModeSshConnect.unsupported',
        'Terminal tabs on SSH hosts are only available in the desktop app.'
      )
    )
  }
  if (isSshConnectInFlight(connectionId) || isConnectingSshStatus(deps.getStatus())) {
    // Someone else is already dialing this target — wait it out instead of prompting twice.
    await waitForConnectedStatus(connectionId, deps)
    return
  }
  let state: SshConnectionState | null
  try {
    state = await withUiConnectTimeout(
      trackSshConnect(connectionId, connect({ targetId: connectionId })),
      SSH_RECONNECT_UI_TIMEOUT_MS
    )
  } catch (error) {
    throw new Error(describeSshConnectFailure(error))
  }
  if (state) {
    deps.onConnected(state)
  }
}

// Electron wraps a main-process throw, and the wrapper is the first thing the toast
// would show ("Error invoking remote method 'ssh:connect': Error: …").
const IPC_INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

export function describeSshConnectFailure(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    IPC_INVOKE_PREFIX,
    ''
  )
  return (
    message.trim() ||
    translate('auto.store.terminalModeSshConnect.failed', 'Could not connect to the SSH host.')
  )
}

async function waitForConnectedStatus(connectionId: string, deps: SshConnectDeps): Promise<void> {
  const deadline = Date.now() + SSH_RECONNECT_UI_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = deps.getStatus()
    if (status === 'connected') {
      return
    }
    // A dial that ended in a failure state is not going to settle on its own; say so now
    // rather than after the full reconnect budget.
    if (!isSshConnectInFlight(connectionId) && canConnectSshStatus(status)) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
  }
  throw new Error(
    translate(
      'auto.store.terminalModeSshConnect.notConnected',
      'The SSH host is not connected yet. Try again once it finishes connecting.'
    )
  )
}
