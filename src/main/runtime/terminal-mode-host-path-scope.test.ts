import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_MODE_GROUP_NAME } from '../../shared/terminal-mode-group'
import {
  clearTerminalModePathScopeStateForTests,
  recordTerminalModeObservedCwd
} from '../ipc/terminal-mode-path-scope'
import {
  clearTerminalModeHostPathScope,
  clearTerminalModeHostPathScopesForTests,
  declareTerminalModeHostPathScope,
  getTerminalModeHostPathScope,
  isPathInTerminalModeHostScope,
  resolveTerminalModeHostScopedPath
} from './terminal-mode-host-path-scope'

vi.mock('../git/repo-root-for-path', () => ({
  lookupRepoRootForPath: vi.fn(async () => null),
  resolveLocalRepoRootForPath: vi.fn(async () => null)
}))

const VTAB_KEY = 'folder:vtab-1'
let root: string
let startFolder: string
let elsewhere: string

function makeStore(overrides: { folderWorkspaces?: unknown[]; projectGroups?: unknown[] } = {}) {
  return {
    getSettings: () => ({ experimentalTerminalMode: false }),
    getProjectGroups: () =>
      overrides.projectGroups ?? [{ id: 'hidden', name: TERMINAL_MODE_GROUP_NAME }],
    getFolderWorkspaces: () =>
      overrides.folderWorkspaces ?? [
        { id: 'vtab-1', projectGroupId: 'hidden', folderPath: startFolder }
      ]
  } as never
}

