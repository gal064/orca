import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { TERMINAL_MODE_GROUP_NAME } from '../../shared/terminal-mode-group'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import type { FolderWorkspace, ProjectGroup } from '../../shared/types'
import { resolveTerminalModeStartupCwdHome } from './terminal-mode-startup-cwd-home'

const group = (id: string, name: string): ProjectGroup => ({ id, name }) as ProjectGroup
const workspace = (id: string, projectGroupId: string): FolderWorkspace =>
  ({ id, projectGroupId }) as FolderWorkspace

function makeStore(groupName: string): {
  getFolderWorkspace: (id: string) => FolderWorkspace | undefined
  getProjectGroups: () => ProjectGroup[]
} {
  return {
    getFolderWorkspace: (id) => (id === 'ws-1' ? workspace('ws-1', 'group-1') : undefined),
    getProjectGroups: () => [group('group-1', groupName)]
  }
}

describe('resolveTerminalModeStartupCwdHome', () => {
  it('offers the home directory for a vertical tab', () => {
    expect(
      resolveTerminalModeStartupCwdHome(
        makeStore(TERMINAL_MODE_GROUP_NAME),
        folderWorkspaceKey('ws-1')
      )
    ).toBe(homedir())
  })

  it('offers nothing for a classic folder workspace', () => {
    expect(
      resolveTerminalModeStartupCwdHome(makeStore('Projects'), folderWorkspaceKey('ws-1'))
    ).toBeUndefined()
  })

  it('offers nothing for a worktree key or an unknown workspace', () => {
    const store = makeStore(TERMINAL_MODE_GROUP_NAME)
    expect(resolveTerminalModeStartupCwdHome(store, 'repo-1::/repo/app')).toBeUndefined()
    expect(resolveTerminalModeStartupCwdHome(store, folderWorkspaceKey('ws-2'))).toBeUndefined()
    expect(resolveTerminalModeStartupCwdHome(store, undefined)).toBeUndefined()
    expect(resolveTerminalModeStartupCwdHome(undefined, folderWorkspaceKey('ws-1'))).toBeUndefined()
  })
})
