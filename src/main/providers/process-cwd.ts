import { execFile as execFileCb } from 'node:child_process'
import { readlink } from 'node:fs/promises'

/**
 * Resolve the current working directory of a local process by pid.
 *
 * Why duplicated from `src/relay/pty-shell-utils.ts`: the relay and Electron
 * main process have separate build graphs, and cross-importing across them
 * is not a pattern used in this repo. The function is short and pure, and
 * the duplication is cheaper than reshaping both bundle graphs.
 *
 * Tries `/proc/<pid>/cwd` on Linux, falls back to `lsof -d cwd` on macOS, and
 * on macOS only, to the process's first child when `lsof` can read nothing for
 * the pid itself (the setuid-root login wrapper — see {@link doResolve}).
 * Returns `''` when none of those work (including Windows, where `/proc` is
 * absent and `lsof` is not native).
 *
 * Results are coalesced and briefly cached per-pid: rapid repeat calls
 * (e.g. chained Cmd+D on macOS) reuse a single `lsof` child rather than
 * stacking concurrent subprocesses whose results the caller may discard
 * after its own timeout. The cache is keyed on the pid the caller passed; the
 * child pid the macOS descent finds is nobody's held reference, so a recycled
 * child within the TTL would be attributed to this parent.
 */
const CACHE_TTL_MS = 1500
const CACHE_MAX_ENTRIES = 256
const LSOF_TIMEOUT_MS = 1500
const PGREP_TIMEOUT_MS = 500

type CacheEntry = { value: string; at: number }
const resultCache = new Map<number, CacheEntry>()
const inflight = new Map<number, Promise<string>>()

export async function resolveProcessCwd(pid: number): Promise<string> {
  // Assumes the caller holds a live reference to `pid` for the TTL window.
  // If a pid is recycled within 1.5s of a prior query, the cache would
  // return the previous process's cwd — acceptable because our callers
  // (getCwd on an active pty/session) can't outlive their pid.
  const now = Date.now()
  sweepExpiredResultCache(now)
  const cached = resultCache.get(pid)
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value
  }
  const existing = inflight.get(pid)
  if (existing) {
    return existing
  }
  // Populate the cache inside the shared promise chain so every awaiter
  // (including any second caller that joined via `inflight`) observes the
  // result through the same write, rather than racing on a post-await set.
  // `finally` rather than a tail of `then`: doResolve catches everything today,
  // but a future throw must not strand the entry and wedge this pid forever.
  const promise = doResolve(pid)
    .then((value) => {
      rememberResult(pid, value, Date.now())
      return value
    })
    .finally(() => inflight.delete(pid))
  inflight.set(pid, promise)
  return promise
}

function sweepExpiredResultCache(now: number): void {
  for (const [cachedPid, entry] of resultCache) {
    if (now - entry.at >= CACHE_TTL_MS) {
      resultCache.delete(cachedPid)
    }
  }
}

function rememberResult(pid: number, value: string, now: number): void {
  resultCache.set(pid, { value, at: now })
  // Why: terminals can churn through many OS PIDs in one app session. A short
  // TTL only helps if the old PID is queried again, so also bound unique keys.
  while (resultCache.size > CACHE_MAX_ENTRIES) {
    const oldest = resultCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    resultCache.delete(oldest)
  }
}

async function doResolve(pid: number): Promise<string> {
  // Why: skip an existsSync gate and just try the readlink. The check+read
  // pair races a concurrent process exit the same way the lsof+existsSync
  // pair did, and the catch already falls through to lsof.
  try {
    return await readlink(`/proc/${pid}/cwd`)
  } catch {
    /* fall through */
  }

  const direct = await readCwdForPid(pid)
  if (direct.cwd || direct.timedOut || process.platform !== 'darwin') {
    return direct.cwd
  }

  // Why: on macOS the pty process is `/usr/bin/login` (setuid root — see
  // macos-tcc-login-shell.ts), whose file descriptors lsof will not report to a
  // non-root caller, so the query above finds no cwd record at all. That
  // trampoline `exec`s, so the user's shell is the login process's first child.
  // A timeout is excluded above: a slow lsof is no evidence of a setuid parent,
  // and descending on it would double this call's worst-case budget. The
  // no-records signal is a proxy for "this is the wrapper" — if Orca itself ran
  // as root, lsof would answer for login(1) and report its unchanging spawn
  // directory instead.
  const [firstChild] = await childPids(pid)
  return firstChild === undefined ? '' : (await readCwdForPid(firstChild)).cwd
}

/** `timedOut` separates "lsof read nothing for this pid" from "lsof hung". */
type CwdQuery = { cwd: string; timedOut: boolean }

async function readCwdForPid(pid: number): Promise<CwdQuery> {
  try {
    // Why: `-a` ANDs the -p and -d filters. Without it, macOS lsof ORs them
    // and emits cwd records for every process on the system, so the n-line
    // scan below picks up the first unrelated process (often pid ~391 with
    // cwd `/`) and returns `/` regardless of the target pid's real cwd.
    const stdout = await execFile(
      'lsof',
      ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      LSOF_TIMEOUT_MS
    )
    for (const line of stdout.split('\n')) {
      if (line.startsWith('n') && line.includes('/')) {
        // Why: lsof -d cwd is authoritative — don't second-guess it with
        // existsSync. A concurrent rmdir would race the check and cause us
        // to drop the correct answer; node-pty handles a missing cwd on
        // spawn anyway.
        return { cwd: line.slice(1), timedOut: false }
      }
    }
    return { cwd: '', timedOut: false }
  } catch (error) {
    // lsof exits non-zero with no output when it can read nothing for the pid,
    // which is exactly the setuid case the caller descends on.
    return { cwd: '', timedOut: error instanceof CommandTimeoutError }
  }
}

/** Direct children of `pid`, empty when pgrep is unavailable or finds none. */
async function childPids(pid: number): Promise<number[]> {
  try {
    const stdout = await execFile('pgrep', ['-P', String(pid)], PGREP_TIMEOUT_MS)
    return stdout
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((child) => Number.isInteger(child) && child > 0)
  } catch {
    // pgrep exits 1 when nothing matches, which execFile surfaces as an error.
    return []
  }
}

class CommandTimeoutError extends Error {}

function execFile(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof execFileCb> | undefined
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child?.kill()
      reject(new CommandTimeoutError(`${file} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      callback()
    }

    // Why: execFile's timeout only signals the child; a missing callback would
    // otherwise leave the shared per-pid cwd lookup promise cached forever.
    try {
      child = execFileCb(
        file,
        args,
        {
          encoding: 'utf-8',
          timeout: timeoutMs
        },
        (error, stdout) => {
          if (error) {
            settle(() => reject(error))
            return
          }
          settle(() => resolve(String(stdout)))
        }
      )
    } catch (error) {
      settle(() => reject(error))
    }
  })
}
