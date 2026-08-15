import type { AppState } from './types'
import {
  isTerminalModeVerticalTabKey,
  selectTerminalModeWorkspaceKeys
} from './terminal-mode-workspace-keys'
import { isTerminalMode } from '@/lib/terminal-mode'

type EmptyWorkspaceState = Pick<
  AppState,
  | 'settings'
  | 'folderWorkspaces'
  | 'projectGroups'
  | 'activeWorktreeId'
  | 'workspaceSessionReady'
  | 'unifiedTabsByWorktree'
  | 'tabsByWorktree'
  | 'browserTabsByWorktree'
  | 'openFiles'
>

function isWorkspaceRenderEmpty(
  state: Pick<
    AppState,
    'unifiedTabsByWorktree' | 'tabsByWorktree' | 'browserTabsByWorktree' | 'openFiles'
  >,
  workspaceKey: string
): boolean {
  return (
    (state.unifiedTabsByWorktree[workspaceKey] ?? []).length === 0 &&
    (state.tabsByWorktree[workspaceKey] ?? []).length === 0 &&
    (state.browserTabsByWorktree[workspaceKey] ?? []).length === 0 &&
    !state.openFiles.some((file) => file.worktreeId === workspaceKey)
  )
}

/** What the main pane owes the user when the workbench is not the answer. */
export type TerminalModeMainPaneState =
  /** Classic mode: the flag is off, so the classic landing screen answers. */
  | { kind: 'classic' }
  /** The workbench answers — a workspace is active and has something to render. */
  | { kind: 'workbench' }
  /** Boot: the session has not hydrated, so no statement about tabs is true yet. */
  | { kind: 'pending' }
  | { kind: 'no-vertical-tabs' }
  /** Vertical tabs exist but none is selected — an unguarded deactivation lands here. */
  | { kind: 'no-active-vertical-tab' }
  | { kind: 'empty-vertical-tab'; workspaceKey: string }

const CLASSIC: TerminalModeMainPaneState = { kind: 'classic' }
const WORKBENCH: TerminalModeMainPaneState = { kind: 'workbench' }
const PENDING: TerminalModeMainPaneState = { kind: 'pending' }
const NO_VERTICAL_TABS: TerminalModeMainPaneState = { kind: 'no-vertical-tabs' }
const NO_ACTIVE_VERTICAL_TAB: TerminalModeMainPaneState = { kind: 'no-active-vertical-tab' }

/**
 * The main pane's state in terminal mode. Never `classic` with the flag on — the
 * classic landing carries project and worktree concepts a terminal-first UI must
 * not show — and, apart from the boot window, never a state that renders nothing.
 * That second rule is load-bearing: the "this workspace emptied" deactivation is
 * open-coded in five upstream places, so an unguarded one has to degrade to an
 * actionable pane rather than a void.
 *
 * Returns frozen module constants for every case but one, so a zustand subscriber
 * only re-renders when the state actually changes.
 */
export function selectTerminalModeMainPaneState(
  state: EmptyWorkspaceState
): TerminalModeMainPaneState {
  if (!isTerminalMode(state.settings)) {
    return CLASSIC
  }
  if (!state.activeWorktreeId) {
    if (selectTerminalModeWorkspaceKeys(state).size > 0) {
      // Why the session gate: the catalog hydrates before the restored workspace
      // does, and "no tab selected" during that frame is not yet true.
      return state.workspaceSessionReady ? NO_ACTIVE_VERTICAL_TAB : PENDING
    }
    return state.workspaceSessionReady ? NO_VERTICAL_TABS : PENDING
  }
  return isTerminalModeVerticalTabKey(state, state.activeWorktreeId) &&
    isWorkspaceRenderEmpty(state, state.activeWorktreeId)
    ? { kind: 'empty-vertical-tab', workspaceKey: state.activeWorktreeId }
    : WORKBENCH
}

/** The states the terminal-mode empty pane renders; everything else is not its business. */
export function isTerminalModeEmptyPaneState(state: TerminalModeMainPaneState): boolean {
  return (
    state.kind === 'no-vertical-tabs' ||
    state.kind === 'no-active-vertical-tab' ||
    state.kind === 'empty-vertical-tab'
  )
}
