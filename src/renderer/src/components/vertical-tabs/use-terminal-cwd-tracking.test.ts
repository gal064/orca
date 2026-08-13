import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store/types'
import { selectTerminalCwdPollPtyId } from './use-terminal-cwd-tracking'

const VTAB_KEY = 'folder:vtab-1'

type PollState = Parameters<typeof selectTerminalCwdPollPtyId>[0]

function makeState(overrides: Partial<PollState> = {}): PollState {
  return {
    activeWorkspaceKey: VTAB_KEY,
    activeTabIdByWorktree: { [VTAB_KEY]: 'tab-1' },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    terminalLayoutsByTabId: {},
    cwdByPtyId: {},
    ...overrides
  } as PollState
}

describe('selectTerminalCwdPollPtyId', () => {
  it('polls a PTY with no observed cwd', () => {
    expect(selectTerminalCwdPollPtyId(makeState())).toBe('pty-1')
  })

  it('keeps polling a PTY whose only cwd came from the poll', () => {
    // A shell with no integration never emits OSC 7, so its value must refresh.
    const state = makeState({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'poll' } } as AppState['cwdByPtyId']
    })
    expect(selectTerminalCwdPollPtyId(state)).toBe('pty-1')
  })

  it('stops once OSC 7 reports for that PTY', () => {
    const state = makeState({
      cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } } as AppState['cwdByPtyId']
    })
    expect(selectTerminalCwdPollPtyId(state)).toBe(null)
  })

  it('polls SSH PTYs but never remote-runtime PTYs', () => {
    // SSH getCwd resolves over the relay; a remote-runtime PTY has no local
    // process to read and reports cwd on Metadata frames instead.
    const ssh = makeState({ ptyIdsByTabId: { 'tab-1': ['ssh:conn-1:pty-9'] } })
    expect(selectTerminalCwdPollPtyId(ssh)).toBe('ssh:conn-1:pty-9')
    for (const remotePtyId of ['remote:env-1@@terminal-1', 'remote:terminal-1']) {
      expect(
        selectTerminalCwdPollPtyId(makeState({ ptyIdsByTabId: { 'tab-1': [remotePtyId] } }))
      ).toBe(null)
    }
  })

  it('polls nothing without an active workspace or a terminal tab', () => {
    expect(selectTerminalCwdPollPtyId(makeState({ activeWorkspaceKey: null }))).toBe(null)
    expect(selectTerminalCwdPollPtyId(makeState({ ptyIdsByTabId: {} }))).toBe(null)
  })
})
