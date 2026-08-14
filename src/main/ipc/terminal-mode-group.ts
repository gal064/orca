import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { ProjectGroup } from '../../shared/types'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../shared/execution-host'
import {
  TERMINAL_MODE_GROUP_NAME,
  findTerminalModeGroupForHost,
  type TerminalModeLocalContext
} from '../../shared/terminal-mode-group'

type TerminalModeGroupStore = Pick<Store, 'getProjectGroups' | 'createProjectGroup'>

/**
 * Idempotent, one hidden group per host: a vertical tab must be created where its
 * ptys live, and a folder workspace's execution host is resolved from its group
 * (docs/terminal-mode-design.md Phase 1 notes). `connectionId` is the SSH target
 * for an SSH-backed tab and null for the local host; a remote `orca serve` host
 * ensures its own local group through the `terminalMode.ensureContext` RPC.
 */
export function ensureTerminalModeGroup(
  store: TerminalModeGroupStore,
  connectionId: string | null = null
): ProjectGroup {
  const hostId = connectionId ? toSshExecutionHostId(connectionId) : LOCAL_EXECUTION_HOST_ID
  const existing = findTerminalModeGroupForHost(store.getProjectGroups(), hostId)
  if (existing) {
    return existing
  }
  return store.createProjectGroup({
    name: TERMINAL_MODE_GROUP_NAME,
    // Why null: a vertical tab's start directory is its own, and inventing a folder
    // root here would feed the authorized-filesystem scope, the connection-id
    // migration and the path-status probe a directory the user never opened.
    // normalizeFolderWorkspaces() keeps terminal-mode workspaces without one.
    parentPath: null,
    connectionId,
    parentGroupId: null,
    createdFrom: 'manual',
    allowReservedName: true
  })
}

export function registerTerminalModeHandlers(
  store: TerminalModeGroupStore,
  resolveHomeDir: (connectionId: string | null) => Promise<string>
): void {
  // Re-registered on macOS window re-activation, same as the repo handlers.
  ipcMain.removeHandler('terminalMode:ensureContext')

  ipcMain.handle(
    'terminalMode:ensureContext',
    async (_event, args?: { connectionId?: string | null }): Promise<TerminalModeLocalContext> => {
      const connectionId = args?.connectionId?.trim() || null
      return {
        projectGroup: ensureTerminalModeGroup(store, connectionId),
        homeDir: await resolveHomeDir(connectionId)
      }
    }
  )
}
