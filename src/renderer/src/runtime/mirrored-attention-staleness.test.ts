import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import { collectChangedMirroredAgentStatuses } from './web-session-tabs-sync'

const NOW = 1_700_000_000_000
const WORKTREE_ID = 'repo-1::/repo/worktree'
const PANE_KEY = makePaneKey(
  toWebTerminalSurfaceTabId('host-tab-1'),
  '22222222-2222-4222-8222-222222222222'
)

function entry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'done',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW - 1_000,
    stateHistory: [],
    paneKey: PANE_KEY,
    worktreeId: WORKTREE_ID,
    ...overrides
  } as AgentStatusEntry
}

describe('mirrored attention staleness', () => {
  it('observes a completion that just ended', () => {
    const changed = collectChangedMirroredAgentStatuses({}, { [PANE_KEY]: entry() }, NOW)

    expect(changed).toHaveLength(1)
    expect(changed[0]?.worktreeId).toBe(WORKTREE_ID)
  })

  it('drops a republished completion whose turn ended minutes ago', () => {
    const republished = { [PANE_KEY]: entry({ stateStartedAt: NOW - 635_000 }) }

    expect(collectChangedMirroredAgentStatuses({}, republished, NOW)).toEqual([])
  })

  it.each(['waiting', 'blocked'] as const)('drops a stale %s turn too', (state) => {
    const republished = { [PANE_KEY]: entry({ state, stateStartedAt: NOW - 600_000 }) }

    expect(collectChangedMirroredAgentStatuses({}, republished, NOW)).toEqual([])
  })

  it('keeps a long-running working row so turn sequencing survives', () => {
    const working = { [PANE_KEY]: entry({ state: 'working', stateStartedAt: NOW - 900_000 }) }

    expect(collectChangedMirroredAgentStatuses({}, working, NOW)).toHaveLength(1)
  })

  it('still drops the unchanged republished row', () => {
    const same = entry()

    expect(collectChangedMirroredAgentStatuses({ [PANE_KEY]: same }, { [PANE_KEY]: same }, NOW)) //
      .toEqual([])
  })
})
