import { execFile, type ExecFileException } from 'node:child_process'
import { readlink } from 'node:fs/promises'

/**
 * Resolve the current working directory of a local process by pid.
 *
 * Why duplicated from `src/relay/pty-shell-utils.ts`: the relay and Electron
 * main process have separate build graphs, and cross-importing across them
 * is not a pattern used in this repo. The function is short and pure, and
 * the duplication is cheaper than reshaping both bundle graphs. The relay
 * copy needs no login(1) descent: only main and the daemon wrap spawns in it.
 *
 * Tries `/proc/<pid>/cwd` on Linux, falls back to `lsof -d cwd` on macOS, and
 * on macOS only, to the process's first child when `lsof` answers with no
 * records for the pid itself (the setuid-root login wrapper — see
 * {@link doResolve}). Returns `''` when none of those work (including Windows,
 * where `/proc` is absent and `lsof` is not native).
 *
 * Results are coalesced and briefly cached per-pid: rapid repeat calls
 * (e.g. chained Cmd+D on macOS) reuse a single `lsof` child rather than
 * stacking concurrent subprocesses whose results the caller may discard
 * after its own timeout.
 */
const CACHE_TTL_MS = 1500
const CACHE_MAX_ENTRIES = 256
const LSOF_TIMEOUT_MS = 1500
const PGREP_TIMEOUT_MS = 500

type CacheEntry = { value: string; at: number }
const resultCache = new Map<number, CacheEntry>()
const inflight = new Map<number, Promise<string>>()
/**
 * pty pid → the login(1) child whose cwd answered for it; only ever written on
 * macOS. Both cwd panels poll on a cadence deliberately longer than the TTL
 * above, so every tick misses; without this each one would re-run the parent
 * `lsof` (which cannot answer) and `pgrep` before reaching the same child.
 * An entry that stops answering is dropped and re-probed, which is also how a
 * recycled pid heals.
 */
const loginShellPidByPtyPid = new Map<number, number>()

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
      setBounded(resultCache, pid, { value, at: Date.now() })
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

// Why: terminals can churn through many OS PIDs in one app session. A short TTL
// only helps if the old PID is queried again, so also bound unique keys.
function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value)
  while (map.size > CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next()
    if (oldest.done) {
      break
    }
    map.delete(oldest.value)
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

  const knownShellPid = loginShellPidByPtyPid.get(pid)
  if (knownShellPid !== undefined) {
    const memoized = await readCwdForPid(knownShellPid)
    if (memoized.cwd) {
      return memoized.cwd
    }
    // The shell is gone (login(1) follows it) or the pid was recycled; forget
    // the mapping and pay for one full probe to re-derive it.
    loginShellPidByPtyPid.delete(pid)
  }

  const direct = await readCwdForPid(pid)
  if (direct.cwd || !direct.answered || process.platform !== 'darwin') {
    return direct.cwd
  }

  // Why: on macOS the pty process is `/usr/bin/login` (setuid root — see
  // macos-tcc-login-shell.ts), whose file descriptors lsof will not report to a
  // non-root caller, so the query above answers with no cwd record at all. That
  // trampoline `exec`s, so the user's shell is the login process's first child.
  // Only lsof's own verdict descends: a kill, a timeout or a failure to spawn is
  // no evidence of a setuid parent, and descending on one would multiply the
  // worst-case budget those bounds exist to cap.
  // Caveat: no-records is a proxy for "this is the wrapper" — were Orca itself
  // running as root, lsof would answer for login(1) and report its unchanging
  // spawn directory instead. Fixing that needs the spawn-site fact (whether
  // wrapShellSpawnForMacosTccAttribution wrapped this pty) threaded down to this
  // call rather than inferred here.
  const shellPid = await firstChildPid(pid)
  if (shellPid === undefined) {
    return ''
  }
  const { cwd } = await readCwdForPid(shellPid)
  if (cwd) {
    setBounded(loginShellPidByPtyPid, pid, shellPid)
  }
  return cwd
}

/** `answered` separates lsof's own verdict from a kill, timeout or spawn failure. */
type CwdQuery = { cwd: string; answered: boolean }

async function readCwdForPid(pid: number): Promise<CwdQuery> {
  try {
    // Why: `-a` ANDs the -p and -d filters. Without it, macOS lsof ORs them
    // and emits cwd records for every process on the system, so the n-line
    // scan below picks up the first unrelated process (often pid ~391 with
    // cwd `/`) and returns `/` regardless of the target pid's real cwd.
    const stdout = await runCapturingStdout(
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
        return { cwd: line.slice(1), answered: true }
      }
    }
    return { cwd: '', answered: true }
  } catch (error) {
    return { cwd: '', answered: commandReachedVerdict(error) }
  }
}

/**
 * Whether the command exited on its own terms. lsof exits non-zero with no
 * output when it can read nothing for a pid, which is exactly the setuid case
 * the caller descends on — so a natural exit code is an answer, while a process
 * we killed (`killed`), or never started (ENOENT, whose code is a string), is
 * not. Same line `classifyLoginPreflightError` draws for login(1) in
 * macos-login-session-pty-probe.ts.
 */
function commandReachedVerdict(error: unknown): boolean {
  const failure = error as Partial<ExecFileException> | undefined
  return failure?.killed !== true && typeof failure?.code === 'number'
}

/**
 * Lowest-numbered direct child of `pid`, or undefined when pgrep is unavailable
 * or finds none. login(1) has exactly one child, so ordering is moot here.
 */
async function firstChildPid(pid: number): Promise<number | undefined> {
  try {
    const stdout = await runCapturingStdout('pgrep', ['-P', String(pid)], PGREP_TIMEOUT_MS)
    for (const line of stdout.split('\n')) {
      const child = Number.parseInt(line.trim(), 10)
      if (Number.isInteger(child) && child > 0) {
        return child
      }
    }
    return undefined
  } catch {
    // pgrep exits 1 when nothing matches, which the runner surfaces as an error.
    return undefined
  }
}

function runCapturingStdout(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof execFile> | undefined
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child?.kill()
      reject(new Error(`${file} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      callback()
    }

    // Why this timer and not execFile's `timeout` option: the option would race
    // this one for the same deadline and report the child it killed as an
    // ordinary exec failure, which commandReachedVerdict must never read as a
    // verdict. It also only signals the child — a missing callback would leave
    // the shared per-pid cwd lookup promise pending forever.
    try {
      child = execFile(file, args, { encoding: 'utf-8' }, (error, stdout) => {
        if (error) {
          settle(() => reject(error))
          return
        }
        settle(() => resolve(String(stdout)))
      })
    } catch (error) {
      settle(() => reject(error))
    }
  })
}
