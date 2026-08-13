import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '../persistence'
import type { FolderWorkspace, ProjectGroup } from '../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../shared/terminal-mode-group'
import { gitExecFileAsync } from '../git/runner'
import { clearRepoRootForPathCache } from '../git/repo-root-for-path'
import {
  applyTerminalModePathScope,
  boundedRepoRoot,
  clearTerminalModePathScope,
  clearTerminalModePathScopeStateForTests,
  getTerminalModePathScopeRoots,
  isTerminalModeGitRoot,
  recordTerminalModeObservedCwd
} from './terminal-mode-path-scope'
import { getAllowedRoots, invalidateAuthorizedRootsCache } from './filesystem-auth'

const TERMINAL_GROUP: ProjectGroup = {
  id: 'group-terminal',
  name: TERMINAL_MODE_GROUP_NAME,
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

const CLASSIC_GROUP: ProjectGroup = { ...TERMINAL_GROUP, id: 'group-classic', name: 'Projects' }

function makeVtab(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'vtab-1',
    projectGroupId: TERMINAL_GROUP.id,
    name: 'tab',
    folderPath: '/home/user',
    comment: '',
    linkedTask: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeStore(options: {
  terminalMode?: boolean
  groups?: ProjectGroup[]
  workspaces?: FolderWorkspace[]
}): Store {
  return {
    getRepos: () => [],
    getProjectGroups: () => options.groups ?? [TERMINAL_GROUP],
    getFolderWorkspaces: () => options.workspaces ?? [makeVtab()],
    getSettings: () => ({ experimentalTerminalMode: options.terminalMode ?? true })
  } as unknown as Store
}

let workspace: string

// Why observe first: main only grants a directory it has seen one of the tab's
// shells in, so every accept case has to establish that provenance.
async function grant(store: Store, root: string) {
  recordTerminalModeObservedCwd('folder:vtab-1', root)
  return applyTerminalModePathScope(store, { workspaceKey: 'folder:vtab-1', root })
}

beforeEach(async () => {
  clearTerminalModePathScopeStateForTests()
  clearRepoRootForPathCache()
  invalidateAuthorizedRootsCache()
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'orca-scope-')))
})

afterEach(async () => {
  clearTerminalModePathScopeStateForTests()
  await rm(workspace, { recursive: true, force: true })
})

