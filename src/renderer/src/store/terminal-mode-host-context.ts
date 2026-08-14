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
  return await ensureContext({ connectionId: route.kind === 'ssh' ? route.connectionId : null })
}
