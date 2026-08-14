import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import { isTerminalModeGroup } from '../../shared/terminal-mode-group'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { lookupRepoRootForPath, resolveLocalRepoRootForPath } from '../git/repo-root-for-path'

/**
 * Terminal mode roots the explorer at the focused shell's literal pwd
 * (docs/terminal-mode-spec.md §2), which is routinely outside every path
 * `filesystem-auth` derives from repos and workspaces. This module is the one
 * narrow extension of that boundary:
 *
 * - **At most two directories**: the pwd the panels are showing, and the
 *   repository enclosing it — which main resolves itself with
 *   `git rev-parse --show-toplevel`, so no caller can name it. A new `cd`
 *   replaces both; nothing accumulates.
 * - **Revoked, not persisted.** State is in-memory, dropped when the renderer
 *   publishes `null` (tab closed, mode off, window unloaded) and re-validated on
 *   every read, so turning the flag off or deleting the tab revokes it even if
 *   the renderer never says so.
 * - **Never widens classic mode.** Reads return nothing unless
 *   `experimentalTerminalMode` is on *and* the declared workspace is still a
 *   live vertical tab (a folder workspace under the hidden terminal-mode group).
 *
 * - **Corroborated, not asserted.** Main only accepts a directory it has itself
 *   observed a PTY of that vertical tab sitting in (OSC 7 or a process-cwd read),
 *   the tab's own start folder, or the directory it already granted. So the
 *   renderer cannot name a directory out of thin air; what it can do is follow
 *   wherever the tab's shell says it is. That signal is terminal *output*, so a
 *   program printing an OSC 7 sequence moves it — but it moves the directory the
 *   panels visibly show at the same time, which is the same trust the rest of the
 *   pwd-following feature already places in it.
 */
export type TerminalModePathScope = {
  /** Workspace key of the vertical tab whose panels are showing `root`. */
  workspaceKey: string
  root: string
  /** Repository enclosing `root`, resolved by main. Null outside any repository. */
  repoRoot: string | null
}

type TerminalModePathScopeStore = Pick<Store, 'getSettings'> &
  Partial<Pick<Store, 'getProjectGroups' | 'getFolderWorkspaces'>>

let currentScope: TerminalModePathScope | null = null
/** Monotonic declaration token: a slow `stat` must not let an older `cd` win. */
let scopeSequence = 0

/** Directories main has seen a vertical tab's shells in — the corroboration set.
 *  Bounded because it is fed by every `cd`; oldest entries are shed first. */
const OBSERVED_CWD_LIMIT = 256
const observedWorkspaceCwds = new Set<string>()

function observedKey(workspaceKey: string, cwd: string): string {
  return `${workspaceKey}\0${cwd}`
}

/**
 * Records a directory a PTY of `workspaceKey` is actually in. Called from main's
 * own OSC 7 tracking and from the process-cwd read, i.e. only for directories a
 * real shell reported — which is what makes the grant user-driven.
 */
export function recordTerminalModeObservedCwd(workspaceKey: string, cwd: string): void {
  const trimmed = cwd.trim()
  if (!workspaceKey || !trimmed || !isAbsolute(trimmed)) {
    return
  }
  const key = observedKey(workspaceKey, resolve(trimmed))
  observedWorkspaceCwds.delete(key)
  observedWorkspaceCwds.add(key)
  while (observedWorkspaceCwds.size > OBSERVED_CWD_LIMIT) {
    const oldest = observedWorkspaceCwds.keys().next().value
    if (oldest === undefined) {
      break
    }
    observedWorkspaceCwds.delete(oldest)
  }
}

export function clearTerminalModePathScope(): void {
  currentScope = null
  // Why bump: a revoke must beat a grant that is still awaiting its `stat`, or the
  // in-flight declaration resurrects the scope the tab that justified it just gave up.
  scopeSequence += 1
}

export function clearTerminalModePathScopeStateForTests(): void {
  currentScope = null
  scopeSequence = 0
  observedWorkspaceCwds.clear()
}

/** Has main itself seen a PTY of `workspaceKey` sitting in `root`? */
export function isObservedTerminalModeCwd(workspaceKey: string, root: string): boolean {
  return observedWorkspaceCwds.has(observedKey(workspaceKey, root))
}

export function normalizeTerminalModeScopeRoot(root: string): string | null {
  return normalizeScopeRoot(root)
}

