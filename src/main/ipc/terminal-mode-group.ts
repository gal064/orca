import { homedir } from 'node:os'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { ProjectGroup } from '../../shared/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  TERMINAL_MODE_GROUP_NAME,
  findTerminalModeGroupForHost,
  type TerminalModeLocalContext
} from '../../shared/terminal-mode-group'

type TerminalModeGroupStore = Pick<Store, 'getProjectGroups' | 'createProjectGroup'>

/** Idempotent: the local hidden group is created once and reused for every vtab. */
export function ensureLocalTerminalModeGroup(store: TerminalModeGroupStore): ProjectGroup {
  const existing = findTerminalModeGroupForHost(store.getProjectGroups(), LOCAL_EXECUTION_HOST_ID)
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
    connectionId: null,
    parentGroupId: null,
    createdFrom: 'manual',
    allowReservedName: true
  })
}

export function registerTerminalModeHandlers(store: TerminalModeGroupStore): void {
  // Re-registered on macOS window re-activation, same as the repo handlers.
  ipcMain.removeHandler('terminalMode:ensureLocalContext')

  ipcMain.handle(
    'terminalMode:ensureLocalContext',
    (): TerminalModeLocalContext => ({
      projectGroup: ensureLocalTerminalModeGroup(store),
      homeDir: homedir()
    })
  )
}
