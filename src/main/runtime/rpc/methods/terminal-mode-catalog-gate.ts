import type { RpcContext } from '../core'
import { TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY } from '../../../../shared/protocol-version'

/**
 * Whether this caller may be handed terminal-mode vertical tabs in
 * `projectGroup.list` / `folderWorkspace.list`.
 *
 * The gate is on the CLIENT's advertised capability, not the host's: a client that
 * has never heard of the hidden group renders its workspaces as ordinary rows, and
 * the keys it receives are accepted selectors for rename and delete. Mobile is
 * excluded regardless — terminal mode is a desktop feature, and a phone that
 * somehow advertised the token still has no surface that filters it.
 */
export function clientOwnsTerminalModeCatalog(ctx: RpcContext): boolean {
  return (
    ctx.clientKind !== 'mobile' &&
    ctx.clientCapabilities?.includes(TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY) === true
  )
}
