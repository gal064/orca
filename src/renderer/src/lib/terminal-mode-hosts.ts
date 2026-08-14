import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import type { ExecutionHostRegistryEntry } from '../../../shared/execution-host-registry'
import { TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'

export type TerminalModeHostOption = {
  id: ExecutionHostId
  label: string
  detail: string
  /**
   * False only for a remote runtime that *answered* without the terminal-mode token,
   * i.e. one that predates the feature. It still appears in the picker — hiding it
   * reads as "the host is gone" — but the row says why it cannot be chosen. A host
   * whose status has not arrived yet stays selectable: "we have not asked" is not
   * "too old", and `ensureTerminalModeHostContext` asserts the capability before it
   * creates anything, so the worst case is one clear error instead of a wrong label.
   */
  supported: boolean
}

/**
 * Hosts a vertical tab can be pinned to (docs/terminal-mode-spec.md §2, per-vtab
 * host). Local and SSH targets are served by this main process, whose terminal-mode
 * group and path scope always exist. A remote `orca serve` host must advertise
 * `terminal-mode.vertical-tabs.v1`: without it `terminalMode.ensureContext` answers
 * `method_not_found` and the tab could not be created at all, so the capability is
 * what makes the picker honest instead of failing at create time.
 */
export function buildTerminalModeHostOptions(
  hosts: readonly ExecutionHostRegistryEntry[]
): TerminalModeHostOption[] {
  return hosts.map((host) => ({
    id: host.id,
    label: host.label,
    detail: host.detail,
    supported:
      host.kind !== 'runtime' ||
      host.capabilities === undefined ||
      host.capabilities.includes(TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY)
  }))
}

export function isTerminalModeHostSupported(
  hosts: readonly TerminalModeHostOption[],
  hostId: ExecutionHostId
): boolean {
  return hosts.find((host) => host.id === hostId)?.supported === true
}

/**
 * Host for a new vertical tab, in the spec's order: inherit from the focused
 * terminal, else the configured default, else local (§2, "New vtab").
 *
 * A configured default that is no longer reachable — the remote was unpaired, the
 * SSH target removed — falls back rather than failing the create: the "+" button is
 * a one-click affordance and a settings value must not be able to break it.
 */
export function resolveNewVerticalTabHostId(input: {
  requestedHostId?: ExecutionHostId | null
  inheritedHostId?: ExecutionHostId | null
  defaultHostId?: string | null
  availableHosts: readonly TerminalModeHostOption[]
}): ExecutionHostId {
  const requested = normalizeExecutionHostId(input.requestedHostId)
  // An explicit pick from the dropdown is honored as-is; the picker already told
  // the user which hosts are unsupported.
  if (requested) {
    return requested
  }
  const candidates = [input.inheritedHostId, input.defaultHostId]
  for (const candidate of candidates) {
    const hostId = normalizeExecutionHostId(candidate)
    if (hostId && isTerminalModeHostSupported(input.availableHosts, hostId)) {
      return hostId
    }
  }
  return LOCAL_EXECUTION_HOST_ID
}

export type TerminalModeHostRoute =
  | { kind: 'local' }
  | { kind: 'ssh'; connectionId: string }
  | { kind: 'runtime'; environmentId: string }

/** How a host id is reached: local IPC, local IPC with an SSH connection, or RPC. */
export function getTerminalModeHostRoute(hostId: ExecutionHostId): TerminalModeHostRoute {
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'ssh') {
    return { kind: 'ssh', connectionId: parsed.targetId }
  }
  if (parsed?.kind === 'runtime') {
    return { kind: 'runtime', environmentId: parsed.environmentId }
  }
  return { kind: 'local' }
}
