import { gitExecFileAsync } from './runner'
import { normalizeGitRepoRootForInputPath } from './repo'

/**
 * Nearest enclosing repository root of an arbitrary directory — terminal mode's
 * git panel scope (docs/terminal-mode-spec.md §2: "nearest enclosing repo of
 * pwd"). Unlike `getGitRepoRoot`, this returns `null` outside a repository
 * instead of echoing the input back, because the panel's empty state is a
 * distinct product state and must not be confused with "repo rooted at pwd".
 *
 * Async and WSL-aware on purpose: `getGitRepoRoot` runs `gitExecFileSync`,
 * which cannot route through the WSL runner, and the caller is a `cd`-driven
 * hot path that must not block the main thread.
 */

/** `rev-parse --show-toplevel` predates Git 2.0, so no capability probe is needed
 *  (docs/reference/git-compatibility.md baseline is 2.25). */
const REPO_ROOT_ARGS = ['rev-parse', '--show-toplevel']

export async function resolveLocalRepoRootForPath(
  dirPath: string,
  options: { wslDistro?: string } = {}
): Promise<string | null> {
  try {
    const { stdout } = await gitExecFileAsync(REPO_ROOT_ARGS, {
      cwd: dirPath,
      ...(options.wslDistro === undefined ? {} : { wslDistro: options.wslDistro })
    })
    const root = stdout.trim()
    // Why normalize: WSL git answers with a Linux-native root; later git calls in
    // that root must keep routing through the WSL runner.
    return root ? normalizeGitRepoRootForInputPath(dirPath, root) : null
  } catch {
    // Not a repository, missing directory, or no git binary — all "no repo here".
    return null
  }
}

/** Repo roots move only when a repo is created/removed, so a short TTL keeps `cd`
 *  churn off the git binary while still noticing a fresh `git init`. */
export const REPO_ROOT_CACHE_TTL_MS = 10_000
const REPO_ROOT_CACHE_MAX_ENTRIES = 256

type RepoRootCacheEntry = {
  expiresAtMs: number
  value: Promise<string | null>
}

const repoRootCache = new Map<string, RepoRootCacheEntry>()

/**
 * Cache key. The host is part of it because the same absolute path means
 * different things on local, each SSH target, and each remote runtime.
 */
function repoRootCacheKey(hostKey: string, dirPath: string): string {
  return `${hostKey}\0${dirPath}`
}

/**
 * Memoizes `load` per (host, directory). In-flight promises are shared so a
 * burst of `cd`s collapses to one git invocation per directory.
 */
export async function lookupRepoRootForPath(
  hostKey: string,
  dirPath: string,
  load: (dirPath: string) => Promise<string | null>,
  nowMs: number = Date.now()
): Promise<string | null> {
  const key = repoRootCacheKey(hostKey, dirPath)
  const cached = repoRootCache.get(key)
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value
  }
  const value = load(dirPath).catch((error: unknown) => {
    // Why drop the entry: a transport blip must not be cached as "no repo" for
    // the whole TTL; the next panel refresh should retry.
    repoRootCache.delete(key)
    throw error
  })
  repoRootCache.set(key, { expiresAtMs: nowMs + REPO_ROOT_CACHE_TTL_MS, value })
  pruneRepoRootCache(nowMs)
  return value
}

function pruneRepoRootCache(nowMs: number): void {
  if (repoRootCache.size <= REPO_ROOT_CACHE_MAX_ENTRIES) {
    return
  }
  for (const [key, entry] of repoRootCache) {
    if (entry.expiresAtMs <= nowMs) {
      repoRootCache.delete(key)
    }
  }
  // Insertion order is oldest-first: shed the oldest entries if everything is live.
  for (const key of repoRootCache.keys()) {
    if (repoRootCache.size <= REPO_ROOT_CACHE_MAX_ENTRIES) {
      break
    }
    repoRootCache.delete(key)
  }
}

export function clearRepoRootForPathCache(): void {
  repoRootCache.clear()
}
