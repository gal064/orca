import {
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY,
  type RuntimeCapability
} from './protocol-version'

/**
 * Capabilities this process advertises when it authenticates *as a client* to a
 * remote Orca runtime.
 *
 * The base set is unconditional: every build that speaks this transport implements
 * it. Anything beyond that is a claim about the surfaces this particular process
 * owns, and the same transport module is shared by the desktop app, the CLI and
 * headless `orca serve` — so a client-side token must be declared by the process
 * that can actually honor it, never hard-coded here. The desktop window declares
 * `terminal-mode.catalog.v1` because the renderer is what filters vertical tabs out
 * of every classic surface; the CLI has no such filter and must keep receiving the
 * host's filtered catalog.
 */
const BASE_CLIENT_CAPABILITIES: readonly RuntimeCapability[] = [
  SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY,
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY
]

let declaredCapabilities: readonly RuntimeCapability[] = BASE_CLIENT_CAPABILITIES

/** Idempotent and additive; a token declared twice is advertised once. */
export function declareRemoteRuntimeClientCapabilities(
  capabilities: readonly RuntimeCapability[]
): void {
  declaredCapabilities = [...new Set([...declaredCapabilities, ...capabilities])]
}

export function getRemoteRuntimeClientCapabilities(): readonly RuntimeCapability[] {
  return declaredCapabilities
}

export function resetRemoteRuntimeClientCapabilitiesForTests(): void {
  declaredCapabilities = BASE_CLIENT_CAPABILITIES
}