beforeEach(async () => {
  clearTerminalModeHostPathScopesForTests()
  clearTerminalModePathScopeStateForTests()
  root = await mkdtemp(join(tmpdir(), 'orca-host-scope-'))
  startFolder = join(root, 'start')
  elsewhere = join(root, 'elsewhere')
  await mkdir(startFolder, { recursive: true })
  await mkdir(join(elsewhere, 'nested'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('declareTerminalModeHostPathScope', () => {
  it('grants the vertical tab’s own start folder without any observation', async () => {
    const result = await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    expect(result.accepted).toBe(true)
    expect(getTerminalModeHostPathScope(makeStore(), VTAB_KEY)?.root).toBe(startFolder)
  })

  it('refuses a directory the host never saw one of that tab’s shells in', async () => {
    const result = await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    expect(result.accepted).toBe(false)
    expect(getTerminalModeHostPathScope(makeStore(), VTAB_KEY)).toBeNull()
  })

  it('grants a directory once a PTY of that tab reported it', async () => {
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    const result = await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    expect(result.accepted).toBe(true)
  })

  it('never lets one tab’s observation authorize another tab', async () => {
    recordTerminalModeObservedCwd('folder:other', elsewhere)
    const result = await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    expect(result.accepted).toBe(false)
  })

  it('refuses a workspace that is not a terminal-mode vertical tab', async () => {
    const classic = makeStore({
      projectGroups: [{ id: 'hidden', name: 'Work' }]
    })
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    expect(
      (await declareTerminalModeHostPathScope(classic, { workspaceKey: VTAB_KEY, root: elsewhere }))
        .accepted
    ).toBe(false)
  })

  it('refuses a classic worktree selector outright', async () => {
    recordTerminalModeObservedCwd('worktree:repo::/w', elsewhere)
    expect(
      (
        await declareTerminalModeHostPathScope(makeStore(), {
          workspaceKey: 'worktree:repo::/w',
          root: elsewhere
        })
      ).accepted
    ).toBe(false)
  })

  it('refuses a relative path, a filesystem root, and a file', async () => {
    const file = join(startFolder, 'a.txt')
    await writeFile(file, 'x')
    recordTerminalModeObservedCwd(VTAB_KEY, file)
    for (const candidate of ['relative/dir', '/', file]) {
      expect(
        (
          await declareTerminalModeHostPathScope(makeStore(), {
            workspaceKey: VTAB_KEY,
            root: candidate
          })
        ).accepted
      ).toBe(false)
    }
  })

  it('is not gated on this process’s own terminal-mode flag — a host never has it', async () => {
    // The client owns the flag; the host only owns the vertical tabs it hosts.
    expect(
      (
        await declareTerminalModeHostPathScope(makeStore(), {
          workspaceKey: VTAB_KEY,
          root: startFolder
        })
      ).accepted
    ).toBe(true)
  })

  it('revokes on an explicit null and on tab deletion', async () => {
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    await declareTerminalModeHostPathScope(makeStore(), { workspaceKey: VTAB_KEY, root: null })
    expect(getTerminalModeHostPathScope(makeStore(), VTAB_KEY)).toBeNull()

    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    clearTerminalModeHostPathScope(VTAB_KEY)
    expect(getTerminalModeHostPathScope(makeStore(), VTAB_KEY)).toBeNull()
  })

  it('drops the grant once the workspace stops being a vertical tab', async () => {
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    expect(getTerminalModeHostPathScope(makeStore({ folderWorkspaces: [] }), VTAB_KEY)).toBeNull()
  })
})

describe('concurrent declarations', () => {
  const OTHER_KEY = 'folder:vtab-2'
  function twoTabStore() {
    return makeStore({
      folderWorkspaces: [
        { id: 'vtab-1', projectGroupId: 'hidden', folderPath: startFolder },
        { id: 'vtab-2', projectGroupId: 'hidden', folderPath: elsewhere }
      ]
    })
  }

  it('never lets one tab’s `cd` cancel another tab’s', async () => {
    // The declaration token is per tab: a shared one made any activity on tab B
    // reject tab A's in-flight grant while still leaving it written.
    const store = twoTabStore()
    const [first, second] = await Promise.all([
      declareTerminalModeHostPathScope(store, { workspaceKey: VTAB_KEY, root: startFolder }),
      declareTerminalModeHostPathScope(store, { workspaceKey: OTHER_KEY, root: elsewhere })
    ])
    expect([first.accepted, second.accepted]).toEqual([true, true])
    expect(getTerminalModeHostPathScope(store, VTAB_KEY)?.root).toBe(startFolder)
    expect(getTerminalModeHostPathScope(store, OTHER_KEY)?.root).toBe(elsewhere)
  })

  it('withdraws the grant of a declaration that lost to a newer `cd` on the same tab', async () => {
    const store = makeStore()
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    const stale = declareTerminalModeHostPathScope(store, {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    const fresh = declareTerminalModeHostPathScope(store, {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    const [staleResult, freshResult] = await Promise.all([stale, fresh])
    expect(freshResult.accepted).toBe(true)
    expect(staleResult.accepted).toBe(false)
    // The loser must not leave its directory granted behind the client's back.
    expect(getTerminalModeHostPathScope(store, VTAB_KEY)?.root).toBe(elsewhere)
  })

  it('lets a revoke beat a declaration still in flight for that tab', async () => {
    const store = makeStore()
    const pending = declareTerminalModeHostPathScope(store, {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    clearTerminalModeHostPathScope(VTAB_KEY)
    expect((await pending).accepted).toBe(false)
    expect(getTerminalModeHostPathScope(store, VTAB_KEY)).toBeNull()
  })
})

describe('resolveTerminalModeHostScopedPath', () => {
  it('resolves a path inside the granted directory', async () => {
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    await expect(
      resolveTerminalModeHostScopedPath(makeStore(), VTAB_KEY, join(elsewhere, 'nested'))
    ).resolves.toContain('nested')
  })

  it('never grants the enclosing repository — unused reach is reach', async () => {
    // The repo root is reported so the client can root its git panel, but every remote
    // git surface addresses a worktree selector, so nothing may read through it here.
    recordTerminalModeObservedCwd(VTAB_KEY, join(elsewhere, 'nested'))
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: join(elsewhere, 'nested')
    })
    await expect(
      resolveTerminalModeHostScopedPath(makeStore(), VTAB_KEY, join(elsewhere, 'note'))
    ).resolves.toBeNull()
  })

  it('refuses a sibling of the granted directory', async () => {
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    await expect(
      resolveTerminalModeHostScopedPath(makeStore(), VTAB_KEY, startFolder)
    ).resolves.toBeNull()
  })

  it('refuses a traversal out of the granted directory', async () => {
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    await expect(
      resolveTerminalModeHostScopedPath(makeStore(), VTAB_KEY, join(elsewhere, '..', 'start'))
    ).resolves.toBeNull()
  })

  it('refuses a symlink that escapes the granted directory', async () => {
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    await symlink(startFolder, join(elsewhere, 'escape'))
    await expect(
      resolveTerminalModeHostScopedPath(makeStore(), VTAB_KEY, join(elsewhere, 'escape'))
    ).resolves.toBeNull()
  })

  it('reports a live grant synchronously, and stops reporting it the moment it is revoked', async () => {
    // The oracle for `files.watch`: a stream authorized once at subscribe must keep
    // asking, or "the grant dies with the tab" is false for the only surface that
    // keeps emitting after the read that authorized it.
    recordTerminalModeObservedCwd(VTAB_KEY, elsewhere)
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    const nested = join(elsewhere, 'nested')
    expect(isPathInTerminalModeHostScope(makeStore(), VTAB_KEY, nested)).toBe(true)

    // …the tab is deleted
    clearTerminalModeHostPathScope(VTAB_KEY)
    expect(isPathInTerminalModeHostScope(makeStore(), VTAB_KEY, nested)).toBe(false)

    // …the shell moves on
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: elsewhere
    })
    recordTerminalModeObservedCwd(VTAB_KEY, startFolder)
    await declareTerminalModeHostPathScope(makeStore(), {
      workspaceKey: VTAB_KEY,
      root: startFolder
    })
    expect(isPathInTerminalModeHostScope(makeStore(), VTAB_KEY, nested)).toBe(false)
    expect(isPathInTerminalModeHostScope(makeStore(), VTAB_KEY, startFolder)).toBe(true)

    // …the workspace stops being a vertical tab
    expect(
      isPathInTerminalModeHostScope(makeStore({ folderWorkspaces: [] }), VTAB_KEY, startFolder)
    ).toBe(false)
  })

  it('refuses everything when no grant was declared', async () => {
    await expect(
      resolveTerminalModeHostScopedPath(makeStore(), VTAB_KEY, join(elsewhere, 'nested'))
    ).resolves.toBeNull()
  })
})
