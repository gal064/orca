import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

/**
 * Per-PTY working directory, the input to terminal mode's "panels follow the
 * focused terminal" model (docs/terminal-mode-design.md Phase 2).
 *
 * Two producers write here: OSC 7 facts (local/SSH via the `pty:sideEffect`
 * channel, remote via `TerminalStreamOpcode.Metadata` frames) and the process-
 * cwd poll that covers shells with no shell integration. The source is retained
 * because it decides who may overwrite whom and which PTYs still need polling.
 */
export type TerminalCwdSource = 'osc7' | 'poll'

export type TerminalCwdEntry = {
  cwd: string
  source: TerminalCwdSource
}

/** Backstop only: `clearPtyCwd` retires a PTY when it exits, so this bound just
 *  keeps a very long session from accumulating PTYs whose exit never arrived. */
const MAX_TRACKED_PTY_CWDS = 256

type TerminalPtyResolutionState = Pick<
  AppState,
  | 'activeTabIdByWorktree'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
  | 'unifiedTabsByWorktree'
  | 'lastTerminalTabIdByWorkspace'
>

export type TerminalCwdSlice = {
  cwdByPtyId: Record<string, TerminalCwdEntry>
  /** Last tab per workspace that was focused *while owning a PTY* — the sticky-pwd
   *  anchor once an editor or diff tab takes focus. Recorded by
   *  `useTerminalCwdTracking`, so classic mode never writes it. */
  lastTerminalTabIdByWorkspace: Record<string, string>
  setPtyCwd: (ptyId: string, cwd: string, source: TerminalCwdSource) => void
  recordActiveTerminalTab: (workspaceKey: string, tabId: string) => void
  /** Drop a dead PTY's directory. Orca reuses PTY ids across incarnations, so a
   *  retained entry would show the previous shell's directory in the new one. */
  clearPtyCwd: (ptyId: string) => void
  /** Stamp the directory a restarted shell of this tab should reopen in. Writes
   *  the durable tab record, so the existing debounced session writer carries it
   *  to disk — see `useTerminalModeLastCwdPersistence`. */
  recordTerminalTabLastCwd: (workspaceKey: string, tabId: string, cwd: string) => void
}

/** The last terminal tab the user focused, else the last tab in strip order that
 *  still owns a PTY (a session restored without any focus history). */
function findFallbackTerminalTabId(
  state: TerminalPtyResolutionState,
  workspaceKey: string
): string | null {
  const remembered = state.lastTerminalTabIdByWorkspace?.[workspaceKey]
  if (remembered && (state.ptyIdsByTabId[remembered]?.length ?? 0) > 0) {
    return remembered
  }
  const tabs = state.unifiedTabsByWorktree?.[workspaceKey] ?? []
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const candidate = tabs[index]
    if (candidate && (state.ptyIdsByTabId[candidate.id]?.length ?? 0) > 0) {
      return candidate.id
    }
  }
  return null
}

/**
 * The PTY whose cwd represents a workspace: the focused pane of the workspace's
 * active tab, or — when that tab owns no PTY because it is an editor/diff/browser
 * tab — of the last tab that still does. That is the spec's sticky-pwd rule
 * (terminal-mode-spec.md §4). It is sticky across *focus* only: once no tab has a
 * live PTY the caller falls back to the start directory rather than reporting a
 * directory no running shell is in.
 */
export function resolveWorkspaceTerminalPtyId(
  state: TerminalPtyResolutionState,
  workspaceKey: string
): string | null {
  const activeTabId = state.activeTabIdByWorktree[workspaceKey] ?? null
  const activeHasPty = activeTabId && (state.ptyIdsByTabId[activeTabId]?.length ?? 0) > 0
  // Why the fallback: opening a diff or editor tab from the panels makes it the
  // active tab, and it owns no PTY — the spec's sticky rule says the panels keep
  // following the last terminal instead of snapping back to the start directory.
  const tabId = activeHasPty ? activeTabId : findFallbackTerminalTabId(state, workspaceKey)
  return tabId ? resolveTabTerminalPtyId(state, tabId) : null
}

/** The PTY whose directory represents a tab: its focused split pane, else any
 *  pane the layout still lists, else the newest PTY the tab owns. */
export function resolveTabTerminalPtyId(
  state: Pick<TerminalPtyResolutionState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>,
  tabId: string
): string | null {
  const livePtyIds = state.ptyIdsByTabId[tabId] ?? []
  if (livePtyIds.length === 0) {
    return null
  }
  const layout = state.terminalLayoutsByTabId[tabId]
  const activeLeafPtyId = layout?.activeLeafId ? layout.ptyIdsByLeafId?.[layout.activeLeafId] : null
  if (activeLeafPtyId && livePtyIds.includes(activeLeafPtyId)) {
    return activeLeafPtyId
  }
  const firstLiveLayoutPtyId = Object.values(layout?.ptyIdsByLeafId ?? {}).find((ptyId) =>
    livePtyIds.includes(ptyId)
  )
  // Newest tab PTY when the split layout is stale or was never recorded.
  return firstLiveLayoutPtyId ?? livePtyIds.at(-1) ?? null
}

