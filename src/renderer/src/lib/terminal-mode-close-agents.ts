// Why here and not under `components/vertical-tabs/`: the vertical-tabs store slice
// needs this, and a slice importing a component module inverts the dependency
// direction (and risks the store-index cycle Phase 4 hit).
import type { AppState } from '@/store/types'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { selectWorktreeAgentActivitySummary } from '@/components/sidebar/worktree-agent-activity-summary'
import { selectLiveAgentStatusEntriesForWorktree } from '@/components/sidebar/worktree-agent-row-selectors'

export type ClosingAgent = {
  paneKey: string
  /** What the dialog shows: the agent's own name, falling back to its state. */
  label: string
}

/**
 * Agents a close would kill. `done` is excluded on purpose: a finished agent has
 * nothing left to lose, and listing it would train the user to dismiss the dialog —
 * which is the same reflex that makes a confirmation useless for the case that
 * matters (spec §4, "confirmation dialog lists the running agent(s) it would kill").
 */
function isAgentAtRisk(entry: AgentStatusEntry): boolean {
  return entry.state === 'working' || entry.state === 'waiting' || entry.state === 'blocked'
}

function agentLabel(entry: AgentStatusEntry): string {
  return entry.agentType?.trim() || entry.state
}

export function selectAgentsAtRiskForVerticalTab(
  state: Pick<
    AppState,
    | 'agentStatusByPaneKey'
    | 'migrationUnsupportedByPtyId'
    | 'retainedAgentsByPaneKey'
    | 'runtimeAgentOrchestrationByPaneKey'
    | 'tabsByWorktree'
    | 'agentStatusEpoch'
  >,
  folderWorkspaceId: string
): ClosingAgent[] {
  const workspaceKey = folderWorkspaceKey(folderWorkspaceId)
  // Why both: the entries carry the labels, but the *set* comes from the same summary
  // the row's status dot uses. They attribute differently at the edges (legacy pane
  // keys, orchestration parents), and a tab whose dot says "working" while its close
  // dialog lists nothing is the worst possible disagreement.
  const agents = selectLiveAgentStatusEntriesForWorktree(state, workspaceKey)
    .filter(isAgentAtRisk)
    .map((entry) => ({ paneKey: entry.paneKey, label: agentLabel(entry) }))
  if (agents.length > 0) {
    return agents
  }
  // Why the cross-check: the row's status dot attributes agents through a different
  // function (orchestration parents, legacy pane keys), so it can read "working" while
  // the entry list above names nothing. A dialog that says "no agents" under a spinning
  // dot is the worst disagreement available, so the dot wins and gets a generic row.
  const summary = selectWorktreeAgentActivitySummary(state, workspaceKey)
  return summary.hasLiveWorking || summary.hasPermission
    ? [{ paneKey: workspaceKey, label: 'agent' }]
    : []
}
