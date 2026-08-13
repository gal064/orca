import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from './runner'
import {
  clearRepoRootForPathCache,
  lookupRepoRootForPath,
  REPO_ROOT_CACHE_TTL_MS,
  resolveLocalRepoRootForPath
} from './repo-root-for-path'

let workspace: string

beforeEach(async () => {
  clearRepoRootForPathCache()
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'orca-repo-root-')))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

async function makeRepo(name: string): Promise<string> {
  const repoPath = join(workspace, name)
  await mkdir(repoPath, { recursive: true })
  await gitExecFileAsync(['init'], { cwd: repoPath })
  return repoPath
}

describe('resolveLocalRepoRootForPath', () => {
  it('resolves a repository root from the root itself', async () => {
    const repoPath = await makeRepo('repo')
    expect(await resolveLocalRepoRootForPath(repoPath)).toBe(repoPath)
  })

  it('resolves the enclosing root from a nested subdirectory', async () => {
    const repoPath = await makeRepo('repo')
    const nested = join(repoPath, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    expect(await resolveLocalRepoRootForPath(nested)).toBe(repoPath)
  })

  it('returns null outside any repository', async () => {
    const plain = join(workspace, 'plain')
    await mkdir(plain, { recursive: true })
    expect(await resolveLocalRepoRootForPath(plain)).toBeNull()
  })

  it('returns null for a directory that does not exist', async () => {
    expect(await resolveLocalRepoRootForPath(join(workspace, 'missing'))).toBeNull()
  })
})

describe('lookupRepoRootForPath', () => {
  it('serves a cache hit without re-running the lookup', async () => {
    const load = vi.fn().mockResolvedValue('/repo')
    expect(await lookupRepoRootForPath('local', '/repo/sub', load, 1000)).toBe('/repo')
    expect(await lookupRepoRootForPath('local', '/repo/sub', load, 1000)).toBe('/repo')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('re-runs the lookup once the TTL expires', async () => {
    const load = vi.fn().mockResolvedValueOnce('/repo').mockResolvedValueOnce(null)
    expect(await lookupRepoRootForPath('local', '/repo/sub', load, 1000)).toBe('/repo')
    expect(
      await lookupRepoRootForPath('local', '/repo/sub', load, 1000 + REPO_ROOT_CACHE_TTL_MS + 1)
    ).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keys the cache per host so the same path can differ across hosts', async () => {
    const local = vi.fn().mockResolvedValue('/repo')
    const remote = vi.fn().mockResolvedValue(null)
    expect(await lookupRepoRootForPath('local', '/repo/sub', local, 1000)).toBe('/repo')
    expect(await lookupRepoRootForPath('ssh:box', '/repo/sub', remote, 1000)).toBeNull()
    expect(local).toHaveBeenCalledTimes(1)
    expect(remote).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed lookup', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('transport')).mockResolvedValue('/repo')
    await expect(lookupRepoRootForPath('local', '/repo', load, 1000)).rejects.toThrow('transport')
    expect(await lookupRepoRootForPath('local', '/repo', load, 1000)).toBe('/repo')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