type ActivePwdState = TerminalPtyResolutionState & Pick<AppState, 'cwdByPtyId' | 'folderWorkspaces'>

/**
 * Working directory the vertical tab's panels should follow: its focused
 * terminal's tracked cwd, falling back to the tab's start directory. Never
 * blank while the workspace exists — "never guess" (terminal-mode-spec.md §4).
 */
export function getActivePwdForVtab(state: ActivePwdState, workspaceKey: string): string | null {
  const scope = parseWorkspaceKey(workspaceKey)
  if (scope?.type !== 'folder') {
    return null
  }
  const ptyId = resolveWorkspaceTerminalPtyId(state, workspaceKey)
  const trackedCwd = ptyId ? state.cwdByPtyId[ptyId]?.cwd : undefined
  if (trackedCwd) {
    return trackedCwd
  }
  const workspace = state.folderWorkspaces.find(
    (candidate) => candidate.id === scope.folderWorkspaceId
  )
  return workspace?.folderPath?.trim() || null
}

/** Live entries only: a PTY no tab still lists can never be looked up again. */
function pruneUnreferencedPtyCwds(
  entries: Record<string, TerminalCwdEntry>,
  ptyIdsByTabId: Record<string, readonly string[] | undefined>
): Record<string, TerminalCwdEntry> {
  if (Object.keys(entries).length <= MAX_TRACKED_PTY_CWDS) {
    return entries
  }
  const referenced = new Set<string>()
  for (const ptyIds of Object.values(ptyIdsByTabId)) {
    for (const ptyId of ptyIds ?? []) {
      referenced.add(ptyId)
    }
  }
  const pruned: Record<string, TerminalCwdEntry> = {}
  for (const [ptyId, entry] of Object.entries(entries)) {
    if (referenced.has(ptyId)) {
      pruned[ptyId] = entry
    }
  }
  return pruned
}

export const createTerminalCwdSlice: StateCreator<AppState, [], [], TerminalCwdSlice> = (set) => ({
  cwdByPtyId: {},
  lastTerminalTabIdByWorkspace: {},

  recordActiveTerminalTab: (workspaceKey, tabId) => {
    set((state) =>
      state.lastTerminalTabIdByWorkspace[workspaceKey] === tabId
        ? state
        : {
            lastTerminalTabIdByWorkspace: {
              ...state.lastTerminalTabIdByWorkspace,
              [workspaceKey]: tabId
            }
          }
    )
  },

  setPtyCwd: (ptyId, cwd, source) => {
    const trimmed = cwd.trim()
    if (!ptyId || !trimmed) {
      return
    }
    set((state) => {
      const existing = state.cwdByPtyId[ptyId]
      // Why OSC 7 wins: the poll reads the shell process, which lags a `cd` and
      // is plain wrong for a PTY whose foreground process is not the shell.
      if (existing && existing.source === 'osc7' && source === 'poll') {
        return state
      }
      if (existing?.cwd === trimmed && existing.source === source) {
        return state
      }
      return {
        cwdByPtyId: {
          ...pruneUnreferencedPtyCwds(state.cwdByPtyId, state.ptyIdsByTabId),
          [ptyId]: { cwd: trimmed, source }
        }
      }
    })
  },

  clearPtyCwd: (ptyId) => {
    set((state) => {
      if (!(ptyId in state.cwdByPtyId)) {
        return state
      }
      const { [ptyId]: _dropped, ...rest } = state.cwdByPtyId
      return { cwdByPtyId: rest }
    })
  },

  recordTerminalTabLastCwd: (workspaceKey, tabId, cwd) => {
    const trimmed = cwd.trim()
    if (!workspaceKey || !tabId || !trimmed) {
      return
    }
    set((state) => {
      const tabs = state.tabsByWorktree[workspaceKey]
      const index = tabs?.findIndex((tab) => tab.id === tabId) ?? -1
      const existing = tabs && index >= 0 ? tabs[index] : undefined
      if (!tabs || !existing || existing.lastCwd === trimmed) {
        return state
      }
      const nextTabs = [...tabs]
      nextTabs[index] = { ...existing, lastCwd: trimmed }
      return { tabsByWorktree: { ...state.tabsByWorktree, [workspaceKey]: nextTabs } }
    })
  }
})
