import { FLOATING_TERMINAL_WORKTREE_ID } from './constants'
import { resolveRuntimePath } from './cross-platform-path'
import { parseWorkspaceKey } from './workspace-scope'
import { splitWorktreeIdForFilesystem } from './worktree-id'

/** Why not a boolean: a directory the shell cannot `chdir` into fails the spawn
 *  exactly like a missing one, but the user needs a different explanation. */
export type TerminalStartupCwdUsability = 'usable' | 'missing' | 'inaccessible'
export type TerminalStartupCwdRejection = Exclude<TerminalStartupCwdUsability, 'usable'>

export type TerminalStartupCwdFallbackKind = 'worktree' | 'home'

/** What main hands the renderer so the pane can explain where it actually opened. */
export type TerminalStartupCwdFallbackNotice = {
  kind: TerminalStartupCwdFallbackKind
  reason: TerminalStartupCwdRejection
  cwd: string
}

export type TerminalStartupCwdResolution = {
  cwd: string | undefined
  // Why two optional fields rather than a discriminant: they are mutually exclusive
  // by construction (each `return` sets at most one) and the caller acts on them
  // independently — a notice for one, a log line for each.
  /** Set when the terminal opened somewhere the caller did not ask for. */
  fallback?: {
    kind: TerminalStartupCwdFallbackKind
    reason: TerminalStartupCwdRejection
    rejectedCwd: string
  }
  /** Every candidate was unusable: the spawn will die on chdir, so main can say so. */
  unrecoverable?: { rejectedCwd: string; reason: TerminalStartupCwdRejection }
}

export type TerminalStartupCwdMissingDirFallback = {
  // Why: only local callers can probe the filesystem — SSH/remote worktree
  // paths live on another host — so the usability check is injected.
  directoryUsability: (path: string) => TerminalStartupCwdUsability
  /** Tried before the workspace root. Terminal mode restarts a tab in its
   *  last-known pwd (terminal-mode-spec.md §4); when that directory is gone the
   *  tab's own creation folder is a closer answer than the workspace root. */
  fallbackCwd?: () => string | undefined
  /** Last resort, resolved lazily because only the failure path pays for it. A
   *  terminal-mode vertical tab's workspace root *is* its start folder, so an
   *  unusable root leaves the chain with nowhere else to land. */
  homeCwd?: () => string | undefined
}

type StartupCwdCandidate = {
  path: string | undefined
  /** Undefined for the steps that carry no user-visible notice. */
  kind?: TerminalStartupCwdFallbackKind
}

/** Path-only wrapper for the two callers that offer no fallback chain. */
export function resolveTerminalStartupCwd(
  worktreePath: string,
  requestedCwd?: string | null,
  missingDirFallback?: TerminalStartupCwdMissingDirFallback
): string | undefined {
  return resolveTerminalStartupCwdResult(worktreePath, requestedCwd, missingDirFallback).cwd
}

export function resolveTerminalStartupCwdResult(
  worktreePath: string,
  requestedCwd?: string | null,
  missingDirFallback?: TerminalStartupCwdMissingDirFallback
): TerminalStartupCwdResolution {
  const trimmedCwd = requestedCwd?.trim()
  if (!trimmedCwd) {
    return { cwd: undefined }
  }
  // Why: resolve relative requests against the worktree root and normalize
  // `..`; the cwd is intentionally not constrained to the worktree, so opening
  // or splitting a terminal outside it (e.g. after `cd ..`) is allowed. (#7685)
  const resolvedCwd = resolveRuntimePath(worktreePath, trimmedCwd)
  if (!missingDirFallback) {
    return { cwd: resolvedCwd }
  }
  const reason = missingDirFallback.directoryUsability(resolvedCwd)
  if (reason === 'usable') {
    return { cwd: resolvedCwd }
  }
  // Why an ordered list: a persisted/inherited startup folder can be deleted or
  // locked down later, and spawning into it fails on every retry (#7239). Each
  // later tier is a wider recovery, so the first usable one wins.
  const candidates: StartupCwdCandidate[] = [
    // No notice: reopening a tab at its own start folder is not the surprise
    // that landing at the workspace root is.
    { path: missingDirFallback.fallbackCwd?.()?.trim() },
    { path: worktreePath, kind: 'worktree' },
    { path: missingDirFallback.homeCwd?.()?.trim(), kind: 'home' }
  ]
  const tried = new Set([resolvedCwd])
  for (const candidate of candidates) {
    if (!candidate.path) {
      continue
    }
    const path = resolveRuntimePath(worktreePath, candidate.path)
    if (tried.has(path)) {
      continue
    }
    tried.add(path)
    if (missingDirFallback.directoryUsability(path) !== 'usable') {
      continue
    }
    return {
      cwd: path,
      ...(candidate.kind
        ? { fallback: { kind: candidate.kind, reason, rejectedCwd: resolvedCwd } }
        : {})
    }
  }
  // Why the requested cwd: with nothing usable (unmounted volume, stopped WSL
  // distro) a fallback would be misleading; let the provider surface its error.
  return { cwd: resolvedCwd, unrecoverable: { rejectedCwd: resolvedCwd, reason } }
}

export function resolveTerminalStartupCwdForWorkspace(args: {
  workspaceId?: string
  requestedCwd?: string | null
  resolveFolderWorkspacePath?: (folderWorkspaceId: string) => string | null | undefined
  missingDirFallback?: TerminalStartupCwdMissingDirFallback
}): TerminalStartupCwdResolution {
  if (!args.requestedCwd || args.requestedCwd.trim().length === 0) {
    return { cwd: undefined }
  }
  if (args.workspaceId === FLOATING_TERMINAL_WORKTREE_ID) {
    // Why: floating terminals have no worktree root; their cwd was already
    // resolved against the trusted-directory grants in resolveFloatingTerminalCwd.
    return { cwd: args.requestedCwd }
  }
  const workspacePath = resolveTerminalWorkspacePath(
    args.workspaceId,
    args.resolveFolderWorkspacePath
  )
  if (!workspacePath) {
    // Why: without a worktree root we can't anchor a relative request, so fall
    // back to the provider default rather than guessing a base.
    return { cwd: undefined }
  }
  return resolveTerminalStartupCwdResult(workspacePath, args.requestedCwd, args.missingDirFallback)
}

function resolveTerminalWorkspacePath(
  workspaceId: string | undefined,
  resolveFolderWorkspacePath: ((folderWorkspaceId: string) => string | null | undefined) | undefined
): string | null {
  if (!workspaceId) {
    return null
  }
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    return resolveFolderWorkspacePath?.(scope.folderWorkspaceId) ?? null
  }
  const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceId
  return splitWorktreeIdForFilesystem(worktreeId)?.worktreePath ?? null
}
