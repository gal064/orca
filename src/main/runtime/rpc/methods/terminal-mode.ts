import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'

/**
 * Terminal mode's host surface (docs/terminal-mode-design.md Phase 4). Both
 * methods are announced by `terminal-mode.vertical-tabs.v1`; an older host answers
 * `method_not_found`, which is why the client refuses to offer it as a vertical-tab
 * host rather than discovering the gap mid-create.
 *
 * Terminal mode is a desktop feature — a paired phone has no vertical tabs — so a
 * mobile client is refused outright rather than being handed a group it cannot
 * render and a filesystem grant it has no use for.
 */
const TerminalModePathScope = z.object({
  workspaceKey: requiredString('Missing workspace key'),
  root: z.string().min(1).nullable()
})

function assertDesktopClient(clientKind: 'mobile' | 'runtime' | undefined): void {
  if (clientKind === 'mobile') {
    throw new Error('terminal_mode_unavailable_for_mobile_clients')
  }
}

export const TERMINAL_MODE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'terminalMode.ensureContext',
    params: null,
    handler: (_params, { runtime, clientKind }) => {
      assertDesktopClient(clientKind)
      return runtime.ensureTerminalModeContext()
    }
  }),
  defineMethod({
    name: 'terminalMode.setPathScope',
    params: TerminalModePathScope,
    handler: async (params, { runtime, clientKind }) => {
      assertDesktopClient(clientKind)
      return runtime.setTerminalModePathScope(params)
    }
  })
]