function normalizeScopeRoot(root: string): string | null {
  const trimmed = root.trim()
  // Why reject relative/NUL paths: `resolve()` would silently anchor a relative
  // path to the main process's cwd, granting a directory nobody asked for.
  if (!trimmed || trimmed.includes('\0') || !isAbsolute(trimmed)) {
    return null
  }
  const resolved = resolve(trimmed)
  // A filesystem root would authorize everything; no product state needs it.
  return dirname(resolved) === resolved ? null : resolved
}

/**
 * Shared with the host-side twin (`runtime/terminal-mode-host-path-scope.ts`): both
 * grants accept only a directory that exists *now* on the machine that will serve it.
 * A reported pwd that does not resolve is a foreign one (a shell inside `ssh`/`docker`)
 * or a directory removed under the shell.
 */
export async function isExistingScopeDirectory(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Repository enclosing a granted directory, bounded away from `$HOME`. Shared with the
 * host twin so the two grants can never disagree about what the git panel may see.
 */
export async function resolveBoundedScopeRepoRoot(root: string): Promise<string | null> {
  const resolved = await lookupRepoRootForPath('local', root, (candidate) =>
    resolveLocalRepoRootForPath(candidate)
  )
  return resolved ? boundedRepoRoot(resolved) : null
}

/**
 * The repository root is granted as a containment root — it has to be, because
 * Source Control reads and stages files anywhere inside it — so it is bounded:
 * a root at or above the user's home directory is refused, and the panel shows its
 * quiet empty state instead. Without this a dotfiles repository at `$HOME` would
 * turn one `cd` into read/write authorization over the whole home directory plus
 * the `git:*` mutation door on it.
 */
export function boundedRepoRoot(candidate: string, homeDir: string = homedir()): string | null {
  const normalized = normalizeScopeRoot(candidate)
  // `isPathInsideOrEqual(normalized, home)` is true when the candidate *contains*
  // the home directory — i.e. exactly the dotfiles-repo-at-`$HOME` case.
  return normalized && !isPathInsideOrEqual(normalized, resolve(homeDir)) ? normalized : null
}

/** True while terminal mode is on *and* `workspaceKey` is a live vertical tab. */
function isTerminalModeWorkspace(store: TerminalModePathScopeStore, workspaceKey: string): boolean {
  return (
    store.getSettings().experimentalTerminalMode === true &&
    isVerticalTabWorkspace(store, workspaceKey)
  )
}

function isVerticalTabWorkspace(store: TerminalModePathScopeStore, workspaceKey: string): boolean {
  const workspaceScope = parseWorkspaceKey(workspaceKey)
  if (workspaceScope?.type !== 'folder') {
    return false
  }
  const workspace = (store.getFolderWorkspaces?.() ?? []).find(
    (candidate) => candidate.id === workspaceScope.folderWorkspaceId
  )
  if (!workspace) {
    return false
  }
  const groups = store.getProjectGroups?.() ?? []
  return isTerminalModeGroup(groups.find((group) => group.id === workspace.projectGroupId))
}

/**
 * Provenance gate. A declared root is accepted only when main can corroborate it:
 * a directory it saw one of the tab's shells in, the tab's own start folder
 * (already an allowed root), or the directory it is already granting — which was
 * corroborated when it was granted, and is what keeps a foreign pwd sticky.
 */
function isCorroboratedScopeRoot(
  store: TerminalModePathScopeStore,
  workspaceKey: string,
  root: string
): boolean {
  return (
    isObservedTerminalModeCwd(workspaceKey, root) ||
    (currentScope?.workspaceKey === workspaceKey && currentScope.root === root) ||
    isTerminalModeWorkspaceStartFolder(store, workspaceKey, root)
  )
}

/** The vertical tab's own start directory, which is already an allowed root. */
export function isTerminalModeWorkspaceStartFolder(
  store: TerminalModePathScopeStore,
  workspaceKey: string,
  root: string
): boolean {
  const workspaceScope = parseWorkspaceKey(workspaceKey)
  if (workspaceScope?.type !== 'folder') {
    return false
  }
  const workspace = (store.getFolderWorkspaces?.() ?? []).find(
    (candidate) => candidate.id === workspaceScope.folderWorkspaceId
  )
  return Boolean(workspace?.folderPath) && resolve(workspace!.folderPath) === root
}

/**
 * Whether a workspace is a vertical tab, ignoring this process's own
 * `experimentalTerminalMode`. Host-side callers need that distinction: an
 * `orca serve` host never has the flag on — the *client* does — but it still owns
 * the vertical tabs a terminal-mode client created on it, and must refuse
 * terminal-mode-only parameters for every other workspace.
 */
export function isTerminalModeWorkspaceSelector(
  store: TerminalModePathScopeStore,
  workspaceKey: string
): boolean {
  return isVerticalTabWorkspace(store, workspaceKey)
}

function validatedScope(store: TerminalModePathScopeStore): TerminalModePathScope | null {
  const scope = currentScope
  return scope && isTerminalModeWorkspace(store, scope.workspaceKey) ? scope : null
}

/**
 * Extra allowed roots contributed by terminal mode — `[]` in classic mode and
 * whenever the declaring tab is gone. Called from `getAllowedRoots`, i.e. on
 * every path authorization, so the empty path allocates one array and stops.
 */
export function getTerminalModePathScopeRoots(store: TerminalModePathScopeStore): string[] {
  const scope = validatedScope(store)
  if (!scope) {
    return []
  }
  return scope.repoRoot && scope.repoRoot !== scope.root
    ? [scope.root, scope.repoRoot]
    : [scope.root]
}

/**
 * Exact-registration door for the `git:*` IPC handlers: terminal mode's git panel
 * operates on a repository main itself resolved from the pwd, which is by
 * definition not in `git worktree list` for any project the user added.
 */
export function isTerminalModeGitRoot(
  targetPath: string,
  store: TerminalModePathScopeStore
): boolean {
  const scope = validatedScope(store)
  return scope?.repoRoot !== null && scope?.repoRoot !== undefined && scope.repoRoot === targetPath
}

export type TerminalModePathScopeResult = {
  accepted: boolean
  repoRoot: string | null
}

/**
 * Records the directory terminal-mode panels are showing. Rejected declarations
 * leave the previous scope untouched, which is what makes a foreign pwd (a local
 * shell inside `ssh`/`tmux`) sticky instead of blanking the panels.
 */
export async function applyTerminalModePathScope(
  store: TerminalModePathScopeStore,
  scope: { workspaceKey: string; root: string } | null
): Promise<TerminalModePathScopeResult> {
  if (!scope) {
    clearTerminalModePathScope()
    return { accepted: false, repoRoot: null }
  }
  const root = normalizeScopeRoot(scope.root)
  const workspaceKey = scope.workspaceKey.trim()
  // Rejected at the door as well as at every read, so a mode toggle or a deleted
  // tab cannot leave a grant sitting in memory waiting to be re-validated.
  if (
    !root ||
    !workspaceKey ||
    !isTerminalModeWorkspace(store, workspaceKey) ||
    !isCorroboratedScopeRoot(store, workspaceKey, root)
  ) {
    return { accepted: false, repoRoot: null }
  }
  // Why a token: `stat` and `rev-parse` are async, so two overlapping `cd`s are
  // not ordered by the IPC channel — without this the slower, older one wins and
  // main ends up granting a directory the panels have already left.
  scopeSequence += 1
  const sequence = scopeSequence
  if (!(await isExistingScopeDirectory(root))) {
    return { accepted: false, repoRoot: null }
  }
  if (sequence !== scopeSequence) {
    return { accepted: false, repoRoot: null }
  }
  // Recorded before the repo lookup: `git rev-parse` runs in `root`, and the
  // grant is what makes reading it legitimate.
  currentScope = { workspaceKey, root, repoRoot: null }
  const repoRoot = await resolveBoundedScopeRepoRoot(root)
  if (sequence !== scopeSequence) {
    return { accepted: false, repoRoot: null }
  }
  currentScope = { workspaceKey, root, repoRoot }
  return { accepted: true, repoRoot }
}

const sendersWithRevokeHooks = new WeakSet<object>()

export function registerTerminalModePathScopeHandlers(store: TerminalModePathScopeStore): void {
  // Re-registered on macOS window re-activation, same as the other IPC modules.
  ipcMain.removeHandler('terminalMode:setPathScope')
  ipcMain.handle(
    'terminalMode:setPathScope',
    (
      event,
      args: { scope: { workspaceKey: string; root: string } | null }
    ): Promise<TerminalModePathScopeResult> => {
      // Why: a crash or a hard reload never runs the renderer's revoke effect, and
      // a grant must not outlive the renderer that asked for it. Registered once
      // per sender — the handler body runs on every `cd`.
      if (!sendersWithRevokeHooks.has(event.sender)) {
        sendersWithRevokeHooks.add(event.sender)
        event.sender.once('destroyed', clearTerminalModePathScope)
        event.sender.once('did-start-navigation', clearTerminalModePathScope)
      }
      return applyTerminalModePathScope(store, args?.scope ?? null)
    }
  )
}
