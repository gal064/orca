/**
 * TRIPWIRE — host-side half of `renderer/src/store/terminal-mode-isolation.test.ts`.
 *
 * Terminal-mode vertical tabs live in the same catalogs the host publishes to the CLI
 * and to paired/remote clients. A client older than terminal mode has no exclusion of
 * its own, so anything this host lists reaches it verbatim — and the workspace keys it
 * receives are accepted selectors for rename/delete.
 *
 * Covered here by invoking the real method: `projectGroup.list`, `folderWorkspace.list`.
 * Filtered in production but NOT covered here, because they need far more runtime state
 * than a stub `this` can supply — if you touch them, verify by hand:
 * `getWorktreePs`, `listAllMobileSessionTabs`, `listTerminals`.
 * Known still-unfiltered (Phase 4, all keyed by workspace and low-traffic):
 * cross-workspace file-owner resolution, `worktree.lineageList`, notification fan-out.
 *
 * Phase 4 (remote vertical tabs) is expected to replace the `listProjectGroups` /
 * `listFolderWorkspaces` filters with a capability-gated pass-through — at which point
 * this file must be updated deliberately, not deleted.
 */
import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../shared/types'
import {
  TERMINAL_MODE_GROUP_NAME,
  excludeTerminalModeFolderWorkspaces,
  excludeTerminalModeGroups
} from '../../shared/terminal-mode-group'

function group(id: string, name: string): ProjectGroup {
  return {
    id,
    name,
    parentPath: name === TERMINAL_MODE_GROUP_NAME ? null : '/home/dev',
    connectionId: null,
    executionHostId: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function workspace(id: string, projectGroupId: string): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: `/home/dev/${id}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
}

const HIDDEN = group('hidden', TERMINAL_MODE_GROUP_NAME)
const CLASSIC = group('classic', 'Work')
const VTAB = workspace('vtab', 'hidden')
const FOLDER = workspace('folder', 'classic')
const store = {
  getProjectGroups: () => [HIDDEN, CLASSIC],
  getFolderWorkspaces: () => [VTAB, FOLDER]
}

describe('host catalogs published to the CLI and paired clients', () => {
  it('projectGroup.list excludes the terminal-mode group', async () => {
    const { OrcaRuntimeService } = await import('./orca-runtime')
    const listProjectGroups = OrcaRuntimeService.prototype.listProjectGroups
    expect(listProjectGroups.call({ store } as never).map((entry) => entry.id)).toEqual(['classic'])
  })

  it('folderWorkspace.list excludes vertical tabs', async () => {
    const { OrcaRuntimeService } = await import('./orca-runtime')
    const listFolderWorkspaces = OrcaRuntimeService.prototype.listFolderWorkspaces
    expect(listFolderWorkspaces.call({ store } as never).map((entry) => entry.id)).toEqual([
      'folder'
    ])
  })

  it('the exclusion predicate every host-side filter shares', () => {
    // The uncovered host filters above are inline; this pins the predicate they use.
    expect(excludeTerminalModeGroups([HIDDEN, CLASSIC])).toEqual([CLASSIC])
    expect(excludeTerminalModeFolderWorkspaces([VTAB, FOLDER], [HIDDEN, CLASSIC])).toEqual([FOLDER])
  })
})
