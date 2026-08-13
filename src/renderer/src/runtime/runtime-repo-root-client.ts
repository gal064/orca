import type { GlobalSettings } from '../../../shared/types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from './runtime-rpc-result'

export type RepoRootContext = {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  connectionId?: string
}

/**
 * `'unsupported'` means the host has no `git.repoRootForPath` at all (a build
 * older than terminal mode) — distinct from `null`, which is the host answering
 * "there is no repository here".
 */
export type RepoRootResult = string | null | 'unsupported'

/**
 * Nearest enclosing repository root of `dirPath` on the host that owns the
 * workspace. Local and SSH go through the git IPC (which takes absolute paths
 * already); remote runtimes use the RPC added for terminal mode.
 */
export async function getRuntimeRepoRootForPath(
  context: RepoRootContext,
  dirPath: string
): Promise<RepoRootResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment') {
    return window.api.git.repoRootForPath({
      dirPath,
      ...(context.connectionId ? { connectionId: context.connectionId } : {})
    })
  }
  try {
    return await callRuntimeRpc<string | null>(
      target,
      'git.repoRootForPath',
      { path: dirPath },
      { timeoutMs: 15_000 }
    )
  } catch (error) {
    // Why the helper: relays re-wrap the envelope error, so the thrown value is
    // often not a RuntimeRpcCallError with a `.code` — the degrade would never fire.
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      return 'unsupported'
    }
    throw error
  }
}
