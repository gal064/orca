import { callRuntimeRpc, RuntimeRpcCallError } from './runtime-rpc-client'

export type RemoteTerminalModePathScopeResult =
  | { supported: true; accepted: boolean; repoRoot: string | null }
  | { supported: false }

/**
 * Declares the directory a remote vertical tab's panels are showing to the host
 * that owns them, and reads back the repository the host resolved for it.
 *
 * This is the remote twin of `window.api.terminalMode.setPathScope`: one round trip
 * that both corroborates the directory (the host only grants a pwd it has seen one
 * of that tab's shells in) and answers with its enclosing repository, so the client
 * never needs a second probe. A host that predates terminal mode answers
 * `method_not_found`, and the caller degrades to the Phase-3 clamp.
 */
export async function declareRemoteTerminalModePathScope(
  environmentId: string,
  scope: { workspaceKey: string; root: string | null }
): Promise<RemoteTerminalModePathScopeResult> {
  try {
    const result = await callRuntimeRpc<{ accepted: boolean; repoRoot: string | null }>(
      { kind: 'environment', environmentId },
      'terminalMode.setPathScope',
      scope,
      { timeoutMs: 15_000 }
    )
    return { supported: true, accepted: result.accepted, repoRoot: result.repoRoot }
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return { supported: false }
    }
    throw error
  }
}
