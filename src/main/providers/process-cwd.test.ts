import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock, readlinkMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readlinkMock: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: execFileMock
}))

vi.mock('fs/promises', () => ({
  readlink: readlinkMock
}))

const LSOF_OPTIONS = { encoding: 'utf-8' }

describe('resolveProcessCwd', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    execFileMock.mockReset()
    readlinkMock.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    readlinkMock.mockImplementation(async (procPath: string) => {
      const pid = procPath.match(/\/proc\/(\d+)\/cwd$/)?.[1] ?? 'unknown'
      return `/cwd/${pid}`
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds cached cwd results across unique process ids', async () => {
    const { resolveProcessCwd } = await import('./process-cwd')

    for (let pid = 1; pid <= 257; pid += 1) {
      await expect(resolveProcessCwd(pid)).resolves.toBe(`/cwd/${pid}`)
    }

    expect(readlinkMock).toHaveBeenCalledTimes(257)

    await expect(resolveProcessCwd(257)).resolves.toBe('/cwd/257')
    expect(readlinkMock).toHaveBeenCalledTimes(257)

    await expect(resolveProcessCwd(1)).resolves.toBe('/cwd/1')
    expect(readlinkMock).toHaveBeenCalledTimes(258)
  })

  it('falls back when lsof never reports completion', async () => {
    vi.useFakeTimers()
    readlinkMock.mockRejectedValue(new Error('proc unavailable'))
    const killMock = vi.fn()
    execFileMock.mockImplementation(() => ({ kill: killMock }))
    const { resolveProcessCwd } = await import('./process-cwd')

    let settled = false
    const cwdPromise = resolveProcessCwd(42).then((cwd) => {
      settled = true
      return cwd
    })

    await vi.waitFor(() =>
      expect(execFileMock).toHaveBeenCalledWith(
        'lsof',
        ['-a', '-p', '42', '-d', 'cwd', '-Fn'],
        LSOF_OPTIONS,
        expect.any(Function)
      )
    )
    await vi.advanceTimersByTimeAsync(1500)

    expect(settled).toBe(true)
    await expect(cwdPromise).resolves.toBe('')
    expect(killMock).toHaveBeenCalled()
    // A hung lsof is no evidence of a setuid parent, so the descent must not
    // run — it would double the worst-case budget this timeout exists to bound.
    expect(execFileMock).not.toHaveBeenCalledWith(
      'pgrep',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  // The login-wrapper descent below is macOS-only, so these run on a stubbed
  // platform rather than only passing on a Mac.
  describe('macOS login-wrapper descent', () => {
    const expectNoPgrep = (): void => {
      expect(execFileMock).not.toHaveBeenCalledWith(
        'pgrep',
        expect.anything(),
        expect.anything(),
        expect.anything()
      )
    }

    /** Every subprocess this module spawned, as `lsof <pid>` / `pgrep <pid>`. */
    const spawned = (): string[] =>
      execFileMock.mock.calls.map((call) =>
        call[0] === 'pgrep' ? `pgrep ${call[1][1]}` : `lsof ${call[1][2]}`
      )

    /** lsof answers with `n<path>` lines; no records at all means no output. */
    const respond = (replies: Record<string, [Error | null, string]>) => {
      execFileMock.mockImplementation(
        (
          file: string,
          args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string) => void
        ) => {
          const key = file === 'pgrep' ? 'pgrep' : args[2]
          callback(...(replies[key] ?? [null, '']))
          return { kill: vi.fn() }
        }
      )
    }

    /** Past the per-pid result TTL, so the next call re-resolves. */
    const expireResultCache = (): void => {
      vi.spyOn(Date, 'now').mockReturnValue(20_000)
    }

    let realPlatform: PropertyDescriptor | undefined

    beforeEach(() => {
      realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      readlinkMock.mockRejectedValue(new Error('proc unavailable'))
    })

    afterEach(() => {
      if (realPlatform) {
        Object.defineProperty(process, 'platform', realPlatform)
      }
    })

    // Why: on macOS the pty process is setuid-root `/usr/bin/login`, so lsof
    // reports no cwd record for it at all and the real shell is its child.
    it('descends to the first child when lsof reports nothing for the pty process', async () => {
      respond({
        '5950': [null, ''], // login(1) is root-owned: no records for us
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')
      expect(execFileMock).toHaveBeenCalledWith(
        'pgrep',
        ['-P', '5950'],
        { encoding: 'utf-8' },
        expect.any(Function)
      )
      expect(execFileMock).toHaveBeenCalledWith(
        'lsof',
        ['-a', '-p', '5953', '-d', 'cwd', '-Fn'],
        LSOF_OPTIONS,
        expect.any(Function)
      )
    })

    // A natural non-zero exit with no output is how lsof reports "nothing readable".
    it('descends when lsof exits non-zero for the pty process', async () => {
      respond({
        '5950': [Object.assign(new Error('lsof exit 1'), { code: 1 }), ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')
    })

    // A child we killed reports as an ordinary exec failure; it is not a verdict.
    it('does not descend when lsof is killed rather than answering', async () => {
      respond({
        '5950': [Object.assign(new Error('lsof killed'), { killed: true, code: 'ETIMEDOUT' }), ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('')
      expectNoPgrep()
    })

    // A binary that never started said nothing about the pid's owner either.
    it('does not descend when lsof is missing', async () => {
      respond({
        '5950': [Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' }), ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('')
      expectNoPgrep()
    })

    // Why only the first: one lsof over several pids emits unattributed `n`
    // lines, and the login trampoline `exec`s, so there is exactly one child.
    it('queries only the first child when several exist', async () => {
      respond({
        '5950': [null, ''],
        pgrep: [null, '5953\n5960\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/first\n'],
        '5960': [null, 'p5960\nfcwd\nn/Users/qa/second\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/first')
      expect(execFileMock).not.toHaveBeenCalledWith(
        'lsof',
        ['-a', '-p', '5960', '-d', 'cwd', '-Fn'],
        expect.anything(),
        expect.any(Function)
      )
    })

    it('does not spawn pgrep when the pty process answers directly', async () => {
      respond({ '77': [null, 'p77\nfcwd\nn/Users/qa/direct\n'] })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(77)).resolves.toBe('/Users/qa/direct')
      expect(execFileMock).toHaveBeenCalledTimes(1)
      expectNoPgrep()
    })

    it('returns empty when pgrep finds no children', async () => {
      // pgrep exits 1 when nothing matches, which the runner surfaces as an error.
      respond({ '4242': [null, ''], pgrep: [new Error('no match'), ''] })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(4242)).resolves.toBe('')
    })

    it('returns empty when the child reports no cwd either', async () => {
      respond({ '4242': [null, ''], pgrep: [null, '4243\n'], '4243': [null, ''] })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(4242)).resolves.toBe('')
    })

    it('ignores non-numeric pgrep output', async () => {
      respond({ '4242': [null, ''], pgrep: [null, '\nabc\n-1\n'] })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(4242)).resolves.toBe('')
      expect(execFileMock).toHaveBeenCalledTimes(2) // lsof + pgrep, no third
    })

    it('serves a repeat call from the cache without re-running the descent', async () => {
      respond({
        '5950': [null, ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')
      const spawnsAfterFirst = execFileMock.mock.calls.length
      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')
      expect(execFileMock).toHaveBeenCalledTimes(spawnsAfterFirst)
    })

    // The panels poll past the result TTL, so steady state must stay at one lsof.
    it('polls the memoized shell pid directly once the descent has run', async () => {
      respond({
        '5950': [null, ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')
      expect(spawned()).toEqual(['lsof 5950', 'pgrep 5950', 'lsof 5953'])

      execFileMock.mockClear()
      expireResultCache()
      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')
      expect(spawned()).toEqual(['lsof 5953'])
    })

    it('re-probes when the memoized shell pid stops answering', async () => {
      respond({
        '5950': [null, ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')
      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/repo')

      // The old shell is gone and a fresh pty took the same pid.
      respond({
        '5950': [null, ''],
        pgrep: [null, '5999\n'],
        '5999': [null, 'p5999\nfcwd\nn/Users/qa/moved\n']
      })
      execFileMock.mockClear()
      expireResultCache()

      await expect(resolveProcessCwd(5950)).resolves.toBe('/Users/qa/moved')
      expect(spawned()).toEqual(['lsof 5953', 'lsof 5950', 'pgrep 5950', 'lsof 5999'])
    })

    it('coalesces concurrent callers onto one descent', async () => {
      respond({
        '5950': [null, ''],
        pgrep: [null, '5953\n'],
        '5953': [null, 'p5953\nfcwd\nn/Users/qa/repo\n']
      })
      const { resolveProcessCwd } = await import('./process-cwd')

      const [a, b] = await Promise.all([resolveProcessCwd(5950), resolveProcessCwd(5950)])
      expect([a, b]).toEqual(['/Users/qa/repo', '/Users/qa/repo'])
      expect(execFileMock.mock.calls.filter((call) => call[0] === 'pgrep')).toHaveLength(1)
    })
  })

  it('does not descend to child pids off macOS', async () => {
    const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      readlinkMock.mockRejectedValue(new Error('proc unavailable'))
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string) => void
        ) => {
          callback(null, '')
          return { kill: vi.fn() }
        }
      )
      const { resolveProcessCwd } = await import('./process-cwd')

      await expect(resolveProcessCwd(5950)).resolves.toBe('')
      expect(execFileMock).toHaveBeenCalledTimes(1)
    } finally {
      if (realPlatform) {
        Object.defineProperty(process, 'platform', realPlatform)
      }
    }
  })
})
