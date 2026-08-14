import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { selectAgentsAtRiskForVerticalTab } from './terminal-mode-close-agents'

const VTAB = 'vtab-1'
const KEY = folderWorkspaceKey(VTAB)
// Pane keys are `${tabId}:${leafUUID}` and the parser rejects anything else, so the
// leaf ids here have to be real UUIDs.
const PANE_A = 'tab-1:11111111-1111-4111-8111-111111111111'
const PANE_B = 'tab-1:33333333-3333-4333-8333-333333333333'
const PANE_OTHER = 'other-tab:44444444-4444-4444-8444-444444444444'

function entry(paneKey: string, overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: Date.now(),
    stateStartedAt: Date.now(),
    paneKey,
    ...overrides
  } as AgentStatusEntry
}

function stateWith(entries: Record<string, AgentStatusEntry>, tabIds: string[] = ['tab-1']) {
  return {
    agentStatusByPaneKey: entries,
    migrationUnsupportedByPtyId: {},
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {},
    agentStatusEpoch: 0,
    tabsByWorktree: {
      [KEY]: tabIds.map((id) => ({ id }) as never)
    },
    browserTabsByWorktree: {},
    runtimePaneTitlesByTabId: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {}
  } as never
}

describe('agents a vertical-tab close would kill', () => {
  it('finds a working agent through the tab the vertical tab owns', () => {
    // Attribution runs through `tabsByWorktree`, which is keyed by workspace key —
    // the `folder:` key needs no special casing.
    const agents = selectAgentsAtRiskForVerticalTab(
      stateWith({ [PANE_A]: entry(PANE_A, { agentType: 'claude' }) }),
      VTAB
    )
    expect(agents).toEqual([{ paneKey: PANE_A, label: 'claude' }])
  })

  it('counts an agent waiting on input or blocked — those are the ones worth losing', () => {
    const agents = selectAgentsAtRiskForVerticalTab(
      stateWith({
        [PANE_A]: entry(PANE_A, { state: 'waiting', agentType: 'codex' }),
        [PANE_B]: entry(PANE_B, { state: 'blocked', agentType: 'claude' })
      }),
      VTAB
    )
    expect(agents.map((agent) => agent.label).sort()).toEqual(['claude', 'codex'])
  })

  it('ignores a finished agent, so the dialog never cries wolf', () => {
    const agents = selectAgentsAtRiskForVerticalTab(
      stateWith({ [PANE_A]: entry(PANE_A, { state: 'done', agentType: 'claude' }) }),
      VTAB
    )
    expect(agents).toEqual([])
  })

  it('never attributes another workspace’s agent to this tab', () => {
    const state = {
      agentStatusByPaneKey: { [PANE_OTHER]: entry(PANE_OTHER) },
      migrationUnsupportedByPtyId: {},
      retainedAgentsByPaneKey: {},
      runtimeAgentOrchestrationByPaneKey: {},
      agentStatusEpoch: 0,
      tabsByWorktree: {
        [KEY]: [{ id: 'tab-1' } as never],
        'worktree:repo::/w': [{ id: 'other-tab' } as never]
      }
    } as never
    expect(selectAgentsAtRiskForVerticalTab(state, VTAB)).toEqual([])
  })

  it('falls back to the state when an agent has no type to name', () => {
    const agents = selectAgentsAtRiskForVerticalTab(
      stateWith({ [PANE_A]: entry(PANE_A, { state: 'blocked' }) }),
      VTAB
    )
    expect(agents[0]?.label).toBe('blocked')
  })
})

describe('agreement with the status dot', () => {
  it('ignores a stale working row, because the row’s dot does too', () => {
    // `selectLiveAgentStatusEntriesForWorktree` applies no freshness filter but the
    // summary behind the dot does. Without the same gate the tab shows grey while the
    // dialog announces an agent that is not there — the cry-wolf the file exists to avoid.
    const now = Date.now()
    const agents = selectAgentsAtRiskForVerticalTab(
      stateWith({
        [PANE_A]: entry(PANE_A, {
          agentType: 'claude',
          updatedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1
        })
      }),
      VTAB,
      now
    )
    expect(agents).toEqual([])
  })

  it('ignores a hydrated-but-unconfirmed row after a client restart', () => {
    const agents = selectAgentsAtRiskForVerticalTab(
      stateWith({
        [PANE_A]: entry(PANE_A, { agentType: 'claude', restoredUnconfirmed: true })
      }),
      VTAB
    )
    expect(agents).toEqual([])
  })
})
