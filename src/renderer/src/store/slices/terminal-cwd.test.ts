import { describe, expect, it } from 'vitest'
import type { AppState } from '../types'
import { getActivePwdForVtab, resolveWorkspaceTerminalPtyId } from './terminal-cwd'
import { createTestStore } from './store-test-helpers'

const VTAB_KEY = 'folder:vtab-1'

type CwdState = Parameters<typeof getActivePwdForVtab>[0] & Pick<AppState, 'activeWorkspaceKey'>

function makeState(overrides: Partial<CwdState> = {}): CwdState {
  return {
    activeWorkspaceKey: VTAB_KEY,
    activeTabIdByWorktree: { [VTAB_KEY]: 'tab-1' },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    terminalLayoutsByTabId: {},
    cwdByPtyId: {},
    folderWorkspaces: [
      {
        id: 'vtab-1',
        projectGroupId: 'group-1',
        name: 'vtab',
        folderPath: '/home/dev',
        sortOrder: 0,
        createdAt: 0
      }
    ],
    ...overrides
  } as CwdState
}

function layout(
  activeLeafId: string,
  ptyIdsByLeafId: Record<string, string>
): CwdState['terminalLayoutsByTabId'] {
  return {
    'tab-1': {
      root: { type: 'leaf', leafId: activeLeafId },
      activeLeafId,
      expandedLeafId: null,
      ptyIdsByLeafId
    }
  }
}

describe('resolveWorkspaceTerminalPtyId', () => {
  it('prefers the focused split pane over the newest PTY', () => {
    const state = makeState({
      ptyIdsByTabId: { 'tab-1': ['pty-1', 'pty-2'] },
      terminalLayoutsByTabId: layout('leaf-a', { 'leaf-a': 'pty-1', 'leaf-b': 'pty-2' })
    })
    expect(resolveWorkspaceTerminalPtyId(state, VTAB_KEY)).toBe('pty-1')
  })

  it('falls back to the newest live PTY when the layout is stale', () => {
    const state = makeState({
      ptyIdsByTabId: { 'tab-1': ['pty-1', 'pty-2'] },
      terminalLayoutsByTabId: layout('leaf-gone', { 'leaf-gone': 'pty-dead' })
    })
    expect(resolveWorkspaceTerminalPtyId(state, VTAB_KEY)).toBe('pty-2')
  })

  it('resolves nothing for a workspace with no terminal tab', () => {
    expect(resolveWorkspaceTerminalPtyId(makeState({ activeTabIdByWorktree: {} }), VTAB_KEY)).toBe(
      null
    )
  })
})

describe('getActivePwdForVtab', () => {
  it('reports the focused terminal cwd', () => {
    const state = makeState({ cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } } })
    expect(getActivePwdForVtab(state, VTAB_KEY)).toBe('/srv/app')
  })

  it('stays on the last terminal pwd while an editor tab is focused', () => {
    // The sticky rule is not this slice's code: it works because the tab system
    // keeps activeTabIdByWorktree on the last terminal tab. Drive the real tab
    // slice so this test fails if that ever changes.
    const store = createTestStore()
    const terminal = store.getState().createTab(VTAB_KEY)
    store.setState({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } },
      ptyIdsByTabId: { [terminal.id]: ['pty-1'] },
      folderWorkspaces: makeState().folderWorkspaces
    })
    expect(getActivePwdForVtab(store.getState(), VTAB_KEY)).toBe('/srv/app')

    store.getState().openFile({
      filePath: '/home/dev/note.md',
      relativePath: 'note.md',
      worktreeId: VTAB_KEY,
      language: 'markdown',
      mode: 'edit'
    })

    expect(store.getState().activeTabType).toBe('editor')
    expect(getActivePwdForVtab(store.getState(), VTAB_KEY)).toBe('/srv/app')
  })

  it('falls back to the tab start directory when nothing was observed', () => {
    expect(getActivePwdForVtab(makeState(), VTAB_KEY)).toBe('/home/dev')
  })

  it('ignores non-folder workspaces', () => {
    expect(getActivePwdForVtab(makeState(), 'worktree:repo:/tmp/wt')).toBe(null)
  })
})

