import { describe, expect, it } from 'vitest'
import {
  getActivityTerminalTabProjectLabel,
  NO_ACTIVITY_TERMINAL_TAB_KEYS,
  selectActivityTerminalTabKeys
} from './activity-terminal-tab-group'
import type { FolderWorkspace, GlobalSettings, ProjectGroup } from '../../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'

const hiddenGroup = { id: 'g-terminal', name: TERMINAL_MODE_GROUP_NAME } as ProjectGroup
const classicGroup = { id: 'g-classic', name: 'Projects' } as ProjectGroup
const vtab = { id: 'vt-1', projectGroupId: hiddenGroup.id } as FolderWorkspace
const classicWorkspace = { id: 'fw-1', projectGroupId: classicGroup.id } as FolderWorkspace

function state(terminalMode: boolean): Parameters<typeof selectActivityTerminalTabKeys>[0] {
  return {
    settings: { experimentalTerminalMode: terminalMode } as GlobalSettings,
    folderWorkspaces: [vtab, classicWorkspace],
    projectGroups: [hiddenGroup, classicGroup]
  }
}

describe('selectActivityTerminalTabKeys', () => {
  it('is the vertical tabs in terminal mode', () => {
    expect([...selectActivityTerminalTabKeys(state(true))]).toEqual(['folder:vt-1'])
  })

  it('is empty with the flag off', () => {
    expect(selectActivityTerminalTabKeys(state(false)).size).toBe(0)
  })
})

describe('getActivityTerminalTabProjectLabel', () => {
  const keys = selectActivityTerminalTabKeys(state(true))

  it('labels a vertical tab thread', () => {
    expect(getActivityTerminalTabProjectLabel('folder:vt-1', keys)).toBe('Terminal tabs')
  })

  it('leaves a classic folder workspace alone — it is not a terminal tab', () => {
    expect(getActivityTerminalTabProjectLabel('folder:fw-1', keys)).toBeNull()
    expect(
      getActivityTerminalTabProjectLabel('folder:fw-1', NO_ACTIVITY_TERMINAL_TAB_KEYS)
    ).toBeNull()
  })

  it('leaves a worktree thread to its own project label', () => {
    // Worktree map keys are raw worktree ids, not workspace keys.
    expect(getActivityTerminalTabProjectLabel('repo-1::wt-1', keys)).toBeNull()
  })
})
