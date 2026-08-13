import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'

/** How a workspace's files are addressed on its host. */
export type PanelOwnerKind = 'local' | 'ssh' | 'runtime' | 'unresolved'

/**
 * Whether the tab's host can answer for a directory outside the workspace root.
 * `not-required` covers local and SSH workspaces (their file APIs already take
 * absolute paths) and any pwd that happens to sit inside the workspace root.
 */
export type AbsolutePathScopeState = 'not-required' | 'available' | 'unavailable'

export type TerminalModePanelRootInput = {
  /** Debounced pwd of the tab's focused terminal. */
  pwd: string | null
  /** The vertical tab's `folderPath` — its start directory, and the clamp target. */
  workspaceRoot: string | null
  /**
   * `unknown` while the host has not confirmed the pwd resolves there; `foreign`
   * once it answered that it does not (a local shell running ssh/tmux/docker
   * reports the *other* machine's directory — docs/terminal-mode-design.md).
   */
  pwdStatus: 'unknown' | 'valid' | 'foreign'
  absolutePathScope: AbsolutePathScopeState
  /** Last root that resolved on this host, which is what stickiness falls back to. */
  lastValidRoot: string | null
}

export type TerminalModePanelRootResult = {
  root: string | null
  clampedToWorkspaceRoot: boolean
  foreignPwd: boolean
}

export function isPathInsideWorkspaceRoot(
  workspaceRoot: string | null,
  candidate: string
): boolean {
  return workspaceRoot !== null && relativePathInsideRoot(workspaceRoot, candidate) !== null
}

/**
 * Directory the panels should follow. Never blank while the tab exists and never
 * a guess: an unresolvable pwd keeps the last good directory rather than blanking
 * the explorer (terminal-mode-spec.md §4, "Never blank; never guess").
 */
export function resolveTerminalModePanelRoot(
  input: TerminalModePanelRootInput
): TerminalModePanelRootResult {
  const workspaceRoot = input.workspaceRoot?.trim() || null
  const sticky = input.lastValidRoot ?? workspaceRoot
  const pwd = input.pwd?.trim() || null
  if (!pwd || input.pwdStatus === 'unknown') {
    return { root: sticky, clampedToWorkspaceRoot: false, foreignPwd: false }
  }
  // Why before the foreign check: "this host cannot address anything outside the
  // start folder" is a property of the host, not of the pwd, so it must not be
  // masked by a pwd that also failed to resolve.
  if (input.absolutePathScope === 'unavailable') {
    return { root: workspaceRoot, clampedToWorkspaceRoot: true, foreignPwd: false }
  }
  if (input.pwdStatus === 'foreign') {
    return { root: sticky, clampedToWorkspaceRoot: false, foreignPwd: true }
  }
  return { root: pwd, clampedToWorkspaceRoot: false, foreignPwd: false }
}

/**
 * Whether the host's absolute-path capability is needed at all for this pwd.
 * Only remote-runtime workspaces address files through a worktree selector, so
 * only they need the host to accept an absolute path.
 *
 * Note it is required for *any* remote pwd other than the workspace root, not just
 * one outside it: the explorer's mutation and file-open paths compute their
 * worktree-relative path against the root the explorer is showing, so a remote tab
 * rooted at a subdirectory would address the wrong file. Until Phase 4 threads the
 * workspace root through those paths, a remote tab whose shell moves at all clamps
 * back to its start folder — which is what the hint says.
 */
export function requiresAbsolutePathScope(
  ownerKind: PanelOwnerKind,
  workspaceRoot: string | null,
  pwd: string | null
): boolean {
  if (ownerKind !== 'runtime' || !pwd) {
    return false
  }
  return workspaceRoot === null || pwd !== workspaceRoot
}

/**
 * Git-panel root. Remote-runtime workspaces address git through a worktree
 * selector, so every mutating git RPC (diff, stage, commit) still resolves the
 * *workspace* root; the panel is therefore shown only when the pwd's repository
 * is that same root. Phase 4 owns making the rest of the git surface
 * path-addressed. Local and SSH take an absolute worktree path throughout, so
 * they follow the pwd's repository directly.
 */
export function resolveTerminalModeGitRoot(
  ownerKind: PanelOwnerKind,
  repoRoot: string | null | undefined,
  workspaceRoot: string | null
): string | null | undefined {
  if (repoRoot === undefined) {
    return undefined
  }
  if (ownerKind !== 'runtime') {
    return repoRoot
  }
  return repoRoot !== null && workspaceRoot !== null && repoRoot === workspaceRoot ? repoRoot : null
}
