import { describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'

vi.mock('@/lib/renderer-app-platform', () => ({ getRendererAppPlatform: () => 'linux' }))
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'
import {
  createVerticalTabsSlice,
  getVerticalTabAutoName,
  pickNextVerticalTabId,
  selectVerticalTabs
} from './vertical-tabs'

function group(id: string, name: string): ProjectGroup {
  return {
    id,
    name,
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
}

function tab(
  id: string,
  projectGroupId: string,
  createdAt: number,
  overrides: Partial<FolderWorkspace> = {}
): FolderWorkspace {
  return {
    id,
    projectGroupId,
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
    updatedAt: createdAt,
    ...overrides
  }
}

const hidden = group('hidden', TERMINAL_MODE_GROUP_NAME)
const classic = group('classic', 'Work')

describe('selectVerticalTabs', () => {
  it('orders vertical tabs oldest first so a new tab appends to the strip', () => {
    const tabs = selectVerticalTabs(
      [tab('c', 'hidden', 30), tab('a', 'hidden', 10), tab('b', 'hidden', 20)],
      [hidden]
    )
    expect(tabs.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks createdAt ties deterministically', () => {
    const tabs = selectVerticalTabs([tab('b', 'hidden', 5), tab('a', 'hidden', 5)], [hidden])
    expect(tabs.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('excludes classic folder workspaces', () => {
    const tabs = selectVerticalTabs(
      [tab('vtab', 'hidden', 1), tab('folder', 'classic', 2)],
      [hidden, classic]
    )
    expect(tabs.map((entry) => entry.id)).toEqual(['vtab'])
  })

  it('keeps an archived vertical tab, which would otherwise be invisible and unclosable', () => {
    const tabs = selectVerticalTabs(
      [tab('vtab', 'hidden', 1), tab('archived', 'hidden', 2, { isArchived: true })],
      [hidden]
    )
    expect(tabs.map((entry) => entry.id)).toEqual(['vtab', 'archived'])
  })

  it('is empty when no hidden group exists', () => {
    expect(selectVerticalTabs([tab('folder', 'classic', 1)], [classic])).toEqual([])
    expect(selectVerticalTabs(undefined, undefined)).toEqual([])
  })

  it('does not mutate the store array it filters from', () => {
    const source = [tab('c', 'hidden', 30), tab('a', 'hidden', 10)]
    selectVerticalTabs(source, [hidden])
    expect(source.map((entry) => entry.id)).toEqual(['c', 'a'])
  })
})

describe('pickNextVerticalTabId', () => {
  const tabs = [tab('a', 'hidden', 1), tab('b', 'hidden', 2), tab('c', 'hidden', 3)]

  it('prefers the right-hand neighbour', () => {
    expect(pickNextVerticalTabId(tabs, 'b')).toBe('c')
  })

  it('falls back to the left neighbour for the last tab', () => {
    expect(pickNextVerticalTabId(tabs, 'c')).toBe('b')
  })

  it('returns null when the closed tab was the only one or is unknown', () => {
    expect(pickNextVerticalTabId([tabs[0]], 'a')).toBeNull()
    expect(pickNextVerticalTabId(tabs, 'missing')).toBeNull()
  })
})

describe('getVerticalTabAutoName', () => {
  it('uses the basename of the start directory', () => {
    expect(getVerticalTabAutoName('/home/dev/orca')).toBe('orca')
    expect(getVerticalTabAutoName('/home/dev/orca/')).toBe('orca')
    expect(getVerticalTabAutoName('C:\\Users\\dev\\orca')).toBe('orca')
  })

  it('falls back to the raw path when there is no basename', () => {
    expect(getVerticalTabAutoName('/')).toBe('/')
  })
})

describe('closeVerticalTabIfEmptied', () => {
  function makeStore(overrides: Record<string, unknown> = {}) {
    const state: Record<string, unknown> = {
      settings: { experimentalTerminalMode: true },
      projectGroups: [hidden],
      folderWorkspaces: [tab('vtab', 'hidden', 1)],
      activeWorkspaceKey: 'folder:vtab',
      closeVerticalTab: vi.fn(async () => {}),
      ...overrides
    }
    const get = () => state as never
    const set = () => {}
    const slice = createVerticalTabsSlice(set as never, get as never, undefined as never)
    return { slice, state }
  }

  it('closes the vertical tab whose workspace a user close emptied', async () => {
    const { slice, state } = makeStore()
    slice.closeVerticalTabIfEmptied('folder:vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).toHaveBeenCalledWith('vtab', { wasActive: true })
  })

  it('does nothing with the experimental flag off', async () => {
    const { slice, state } = makeStore({ settings: {} })
    slice.closeVerticalTabIfEmptied('folder:vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).not.toHaveBeenCalled()
  })

  it('ignores classic worktrees and folder workspaces that are not vertical tabs', async () => {
    const { slice, state } = makeStore()
    slice.closeVerticalTabIfEmptied('worktree:repo::/w1')
    slice.closeVerticalTabIfEmptied('folder:not-a-vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).not.toHaveBeenCalled()
  })

  it('reports a background vertical tab as not active', async () => {
    const { slice, state } = makeStore({ activeWorkspaceKey: 'worktree:other' })
    slice.closeVerticalTabIfEmptied('folder:vtab')
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).toHaveBeenCalledWith('vtab', { wasActive: false })
  })

  it('trusts the caller over the store, which already dropped the active workspace', async () => {
    // closeUnifiedTab nulls activeWorkspaceKey before this runs, so inferring here
    // would never focus the neighbouring tab after a last-htab close.
    const { slice, state } = makeStore({ activeWorkspaceKey: null })
    slice.closeVerticalTabIfEmptied('folder:vtab', { wasActive: true })
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(state.closeVerticalTab).toHaveBeenCalledWith('vtab', { wasActive: true })
  })
})

describe('createVerticalTab start directory', () => {
  function makeStore(overrides: Record<string, unknown> = {}) {
    const createFolderWorkspace = vi.fn(async () => ({ id: 'new-vtab' }))
    const state: Record<string, unknown> = {
      settings: { experimentalTerminalMode: true },
      projectGroups: [hidden],
      folderWorkspaces: [tab('vtab', 'hidden', 1)],
      activeWorkspaceKey: 'folder:vtab',
      activeTabIdByWorktree: { 'folder:vtab': 'tab-1' },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      terminalLayoutsByTabId: {},
      cwdByPtyId: {},
      createFolderWorkspace,
      activateVerticalTab: vi.fn(),
      ...overrides
    }
    const get = () => state as never
    const set = () => {}
    const slice = createVerticalTabsSlice(set as never, get as never, undefined as never)
    return { slice, createFolderWorkspace }
  }

  const ensureLocalContext = async () => ({
    projectGroup: hidden,
    homeDir: '/home/dev'
  })

  it('inherits the focused terminal pwd (ghostty-style)', async () => {
    const { slice, createFolderWorkspace } = makeStore({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    vi.stubGlobal('window', { api: { terminalMode: { ensureLocalContext } } })
    try {
      await slice.createVerticalTab()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/srv/app', name: 'app' }),
      expect.anything()
    )
  })

  it('falls back to the host home directory when nothing is focused', async () => {
    const { slice, createFolderWorkspace } = makeStore({ activeWorkspaceKey: null })
    vi.stubGlobal('window', { api: { terminalMode: { ensureLocalContext } } })
    try {
      await slice.createVerticalTab()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/home/dev' }),
      expect.anything()
    )
  })

  it('prefers an explicit start directory over the focused pwd', async () => {
    const { slice, createFolderWorkspace } = makeStore({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    vi.stubGlobal('window', { api: { terminalMode: { ensureLocalContext } } })
    try {
      await slice.createVerticalTab({ startDir: '/explicit' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(createFolderWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ folderPath: '/explicit' }),
      expect.anything()
    )
  })
})
