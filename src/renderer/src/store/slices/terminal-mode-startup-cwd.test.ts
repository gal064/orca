import { describe, expect, it } from 'vitest'
import type { AppState } from '../types'
import { createTestStore } from './store-test-helpers'

const VTAB_KEY = 'folder:vtab-1'

// New horizontal tabs inherit the focused tab's pwd (terminal-mode-spec.md §2).
function seedFocusedTerminal(
  store: ReturnType<typeof createTestStore>,
  options: { terminalMode: boolean; cwd?: string }
): void {
  store.setState({
    settings: {
      experimentalTerminalMode: options.terminalMode
    } as AppState['settings'],
    folderWorkspaces: [
      {
        id: 'vtab-1',
        projectGroupId: 'group-1',
        name: 'vtab',
        folderPath: '/home/dev',
        sortOrder: 0,
        createdAt: 0
      }
    ] as AppState['folderWorkspaces'],
    activeTabIdByWorktree: { [VTAB_KEY]: 'tab-1' },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    cwdByPtyId: options.cwd ? { 'pty-1': { cwd: options.cwd, source: 'osc7' } } : {}
  })
}

function newTerminalTabStartupCwd(store: ReturnType<typeof createTestStore>): string | undefined {
  const before = new Set((store.getState().tabsByWorktree[VTAB_KEY] ?? []).map((tab) => tab.id))
  store.setState({ activeWorktreeId: VTAB_KEY })
  void store.getState().openNewTerminalTabInActiveWorkspace('group-1')
  return (store.getState().tabsByWorktree[VTAB_KEY] ?? []).find((tab) => !before.has(tab.id))
    ?.startupCwd
}

describe('new terminal tab start directory', () => {
  it('inherits the focused terminal pwd in terminal mode', () => {
    const store = createTestStore()
    seedFocusedTerminal(store, { terminalMode: true, cwd: '/srv/app' })

    expect(newTerminalTabStartupCwd(store)).toBe('/srv/app')
  })

  it('falls back to the vertical tab start directory before any cwd is known', () => {
    const store = createTestStore()
    seedFocusedTerminal(store, { terminalMode: true })

    expect(newTerminalTabStartupCwd(store)).toBe('/home/dev')
  })

  it('leaves classic-mode tabs with no startup cwd', () => {
    const store = createTestStore()
    seedFocusedTerminal(store, { terminalMode: false, cwd: '/srv/app' })

    expect(newTerminalTabStartupCwd(store)).toBeUndefined()
  })

  it('never touches the other creation paths', () => {
    // createTab serves agent launches, quick commands, background/setup
    // terminals and pane detach; each owns its own start directory.
    const store = createTestStore()
    seedFocusedTerminal(store, { terminalMode: true, cwd: '/srv/app' })

    expect(store.getState().createTab(VTAB_KEY).startupCwd).toBeUndefined()
    expect(
      store.getState().createTab(VTAB_KEY, undefined, undefined, { startupCwd: '/explicit' })
        .startupCwd
    ).toBe('/explicit')
  })
})