describe('applyTerminalModePathScope', () => {
  it('accepts an existing directory declared by a live vertical tab', async () => {
    const store = makeStore({})
    const result = await grant(store, workspace)
    expect(result.accepted).toBe(true)
    expect(getTerminalModePathScopeRoots(store)).toEqual([workspace])
  })

  it('resolves and grants the enclosing repository root', async () => {
    await gitExecFileAsync(['init'], { cwd: workspace })
    const nested = join(workspace, 'src')
    await mkdir(nested, { recursive: true })
    const store = makeStore({})
    const result = await grant(store, nested)
    expect(result.repoRoot).toBe(workspace)
    expect(getTerminalModePathScopeRoots(store)).toEqual([nested, workspace])
    expect(isTerminalModeGitRoot(workspace, store)).toBe(true)
    expect(isTerminalModeGitRoot(join(workspace, 'other'), store)).toBe(false)
  })

  it('rejects a directory that does not resolve, leaving the previous grant intact', async () => {
    const store = makeStore({})
    await grant(store, workspace)
    const rejected = await grant(store, '/definitely/not/here')
    expect(rejected.accepted).toBe(false)
    expect(getTerminalModePathScopeRoots(store)).toEqual([workspace])
  })

  it('rejects relative paths', async () => {
    const store = makeStore({})
    const result = await grant(store, 'relative/dir')
    expect(result.accepted).toBe(false)
    expect(getTerminalModePathScopeRoots(store)).toEqual([])
  })

  it('refuses to record a scope for a workspace that is not a vertical tab', async () => {
    const store = makeStore({
      groups: [CLASSIC_GROUP],
      workspaces: [makeVtab({ projectGroupId: CLASSIC_GROUP.id })]
    })
    const result = await grant(store, workspace)
    expect(result.accepted).toBe(false)
    expect(getTerminalModePathScopeRoots(store)).toEqual([])
  })

  it("refuses a directory main never saw one of the tab's shells in", async () => {
    const store = makeStore({})
    const result = await applyTerminalModePathScope(store, {
      workspaceKey: 'folder:vtab-1',
      root: workspace
    })
    expect(result.accepted).toBe(false)
    expect(getTerminalModePathScopeRoots(store)).toEqual([])
  })

  it('refuses the filesystem root even though it exists', async () => {
    const store = makeStore({})
    const result = await applyTerminalModePathScope(store, {
      workspaceKey: 'folder:vtab-1',
      root: '/'
    })
    expect(result.accepted).toBe(false)
    expect(getTerminalModePathScopeRoots(store)).toEqual([])
  })

  it("accepts the tab's own start folder without an observation", async () => {
    const store = makeStore({ workspaces: [makeVtab({ folderPath: workspace })] })
    const result = await applyTerminalModePathScope(store, {
      workspaceKey: 'folder:vtab-1',
      root: workspace
    })
    expect(result.accepted).toBe(true)
  })

  it("does not let one tab's observation authorize another tab", async () => {
    const store = makeStore({
      workspaces: [makeVtab(), makeVtab({ id: 'vtab-2', folderPath: '/home/other' })]
    })
    recordTerminalModeObservedCwd('folder:vtab-1', workspace)
    const result = await applyTerminalModePathScope(store, {
      workspaceKey: 'folder:vtab-2',
      root: workspace
    })
    expect(result.accepted).toBe(false)
  })

  it('lets a revoke beat a grant that is still in flight', async () => {
    const store = makeStore({})
    recordTerminalModeObservedCwd('folder:vtab-1', workspace)
    const inFlight = applyTerminalModePathScope(store, {
      workspaceKey: 'folder:vtab-1',
      root: workspace
    })
    clearTerminalModePathScope()
    await inFlight
    expect(getTerminalModePathScopeRoots(store)).toEqual([])
  })

  it('revokes on a null declaration', async () => {
    const store = makeStore({})
    await grant(store, workspace)
    await applyTerminalModePathScope(store, null)
    expect(getTerminalModePathScopeRoots(store)).toEqual([])
  })
})

describe('terminal-mode scope revalidation', () => {
  it('contributes nothing once the flag is off', async () => {
    const store = makeStore({})
    await grant(store, workspace)
    const flagOff = makeStore({ terminalMode: false })
    expect(getTerminalModePathScopeRoots(flagOff)).toEqual([])
    expect(isTerminalModeGitRoot(workspace, flagOff)).toBe(false)
  })

  it('contributes nothing once the vertical tab is gone', async () => {
    const store = makeStore({})
    await grant(store, workspace)
    const closed = makeStore({ workspaces: [] })
    expect(getTerminalModePathScopeRoots(closed)).toEqual([])
  })
})

describe('filesystem-auth integration', () => {
  it('adds the scope root to the allow-list only in terminal mode', async () => {
    const store = makeStore({})
    expect(getAllowedRoots(store)).not.toContain(workspace)
    await grant(store, workspace)
    expect(getAllowedRoots(store)).toContain(workspace)
    expect(getAllowedRoots(makeStore({ terminalMode: false }))).not.toContain(workspace)
  })
})

describe('boundedRepoRoot', () => {
  it('accepts an ordinary project repository', () => {
    expect(boundedRepoRoot('/home/user/dev/orca', '/home/user')).toBe('/home/user/dev/orca')
  })

  it('refuses a repository that contains the home directory', () => {
    // A dotfiles repo at $HOME would otherwise turn one `cd` into read/write
    // authorization over the whole home directory plus the git mutation door.
    expect(boundedRepoRoot('/home/user', '/home/user')).toBeNull()
    expect(boundedRepoRoot('/home', '/home/user')).toBeNull()
  })

  it('refuses the filesystem root and relative paths', () => {
    expect(boundedRepoRoot('/', '/home/user')).toBeNull()
    expect(boundedRepoRoot('relative/repo', '/home/user')).toBeNull()
  })
})
