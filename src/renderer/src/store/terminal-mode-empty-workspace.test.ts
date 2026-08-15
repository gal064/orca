import { describe, expect, it } from 'vitest'
import { selectTerminalModeMainPaneState } from './terminal-mode-empty-workspace'
import { isTerminalModeVerticalTabKey } from './terminal-mode-workspace-keys'
import type { FolderWorkspace, GlobalSettings, ProjectGroup } from '../../../shared/types'
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
  terminalMode?: boolean
  activeWorktreeId?: string | null
  workspaceSessionReady?: boolean
  tabs?: string[]
  openFileWorkspace?: string
}): Parameters<typeof selectTerminalModeMainPaneState>[0] {
  return {
    settings: { experimentalTerminalMode: overrides.terminalMode ?? true } as GlobalSettings,
    folderWorkspaces: [vtab, classicWorkspace],
    projectGroups: [hiddenGroup, classicGroup],
    activeWorktreeId: overrides.activeWorktreeId ?? null,
    workspaceSessionReady: overrides.workspaceSessionReady ?? true,
    unifiedTabsByWorktree: overrides.tabs
      ? { [overrides.activeWorktreeId ?? '']: overrides.tabs.map((id) => ({ id })) }
      : {},
    tabsByWorktree: {},
    browserTabsByWorktree: {},
    openFiles: overrides.openFileWorkspace
      ? [{ id: 'file-1', worktreeId: overrides.openFileWorkspace }]
      : []
  } as unknown as Parameters<typeof selectTerminalModeMainPaneState>[0]
}

describe('isTerminalModeVerticalTabKey', () => {
  it('accepts only a live vertical tab with the flag on', () => {
    const on = state({})
    expect(isTerminalModeVerticalTabKey(on, 'folder:vt-1')).toBe(true)
    expect(isTerminalModeVerticalTabKey(on, 'folder:fw-1')).toBe(false)
    expect(isTerminalModeVerticalTabKey(on, 'folder:gone')).toBe(false)
    expect(isTerminalModeVerticalTabKey(on, 'repo-1::/repo/app')).toBe(false)
    expect(isTerminalModeVerticalTabKey(on, null)).toBe(false)
    expect(isTerminalModeVerticalTabKey(state({ terminalMode: false }), 'folder:vt-1')).toBe(false)
  })
})

describe('selectTerminalModeMainPaneState', () => {
  it('yields to the classic landing only with the flag off', () => {
    expect(selectTerminalModeMainPaneState(state({ terminalMode: false }))).toEqual({
      kind: 'classic'
    })
    expect(
      selectTerminalModeMainPaneState(state({ terminalMode: false, activeWorktreeId: null }))
    ).toEqual({ kind: 'classic' })
  })

  it('reports the tabless state only when there really are no vertical tabs', () => {
    expect(
      selectTerminalModeMainPaneState({
        ...state({ activeWorktreeId: null }),
        folderWorkspaces: []
      })
    ).toEqual({ kind: 'no-vertical-tabs' })
  })

  it('never falls back to classic during cold-start hydration', () => {
    // Tabs are in the catalog but the session has not hydrated: showing the classic
    // landing here is the defect this state exists to prevent, and "no tab selected"
    // is not true yet either.
    expect(
      selectTerminalModeMainPaneState(
        state({ activeWorktreeId: null, workspaceSessionReady: false })
      )
    ).toEqual({ kind: 'pending' })
  })

  it('offers a way back when tabs exist but none is selected', () => {
    // The deactivation this guards is open-coded in five upstream places; an unguarded
    // one must land on an actionable pane, never on nothing.
    expect(selectTerminalModeMainPaneState(state({ activeWorktreeId: null }))).toEqual({
      kind: 'no-active-vertical-tab'
    })
  })

  it('reports the vertical tab whose terminals are all gone', () => {
    expect(selectTerminalModeMainPaneState(state({ activeWorktreeId: 'folder:vt-1' }))).toEqual({
      kind: 'empty-vertical-tab',
      workspaceKey: 'folder:vt-1'
    })
  })

  it('yields to the workbench while the vertical tab still renders something', () => {
    expect(
      selectTerminalModeMainPaneState(state({ activeWorktreeId: 'folder:vt-1', tabs: ['tab-1'] }))
    ).toEqual({ kind: 'workbench' })
    expect(
      selectTerminalModeMainPaneState(
        state({ activeWorktreeId: 'folder:vt-1', openFileWorkspace: 'folder:vt-1' })
      )
    ).toEqual({ kind: 'workbench' })
  })

  it('never replaces a classic workspace pane', () => {
    expect(selectTerminalModeMainPaneState(state({ activeWorktreeId: 'folder:fw-1' }))).toEqual({
      kind: 'workbench'
    })
    expect(selectTerminalModeMainPaneState(state({ activeWorktreeId: 'repo-1::/a' }))).toEqual({
      kind: 'workbench'
    })
  })

  it('renders nothing only while the session is still hydrating', () => {
    const kinds = [
      state({ activeWorktreeId: null }),
      state({ activeWorktreeId: 'folder:vt-1' }),
      state({ activeWorktreeId: 'folder:vt-1', tabs: ['tab-1'] }),
      { ...state({ activeWorktreeId: null }), folderWorkspaces: [] }
    ].map((candidate) => selectTerminalModeMainPaneState(candidate).kind)
    expect(kinds).not.toContain('pending')
  })

  it('keeps a stable identity for the states a subscriber sees repeatedly', () => {
    const workbench = state({ activeWorktreeId: 'folder:vt-1', tabs: ['tab-1'] })
    expect(selectTerminalModeMainPaneState(workbench)).toBe(
      selectTerminalModeMainPaneState(workbench)
    )
  })
})
