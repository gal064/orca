import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

/**
 * Where terminal mode's right-hand panels are pointed (docs/terminal-mode-design.md
 * Phase 3). One entry, for the active vertical tab, because only that tab's panels
 * are rendered — and because the value backs a filesystem-authorization grant in
 * main, which must stay a single directory.
 *
 * Written by `useTerminalModePanelScope`; read by the File Explorer, Source
 * Control, the git-status poller and the external file watcher. `null` in classic
 * mode, so every consumer's terminal-mode branch collapses to one null check.
 */
export type TerminalModePanelScope = {
  workspaceKey: string
  /** Directory the explorer is rooted at. Always verified to exist on the tab's host. */
  root: string
  /** The vertical tab's start folder — the base every worktree-relative remote
   *  path is computed against, and the clamp target. */
  workspaceRoot: string
  /** Nearest enclosing repo root of `root`; `null` = outside any repo (quiet empty
   *  state), `undefined` = not resolved yet (panels wait rather than flash empty). */
  repoRoot: string | null | undefined
  /**
   * How this tab's files are addressed on its host. `'absolute'` only when the
   * host advertises `terminal-mode.absolute-path-scope.v1` and the root escaped
   * the workspace root; every other case stays on the relative contract.
   */
  addressing: 'relative' | 'absolute'
  /** True when `root` was clamped to the workspace root because the remote host
   *  cannot address anything outside it. Drives the explorer hint. */
  clampedToWorkspaceRoot: boolean
}

export type TerminalModePanelsSlice = {
  terminalModePanelScope: TerminalModePanelScope | null
  setTerminalModePanelScope: (scope: TerminalModePanelScope | null) => void
}

/** The scope, but only when it belongs to `workspaceKey`. The single place that
 *  comparison is made — consumers must not re-derive it. */
export function selectTerminalModePanelScopeForWorkspace(
  state: Pick<AppState, 'terminalModePanelScope'>,
  workspaceKey: string | null | undefined
): TerminalModePanelScope | null {
  const scope = state.terminalModePanelScope
  return scope && workspaceKey && scope.workspaceKey === workspaceKey ? scope : null
}

/** Explorer root for a workspace in terminal mode, else null (classic behavior). */
export function selectTerminalModePanelRoot(
  state: Pick<AppState, 'terminalModePanelScope'>,
  workspaceKey: string | null | undefined
): string | null {
  return selectTerminalModePanelScopeForWorkspace(state, workspaceKey)?.root ?? null
}

/** Paths the external file watcher must cover for a terminal-mode workspace. */
export function selectTerminalModeWatchRoots(
  state: Pick<AppState, 'terminalModePanelScope'>,
  workspaceKey: string | null | undefined
): string[] | null {
  const scope = selectTerminalModePanelScopeForWorkspace(state, workspaceKey)
  if (!scope) {
    return null
  }
  // Why both: the explorer filters events by the pwd it is rooted at, Source
  // Control by the repo root. When the pwd is a subdirectory those differ, and a
  // single watcher would starve one of the two panels.
  return scope.repoRoot && scope.repoRoot !== scope.root
    ? [scope.root, scope.repoRoot]
    : [scope.root]
}

export const createTerminalModePanelsSlice: StateCreator<
  AppState,
  [],
  [],
  TerminalModePanelsSlice
> = (set) => ({
  terminalModePanelScope: null,

  setTerminalModePanelScope: (scope) => {
    set((state) => {
      const current = state.terminalModePanelScope
      if (
        current === scope ||
        (current !== null &&
          scope !== null &&
          current.workspaceKey === scope.workspaceKey &&
          current.root === scope.root &&
          current.workspaceRoot === scope.workspaceRoot &&
          current.repoRoot === scope.repoRoot &&
          current.addressing === scope.addressing &&
          current.clampedToWorkspaceRoot === scope.clampedToWorkspaceRoot)
      ) {
        return state
      }
      return { terminalModePanelScope: scope }
    })
  }
})
