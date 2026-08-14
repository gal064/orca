/**
 * The MUST requirement's unit half (docs/terminal-mode-spec.md §2, "Persistence"):
 * a vertical tab pinned to an `orca serve` host must persist its session under that
 * host's partition and survive back into the store on the next launch, before any
 * remote catalog has loaded. Everything here runs on the real production functions.
 */
import { describe, expect, it } from 'vitest'
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { buildHostIdByWorktreeId } from '@/lib/workspace-session-host-persistence'
import {
  collectFolderWorkspaceKeysFromSession,
  collectWorktreeHydrationRepoIdsFromSession
} from '@/lib/workspace-session-hydration-keys'
import { getActiveVerticalTabHostId, getVerticalTabHostId } from './vertical-tabs'

const REMOTE_HOST = 'runtime:env-1'
const VTAB_KEY = folderWorkspaceKey('vtab-remote')

const remoteGroup = {
  id: 'hidden-remote',
  name: TERMINAL_MODE_GROUP_NAME,
  connectionId: null,
  executionHostId: REMOTE_HOST
}
const localGroup = {
  id: 'hidden-local',
  name: TERMINAL_MODE_GROUP_NAME,
  connectionId: null,
  executionHostId: 'local'
}
const remoteVtab = {
  id: 'vtab-remote',
  projectGroupId: 'hidden-remote',
  folderPath: '/home/host/work',
  executionHostId: REMOTE_HOST
}
const localVtab = {
  id: 'vtab-local',
  projectGroupId: 'hidden-local',
  folderPath: '/home/me',
  executionHostId: null
}

const state = {
  folderWorkspaces: [remoteVtab, localVtab],
  projectGroups: [remoteGroup, localGroup]
} as never

describe('a vertical tab resolves the host its terminals live on', () => {
  it('reads the host from the tab, never from a path heuristic', () => {
    expect(getVerticalTabHostId(state, 'vtab-remote')).toBe(REMOTE_HOST)
    expect(getVerticalTabHostId(state, 'vtab-local')).toBe('local')
  })

  it('answers local for a tab the catalog does not know', () => {
    expect(getVerticalTabHostId(state, 'missing')).toBe('local')
  })

  it('resolves the active tab’s host, and null when the active workspace is classic', () => {
    expect(
      getActiveVerticalTabHostId({ ...(state as object), activeWorkspaceKey: VTAB_KEY } as never)
    ).toBe(REMOTE_HOST)
    expect(
      getActiveVerticalTabHostId({
        ...(state as object),
        activeWorkspaceKey: 'worktree:repo::/w'
      } as never)
    ).toBeNull()
  })
})

describe('session persistence partitions a remote vertical tab under its host', () => {
  it('writes the remote tab to the runtime partition and the local one to local', () => {
    const owner = buildHostIdByWorktreeId({
      repos: [],
      worktreesByRepo: {},
      folderWorkspaces: [remoteVtab, localVtab],
      projectGroups: [remoteGroup, localGroup]
    } as never)
    expect(owner(VTAB_KEY)).toBe(REMOTE_HOST)
    expect(owner(folderWorkspaceKey('vtab-local'))).toBe('local')
  })

  it('keeps the restored owner while the remote catalog has not loaded yet', () => {
    // At launch the remote group/workspace are still being fetched; without this the
    // tab's session would be rewritten into the local partition and lost to the host.
    const owner = buildHostIdByWorktreeId({
      repos: [],
      worktreesByRepo: {},
      folderWorkspaces: [],
      projectGroups: [],
      restoredRuntimeHostIdByWorkspaceSessionKey: { [VTAB_KEY]: REMOTE_HOST }
    } as never)
    expect(owner(VTAB_KEY)).toBe(REMOTE_HOST)
  })
})

describe('startup hydration keeps a remote vertical tab’s tabs', () => {
  const session = {
    tabsByWorktree: {
      [VTAB_KEY]: [{ id: 'tab-1', ptyId: 'remote:env-1:handle', sortOrder: 0, createdAt: 1 }]
    },
    unifiedTabs: { [VTAB_KEY]: [] },
    remoteSessionIdsByTabId: {},
    activeWorkspaceKey: VTAB_KEY
  } as never

  it('collects the remote tab’s workspace key as an additional valid key', () => {
    // hydrateWorkspaceSession only keeps tabs whose workspace key is valid, and at
    // launch `state.folderWorkspaces` holds local tabs only.
    expect(collectFolderWorkspaceKeysFromSession(session)).toContain(VTAB_KEY)
  })

  it('never asks the worktree hydration path to fetch a repo for a vertical tab', () => {
    expect(collectWorktreeHydrationRepoIdsFromSession(session)).toEqual([])
  })
})
