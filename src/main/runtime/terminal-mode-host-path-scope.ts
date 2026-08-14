import { realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { Store } from '../persistence'
import {
  isExistingScopeDirectory,
  isObservedTerminalModeCwd,
  isTerminalModeWorkspaceSelector,
  isTerminalModeWorkspaceStartFolder,
  normalizeTerminalModeScopeRoot,
  resolveBoundedScopeRepoRoot
} from '../ipc/terminal-mode-path-scope'
import { isDescendantOrEqual } from '../ipc/filesystem-auth'

/**
 * The host's own terminal-mode filesystem grant — the RPC twin of
 * `main/ipc/terminal-mode-path-scope.ts`, which only ever serves a local renderer.
 *
 * A remote vertical tab's panels follow a shell running *on this host*, so the
 * directory they show is routinely outside every root `filesystem-auth` derives
 * from repos and workspaces. Without a grant here, `files.readDir` with
 * `absolutePath` is denied and the client has to clamp — which is exactly why
 * `terminal-mode.absolute-path-scope.v1` went unadvertised through Phase 3.
 *
 * The guarantees are deliberately the same as the local module's, plus two:
 *
 * - **Corroborated, never asserted.** A root is accepted only when this process
 *   has itself observed a PTY of that vertical tab in it (OSC 7 or a process-cwd
 *   read, both funnelled through `recordTerminalModeObservedCwd`), or it is the
 *   tab's own start folder, or it is the root already granted for that tab. That
 *   observation comes from terminal *output*, so a program printing an OSC 7 sequence
 *   moves it — and unlike the local grant, nobody is necessarily watching this pane.
 *   The reach it buys is bounded to reading inside one directory of one vertical tab.
 * - **Not keyed by client.** Any authenticated non-mobile client of this host may read
 *   inside a directory another client's tab granted. Deliberate: connection identity is
 *   not stable across the reconnects this feature exists to survive (below), and every
 *   such client can already start terminals here, which strictly dominates a read scope.
 * - **Read-only.** Nothing here joins `getAllowedRoots`. It is consulted by the
 *   absolute-path *read* surface only (`files.readDir`, `files.stat`,
 *   `files.watch`); every mutating file RPC still addresses a worktree selector
 *   plus a contained relative path, so a grant can never authorize a write
 *   outside the workspace.
 * - **Keyed by vertical tab, not by socket.** A runtime client's connection
 *   identity is not stable across the reconnects this feature exists to survive
 *   (shared-control multiplexing, per-request sockets, relay hops), so reaping on
 *   socket close would revoke the grant precisely when the client reattaches. The
 *   grant's lifetime is the tab's: it is re-validated on every read (the
 *   workspace must still be a live terminal-mode vertical tab), replaced on every
 *   `cd`, dropped when the tab is deleted, and bounded to
 *   `MAX_TRACKED_HOST_SCOPES` tabs.
 */
export type TerminalModeHostPathScope = {
  root: string
  /** Repository enclosing `root`, resolved by the host. Null outside any repository. */
  repoRoot: string | null
}

type TerminalModeHostPathScopeStore = Pick<Store, 'getSettings'> &
  Partial<Pick<Store, 'getProjectGroups' | 'getFolderWorkspaces'>>

const MAX_TRACKED_HOST_SCOPES = 32

/** `sequence` identifies which declaration wrote the entry, so a losing one only ever
 *  withdraws its own grant. */
type HostScopeEntry = TerminalModeHostPathScope & { sequence: number }

const scopeByWorkspaceKey = new Map<string, HostScopeEntry>()
/**
 * Declaration token, **per tab**. The local module keeps one counter because it
 * holds one scope; here a shared counter would let any activity on tab B cancel an
 * in-flight declaration for tab A — leaving A's grant written but its client told the
 * pwd was refused, which shows up as panels stuck on the previous directory.
 */
const sequenceByWorkspaceKey = new Map<string, number>()

function nextSequence(workspaceKey: string): number {
  const next = (sequenceByWorkspaceKey.get(workspaceKey) ?? 0) + 1
  sequenceByWorkspaceKey.set(workspaceKey, next)
  return next
}

export function clearTerminalModeHostPathScope(workspaceKey: string): void {
  scopeByWorkspaceKey.delete(workspaceKey)
  // Why bump: a revoke must beat a grant still awaiting its `stat`, or the
  // in-flight declaration resurrects the scope the tab just gave up.
  nextSequence(workspaceKey)
}

export function clearTerminalModeHostPathScopesForTests(): void {
  scopeByWorkspaceKey.clear()
  sequenceByWorkspaceKey.clear()
}

/** Grant for a tab, or null when it has none or is no longer a vertical tab. */
export function getTerminalModeHostPathScope(
  store: TerminalModeHostPathScopeStore,
  workspaceKey: string
): TerminalModeHostPathScope | null {
  const entry = scopeByWorkspaceKey.get(workspaceKey)
  if (!entry) {
    return null
  }
  // Re-validated on every read, so deleting the tab revokes the grant even if no
  // client ever says so.
  if (!isTerminalModeWorkspaceSelector(store, workspaceKey)) {
    scopeByWorkspaceKey.delete(workspaceKey)
    return null
  }
  return { root: entry.root, repoRoot: entry.repoRoot }
}

function isCorroboratedHostScopeRoot(
  store: TerminalModeHostPathScopeStore,
  workspaceKey: string,
  root: string
): boolean {
  return (
    isObservedTerminalModeCwd(workspaceKey, root) ||
    scopeByWorkspaceKey.get(workspaceKey)?.root === root ||
    isTerminalModeWorkspaceStartFolder(store, workspaceKey, root)
  )
}

export type TerminalModeHostPathScopeResult = {
  accepted: boolean
  repoRoot: string | null
}

/**
 * Records the directory a remote vertical tab's panels are showing. A rejected
 * declaration leaves the previous grant untouched, which is what keeps a pwd the
 * host cannot resolve (a shell inside `ssh`/`docker`) sticky rather than blanking
 * the client's panels.
 */
export async function declareTerminalModeHostPathScope(
  store: TerminalModeHostPathScopeStore,
  input: { workspaceKey: string; root: string | null }
): Promise<TerminalModeHostPathScopeResult> {
  const workspaceKey = input.workspaceKey.trim()
  if (!workspaceKey) {
    return { accepted: false, repoRoot: null }
  }
  if (input.root === null) {
    clearTerminalModeHostPathScope(workspaceKey)
    return { accepted: false, repoRoot: null }
  }
  const root = normalizeTerminalModeScopeRoot(input.root)
  if (
    !root ||
    !isTerminalModeWorkspaceSelector(store, workspaceKey) ||
    !isCorroboratedHostScopeRoot(store, workspaceKey, root)
  ) {
    return { accepted: false, repoRoot: null }
  }
  const sequence = nextSequence(workspaceKey)
  const isCurrent = (): boolean => sequenceByWorkspaceKey.get(workspaceKey) === sequence
  if (!(await isExistingScopeDirectory(root))) {
    return { accepted: false, repoRoot: null }
  }
  if (!isCurrent()) {
    return { accepted: false, repoRoot: null }
  }
  // Recorded before the repo lookup: `git rev-parse` runs in `root`, and the grant
  // is what makes reading it legitimate.
  setHostScope(workspaceKey, { root, repoRoot: null, sequence })
  const repoRoot = await resolveBoundedScopeRepoRoot(root)
  if (!isCurrent()) {
    // Why withdrawn rather than left: this declaration wrote the grant above and has
    // since lost to a newer `cd` or a revoke. Leaving it would hand the tab a grant
    // its client was told was refused. Only its own entry is removed — a newer
    // declaration that already landed keeps its grant.
    if (scopeByWorkspaceKey.get(workspaceKey)?.sequence === sequence) {
      scopeByWorkspaceKey.delete(workspaceKey)
    }
    return { accepted: false, repoRoot: null }
  }
  setHostScope(workspaceKey, { root, repoRoot, sequence })
  return { accepted: true, repoRoot }
}

function setHostScope(workspaceKey: string, entry: HostScopeEntry): void {
  scopeByWorkspaceKey.delete(workspaceKey)
  scopeByWorkspaceKey.set(workspaceKey, entry)
  while (scopeByWorkspaceKey.size > MAX_TRACKED_HOST_SCOPES) {
    const oldest = scopeByWorkspaceKey.keys().next().value
    if (oldest === undefined) {
      break
    }
    scopeByWorkspaceKey.delete(oldest)
  }
}

/**
 * Exactly one directory: the pwd the panels are showing. The enclosing repository is
 * resolved and reported so the client can root its git panel, but it is deliberately
 * NOT a read root here — every remote git surface still addresses a worktree
 * selector, so nothing can reach through it, and unused reach is reach.
 */
function scopeRootsFor(scope: TerminalModeHostPathScope): string[] {
  return [scope.root]
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Canonicalize the nearest existing ancestor and re-append what is missing, the same
 * discipline `resolveAuthorizedPath` uses. Only a missing path walks up: a permission
 * or I/O error is rethrown, because treating it as "not there yet" would compare an
 * uncanonicalized path against a canonicalized root.
 */
async function canonicalizeExistingAncestor(target: string): Promise<string> {
  let existing = target
  const missing: string[] = []
  for (;;) {
    try {
      return resolve(await realpath(existing), ...missing)
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error
      }
      const parent = dirname(existing)
      if (parent === existing) {
        return target
      }
      missing.unshift(basename(existing))
      existing = parent
    }
  }
}

/**
 * Whether the grant *still* covers a directory, synchronously. A long-lived consumer —
 * `files.watch` streams for the life of its subscription — must re-check this, or the
 * grant's stated lifetime ("dropped when the tab is deleted, replaced on every `cd`")
 * would hold for one-shot reads and be false for the one surface that keeps emitting.
 * Deliberately not canonicalizing: the path handed here is one this module already
 * resolved, and a watcher callback must not do I/O per batch.
 */
export function isPathInTerminalModeHostScope(
  store: TerminalModeHostPathScopeStore,
  workspaceKey: string,
  resolvedPath: string
): boolean {
  const scope = getTerminalModeHostPathScope(store, workspaceKey)
  return (
    scope !== null && scopeRootsFor(scope).some((root) => isDescendantOrEqual(resolvedPath, root))
  )
}

/**
 * Resolve an absolute path a client addressed inside a vertical tab's grant, or `null`
 * when no grant covers it — "not granted" is an ordinary answer the caller branches on,
 * not an exception, so a genuine `realpath` fault still propagates.
 *
 * Containment is checked twice — once on the literal path and once after
 * canonicalization — so an ancestor symlink cannot redirect the read outside the
 * granted directory, the same discipline `resolveAuthorizedPath` applies.
 */
export async function resolveTerminalModeHostScopedPath(
  store: TerminalModeHostPathScopeStore,
  workspaceKey: string,
  absolutePath: string
): Promise<string | null> {
  const scope = getTerminalModeHostPathScope(store, workspaceKey)
  const target = normalizeTerminalModeScopeRoot(absolutePath)
  if (!scope || !target) {
    return null
  }
  for (const root of scopeRootsFor(scope)) {
    if (!isDescendantOrEqual(target, root)) {
      continue
    }
    const canonicalTarget = await canonicalizeExistingAncestor(target)
    if (isDescendantOrEqual(canonicalTarget, await canonicalizeExistingAncestor(root))) {
      return canonicalTarget
    }
  }
  return null
}
