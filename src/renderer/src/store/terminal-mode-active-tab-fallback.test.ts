import { describe, expect, it } from 'vitest'
import { shouldClearActiveVerticalTab } from './terminal-mode-active-tab-fallback'
import type {
  FolderWorkspace,
  GlobalSettings,
  ProjectGroup,
  WorkspaceKey
} from '../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../shared/terminal-mode-group'

const hiddenGroup = { id: 'g-terminal', name: TERMINAL_MODE_GROUP_NAME } as ProjectGroup
const classicGroup = { id: 'g-classic', name: 'Projects' } as ProjectGroup
const vtab = { id: 'vt-1', projectGroupId: hiddenGroup.id, createdAt: 1 } as FolderWorkspace
const classicWorkspace = {
  id: 'fw-1',
  projectGroupId: classicGroup.id,
  createdAt: 1
} as FolderWorkspace

function state(overrides: {
  terminalMode: boolean | null
  activeWorkspaceKey: WorkspaceKey | null
}): Parameters<typeof shouldClearActiveVerticalTab>[0] {
  return {
    settings:
      overrides.terminalMode === null
        ? null
        : ({ experimentalTerminalMode: overrides.terminalMode } as GlobalSettings),
    activeWorkspaceKey: overrides.activeWorkspaceKey,
    folderWorkspaces: [vtab, classicWorkspace],
    projectGroups: [hiddenGroup, classicGroup]
  }
}

describe('shouldClearActiveVerticalTab', () => {
  it('clears an active vertical tab once the flag is off', () => {
    expect(
      shouldClearActiveVerticalTab(
        state({ terminalMode: false, activeWorkspaceKey: 'folder:vt-1' })
      )
    ).toBe(true)
  })

  it('leaves the vertical tab alone while the flag is on', () => {
    expect(
      shouldClearActiveVerticalTab(state({ terminalMode: true, activeWorkspaceKey: 'folder:vt-1' }))
    ).toBe(false)
  })

  it('never clears a classic folder workspace', () => {
    expect(
      shouldClearActiveVerticalTab(
        state({ terminalMode: false, activeWorkspaceKey: 'folder:fw-1' })
      )
    ).toBe(false)
  })

  it('waits for settings to load', () => {
    expect(
      shouldClearActiveVerticalTab(state({ terminalMode: null, activeWorkspaceKey: 'folder:vt-1' }))
    ).toBe(false)
  })

  it('ignores a worktree selection', () => {
    expect(
      shouldClearActiveVerticalTab(
        state({ terminalMode: false, activeWorkspaceKey: 'worktree:repo:wt' })
      )
    ).toBe(false)
  })
})
