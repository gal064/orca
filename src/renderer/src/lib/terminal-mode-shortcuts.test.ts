import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { FolderWorkspace, ProjectGroup } from '../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../shared/terminal-mode-group'
import {
  getActiveVerticalTabId,
  handleTerminalModeWorkspaceCreate,
  handleTerminalModeWorkspaceDelete,
  handleTerminalModeWorkspaceIndex
} from './terminal-mode-shortcuts'

vi.mock('./renderer-app-platform', () => ({ getRendererAppPlatform: () => 'linux' }))

const hiddenGroup: ProjectGroup = {
  id: 'hidden',
  name: TERMINAL_MODE_GROUP_NAME,
  parentPath: '/home/dev',
  connectionId: null,
  executionHostId: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
}

function vtab(id: string, createdAt: number): FolderWorkspace {
  return {
    id,
    projectGroupId: 'hidden',
    name: id,
    folderPath: `/home/dev/${id}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt,
    updatedAt: createdAt
  }
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    settings: { experimentalTerminalMode: true },
    folderWorkspaces: [vtab('a', 1), vtab('b', 2), vtab('c', 3)],
    projectGroups: [hiddenGroup],
    activeWorkspaceKey: 'folder:b',
    createVerticalTab: vi.fn(async () => 'new'),
    activateVerticalTab: vi.fn(),
    requestVerticalTabClose: vi.fn(),
    ...overrides
  } as unknown as AppState
}

describe('getActiveVerticalTabId', () => {
  it('resolves the focused vertical tab', () => {
    expect(getActiveVerticalTabId(makeState())).toBe('b')
  })

  it('is null for a classic worktree key or an unknown folder key', () => {
    expect(getActiveVerticalTabId(makeState({ activeWorkspaceKey: 'worktree:x' }))).toBeNull()
    expect(getActiveVerticalTabId(makeState({ activeWorkspaceKey: 'folder:zzz' }))).toBeNull()
    expect(getActiveVerticalTabId(makeState({ activeWorkspaceKey: null }))).toBeNull()
  })
})

describe('shortcut handlers', () => {
  it('declines every chord with the flag off so classic handling runs', () => {
    const state = makeState({ settings: {} as AppState['settings'] })
    expect(handleTerminalModeWorkspaceCreate(state)).toBe(false)
    expect(handleTerminalModeWorkspaceDelete(state)).toBe(false)
    expect(handleTerminalModeWorkspaceIndex(state, 0)).toBe(false)
    expect(state.createVerticalTab).not.toHaveBeenCalled()
    expect(state.requestVerticalTabClose).not.toHaveBeenCalled()
    expect(state.activateVerticalTab).not.toHaveBeenCalled()
  })

  it('creates a vertical tab for the new-workspace chord', () => {
    const state = makeState()
    expect(handleTerminalModeWorkspaceCreate(state)).toBe(true)
    expect(state.createVerticalTab).toHaveBeenCalledOnce()
  })

  it('asks to close the focused vertical tab', () => {
    const state = makeState()
    expect(handleTerminalModeWorkspaceDelete(state)).toBe(true)
    expect(state.requestVerticalTabClose).toHaveBeenCalledWith('b')
  })

  it('claims the delete chord even with nothing focused, so classic delete cannot run', () => {
    const state = makeState({ activeWorkspaceKey: 'worktree:x' })
    expect(handleTerminalModeWorkspaceDelete(state)).toBe(true)
    expect(state.requestVerticalTabClose).not.toHaveBeenCalled()
  })

  it('activates the vertical tab at the pressed digit, in render order', () => {
    const state = makeState()
    expect(handleTerminalModeWorkspaceIndex(state, 2)).toBe(true)
    expect(state.activateVerticalTab).toHaveBeenCalledWith('c')
  })

  it('claims out-of-range digits without activating anything', () => {
    const state = makeState()
    expect(handleTerminalModeWorkspaceIndex(state, 8)).toBe(true)
    expect(state.activateVerticalTab).not.toHaveBeenCalled()
  })
})
