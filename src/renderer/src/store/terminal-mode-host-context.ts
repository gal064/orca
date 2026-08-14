import type { ExecutionHostId } from '../../../shared/execution-host'
import type { TerminalModeLocalContext } from '../../../shared/terminal-mode-group'
import {
  TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY,
  TERMINAL_MODE_VERTICAL_TABS_UPDATE_REQUIRED_MESSAGE
} from '../../../shared/protocol-version'
import { assertRuntimeEnvironmentCapability, callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getTerminalModeHostRoute } from '@/lib/terminal-mode-hosts'
import { translate } from '@/i18n/i18n'

/**
 * Ensures the hidden terminal-mode group exists **on the host that will own the
 * vertical tab**, and reports that host's home directory for a tab with no pwd to
 * inherit. `folderWorkspace.create` hard-fails on a missing group, so this always
 * runs first (docs/terminal-mode-design.md, resolved question 2).
 *
 * The remote leg is one purpose-built RPC rather than `projectGroup.create` with the
 * reserved name: the host rejects `__terminal-mode__` for every ordinary caller, and
 * a general-purpose bypass parameter would hand that sentinel to the CLI and to
 * paired clients too. It also carries the host's home directory, which no existing
 * method exposes.
 */
export async function ensureTerminalModeHostContext(
  hostId: ExecutionHostId
): Promise<TerminalModeLocalContext> {
  const route = getTerminalModeHostRoute(hostId)
  if (route.kind === 'runtime') {
    await assertRuntimeEnvironmentCapability(
      route.environmentId,
      TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY,
      TERMINAL_MODE_VERTICAL_TABS_UPDATE_REQUIRED_MESSAGE
    )
    return await callRuntimeRpc<TerminalModeLocalContext>(
      { kind: 'environment', environmentId: route.environmentId },
      'terminalMode.ensureContext',
      undefined,
      { timeoutMs: 15_000 }
    )
  }
  const ensureContext = window.api?.terminalMode?.ensureContext
  if (!ensureContext) {
    // Paired web clients have no local main process to create the group in.
    throw new Error(
      translate(
        'auto.store.slices.verticalTabs.unsupportedHost',
        'Terminal tabs are only available on the desktop app.'
      )
    )
  }
  // Why fenced: the SSH leg expands `~` over the relay, whose own timeout is 30 s and whose
  // failure path returns the unexpanded path rather than throwing. Nothing else bounds the
  // wait, and the "+" control is showing progress for the whole of it.
  return await withEnsureContextTimeout(
    ensureContext({ connectionId: route.kind === 'ssh' ? route.connectionId : null })
  )
}

const ENSURE_CONTEXT_TIMEOUT_MS = 45_000

async function withEnsureContextTimeout(
  request: Promise<TerminalModeLocalContext>
): Promise<TerminalModeLocalContext> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          translate(
            'auto.store.terminalModeHostContext.timedOut',
            'The host did not answer in time. Check the connection and try again.'
          )
        )
      )
    }, ENSURE_CONTEXT_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
