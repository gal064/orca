import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store/types'
import {
  collectTerminalTabLastCwdCandidates,
  terminalTabLastCwdKey
} from './terminal-mode-last-cwd'

const VTAB_KEY = 'folder:vtab-1'
const CLASSIC_KEY = 'repo-1::/repo/app'

type State = Parameters<typeof collectTerminalTabLastCwdCandidates>[0]

function tab(
  id: string,
  extra: Record<string, unknown> = {}
): AppState['tabsByWorktree'][string][number] {
  return { id, ptyId: null, worktreeId: VTAB_KEY, title: id, ...extra } as never
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    tabsByWorktree: { [VTAB_KEY]: [tab('tab-1')] },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    terminalLayoutsByTabId: {},
    cwdByPtyId: { 'pty-1': { cwd: '/tmp/work', source: 'osc7' } },
    ...overrides
  } as State
}

describe('collectTerminalTabLastCwdCandidates', () => {
  it('reports a vertical tab whose shell moved away from the persisted pwd', () => {
    expect(collectTerminalTabLastCwdCandidates(makeState(), new Set([VTAB_KEY]))).toEqual([
      {
        workspaceKey: VTAB_KEY,
        tabId: 'tab-1',
        ptyId: 'pty-1',
        trackedCwd: '/tmp/work',
        source: 'osc7'
      }
    ])
  })

  it('reports nothing once the tab already carries that pwd', () => {
    const state = makeState({
      tabsByWorktree: { [VTAB_KEY]: [tab('tab-1', { lastCwd: '/tmp/work' })] }
    })
    expect(collectTerminalTabLastCwdCandidates(state, new Set([VTAB_KEY]))).toEqual([])
  })

  it('never persists for a workspace outside terminal mode', () => {
    // The keys come from the catalog choke point, so a classic worktree keeps
    // restarting at its own start folder even while the flag is on.
    const state = makeState({
      tabsByWorktree: { [CLASSIC_KEY]: [tab('tab-1')] }
    })
    expect(collectTerminalTabLastCwdCandidates(state, new Set([VTAB_KEY]))).toEqual([])
    expect(collectTerminalTabLastCwdCandidates(state, new Set())).toEqual([])
  })

  it('never persists a remote-runtime PTY: reattach owns its directory', () => {
    const state = makeState({
      ptyIdsByTabId: { 'tab-1': ['remote:env-1@@terminal-1'] },
      cwdByPtyId: { 'remote:env-1@@terminal-1': { cwd: '/srv/app', source: 'osc7' } }
    })
    expect(collectTerminalTabLastCwdCandidates(state, new Set([VTAB_KEY]))).toEqual([])
  })

  it('never persists an SSH PTY: that spawn path has no missing-directory fallback', () => {
    const state = makeState({
      ptyIdsByTabId: { 'tab-1': ['ssh:conn-1@@pty-9'] },
      cwdByPtyId: { 'ssh:conn-1@@pty-9': { cwd: '/srv/app', source: 'poll' } }
    })
    expect(collectTerminalTabLastCwdCandidates(state, new Set([VTAB_KEY]))).toEqual([])
  })

  it('follows the focused pane of a split tab', () => {
    const state = makeState({
      ptyIdsByTabId: { 'tab-1': ['pty-1', 'pty-2'] },
      terminalLayoutsByTabId: {
        'tab-1': {
          activeLeafId: 'leaf-2',
          ptyIdsByLeafId: { 'leaf-1': 'pty-1', 'leaf-2': 'pty-2' }
        }
      } as never,
      cwdByPtyId: {
        'pty-1': { cwd: '/tmp/work', source: 'osc7' },
        'pty-2': { cwd: '/srv/other', source: 'poll' }
      }
    })
    expect(collectTerminalTabLastCwdCandidates(state, new Set([VTAB_KEY]))).toEqual([
      {
        workspaceKey: VTAB_KEY,
        tabId: 'tab-1',
        ptyId: 'pty-2',
        trackedCwd: '/srv/other',
        source: 'poll'
      }
    ])
  })

  it('reports nothing for a tab with no live PTY or no tracked cwd', () => {
    expect(
      collectTerminalTabLastCwdCandidates(makeState({ ptyIdsByTabId: {} }), new Set([VTAB_KEY]))
    ).toEqual([])
    expect(
      collectTerminalTabLastCwdCandidates(makeState({ cwdByPtyId: {} }), new Set([VTAB_KEY]))
    ).toEqual([])
  })
})

describe('terminalTabLastCwdKey', () => {
  it('changes only with the values that would be written', () => {
    const state = makeState()
    const key = terminalTabLastCwdKey(
      collectTerminalTabLastCwdCandidates(state, new Set([VTAB_KEY]))
    )
    // A fresh store object with the same directories must not restart the debounce.
    expect(
      terminalTabLastCwdKey(collectTerminalTabLastCwdCandidates(makeState(), new Set([VTAB_KEY])))
    ).toBe(key)
    const moved = makeState({ cwdByPtyId: { 'pty-1': { cwd: '/tmp/elsewhere', source: 'osc7' } } })
    expect(
      terminalTabLastCwdKey(collectTerminalTabLastCwdCandidates(moved, new Set([VTAB_KEY])))
    ).not.toBe(key)
  })
})