describe('setPtyCwd', () => {
  it('records trimmed values and ignores empty ones', () => {
    const store = createTestStore()
    store.getState().setPtyCwd('pty-1', '  /srv/app  ', 'osc7')
    store.getState().setPtyCwd('pty-2', '   ', 'poll')
    expect(store.getState().cwdByPtyId).toEqual({ 'pty-1': { cwd: '/srv/app', source: 'osc7' } })
  })

  it('never lets a lagging poll overwrite an OSC 7 cwd', () => {
    const store = createTestStore()
    store.getState().setPtyCwd('pty-1', '/srv/app', 'osc7')
    store.getState().setPtyCwd('pty-1', '/home/dev', 'poll')
    expect(store.getState().cwdByPtyId['pty-1']).toEqual({ cwd: '/srv/app', source: 'osc7' })
  })

  it('lets OSC 7 take over from the poll', () => {
    const store = createTestStore()
    store.getState().setPtyCwd('pty-1', '/home/dev', 'poll')
    store.getState().setPtyCwd('pty-1', '/srv/app', 'osc7')
    expect(store.getState().cwdByPtyId['pty-1']).toEqual({ cwd: '/srv/app', source: 'osc7' })
  })

  it('keeps the map identity when nothing changed', () => {
    const store = createTestStore()
    store.getState().setPtyCwd('pty-1', '/srv/app', 'osc7')
    const first = store.getState().cwdByPtyId
    store.getState().setPtyCwd('pty-1', '/srv/app', 'osc7')
    expect(store.getState().cwdByPtyId).toBe(first)
  })

  it('forgets a PTY that exited, so a reused id never shows the old directory', () => {
    const store = createTestStore()
    store.getState().setPtyCwd('pty-1', '/srv/app', 'osc7')
    store.getState().clearPtyCwd('pty-1')
    expect(store.getState().cwdByPtyId).toEqual({})
  })

  it('keeps the map identity when clearing a PTY it never tracked', () => {
    const store = createTestStore()
    const before = store.getState().cwdByPtyId
    store.getState().clearPtyCwd('pty-unknown')
    expect(store.getState().cwdByPtyId).toBe(before)
  })

  it('drops entries for PTYs no tab references once the map grows', () => {
    const store = createTestStore()
    store.setState({ ptyIdsByTabId: { 'tab-1': ['live-1'] } })
    store.getState().setPtyCwd('live-1', '/srv/app', 'osc7')
    for (let index = 0; index < 400; index += 1) {
      store.getState().setPtyCwd(`dead-${index}`, `/tmp/${index}`, 'poll')
    }
    const tracked = Object.keys(store.getState().cwdByPtyId)
    expect(tracked.length).toBeLessThan(400)
    // The referenced PTY survives every prune; exited ones do not accumulate.
    expect(store.getState().cwdByPtyId['live-1']).toEqual({ cwd: '/srv/app', source: 'osc7' })
  })
})

describe('sticky pwd while a non-terminal tab is active', () => {
  const withDiffTab = () =>
    makeState({
      activeTabIdByWorktree: { [VTAB_KEY]: 'diff-tab' },
      ptyIdsByTabId: { 'tab-1': ['pty-1'], 'diff-tab': [] },
      unifiedTabsByWorktree: {
        [VTAB_KEY]: [
          { id: 'tab-1' },
          { id: 'diff-tab' }
        ] as CwdState['unifiedTabsByWorktree'][string]
      },
      cwdByPtyId: { 'pty-1': { cwd: '/repo/src', source: 'osc7' } }
    } as Partial<CwdState>)

  it('follows the last terminal tab when a diff tab is focused', () => {
    expect(resolveWorkspaceTerminalPtyId(withDiffTab(), VTAB_KEY)).toBe('pty-1')
    expect(getActivePwdForVtab(withDiffTab(), VTAB_KEY)).toBe('/repo/src')
  })

  it('falls back to the start directory once no tab has a live PTY', () => {
    const state = makeState({
      activeTabIdByWorktree: { [VTAB_KEY]: 'diff-tab' },
      ptyIdsByTabId: { 'diff-tab': [] },
      unifiedTabsByWorktree: {
        [VTAB_KEY]: [{ id: 'diff-tab' }] as CwdState['unifiedTabsByWorktree'][string]
      }
    } as Partial<CwdState>)
    expect(resolveWorkspaceTerminalPtyId(state, VTAB_KEY)).toBeNull()
    expect(getActivePwdForVtab(state, VTAB_KEY)).toBe('/home/dev')
  })
})

describe('last focused terminal tab', () => {
  it('prefers the remembered terminal tab over the last one in strip order', () => {
    const state = makeState({
      activeTabIdByWorktree: { [VTAB_KEY]: 'diff-tab' },
      ptyIdsByTabId: { 'tab-a': ['pty-a'], 'tab-b': ['pty-b'], 'diff-tab': [] },
      unifiedTabsByWorktree: {
        [VTAB_KEY]: [
          { id: 'tab-a' },
          { id: 'tab-b' },
          { id: 'diff-tab' }
        ] as CwdState['unifiedTabsByWorktree'][string]
      },
      lastTerminalTabIdByWorkspace: { [VTAB_KEY]: 'tab-a' },
      cwdByPtyId: {
        'pty-a': { cwd: '/repo/a', source: 'osc7' },
        'pty-b': { cwd: '/repo/b', source: 'osc7' }
      }
    } as Partial<CwdState>)
    expect(getActivePwdForVtab(state, VTAB_KEY)).toBe('/repo/a')
  })

  it('falls back to strip order when nothing was remembered', () => {
    const state = makeState({
      activeTabIdByWorktree: { [VTAB_KEY]: 'diff-tab' },
      ptyIdsByTabId: { 'tab-a': ['pty-a'], 'tab-b': ['pty-b'], 'diff-tab': [] },
      unifiedTabsByWorktree: {
        [VTAB_KEY]: [
          { id: 'tab-a' },
          { id: 'tab-b' },
          { id: 'diff-tab' }
        ] as CwdState['unifiedTabsByWorktree'][string]
      },
      cwdByPtyId: {
        'pty-a': { cwd: '/repo/a', source: 'osc7' },
        'pty-b': { cwd: '/repo/b', source: 'osc7' }
      }
    } as Partial<CwdState>)
    expect(getActivePwdForVtab(state, VTAB_KEY)).toBe('/repo/b')
  })
})
