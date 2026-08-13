/**
 * TRIPWIRE — do not delete, do not weaken.
 *
 * Terminal-mode vertical tabs are ordinary folder workspaces living under a reserved
 * project group, in the SAME `projectGroups` / `folderWorkspaces` state classic UI
 * reads. They have to: the tab system, session persistence and execution-host
 * resolution all key off a folder workspace and its group. The price is that any
 * enumeration of those two arrays will render vertical tabs unless it goes through
 * the choke point in `store/classic-workspace-catalog.ts`.
 *
 * This repository regularly merges upstream release tags, and an upstream change that
 * adds a new enumeration — or reroutes an existing one back to the raw store — is a
 * silent leak: vertical tabs appear as workspaces in classic UI, or a project can be
 * moved into a group that no classic surface can show.
 *
 * So this file asserts the invariant against the REAL production functions of every
 * known classic enumeration surface, in both modes (the data outlives the experimental
 * flag). If you are here because this test failed after a merge, the fix is to route
 * the new/changed consumer through `selectClassicProjectGroups` /
 * `selectClassicFolderWorkspaces`, not to relax the assertion.
 */
import { describe, expect, it } from 'vitest'
import type { AppState } from './types'
import type { FolderWorkspace, ProjectGroup, Repo } from '../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../shared/terminal-mode-group'
import {
  selectClassicFolderWorkspaces,
  selectClassicProjectGroups,
  selectTerminalModeWorkspaceKeys
} from './classic-workspace-catalog'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from '@/components/sidebar/worktree-list-host-filtering'
import { searchCmdJProjectResults } from '@/components/cmd-j/palette-project-results'
import {
  buildNewWorkspaceCreateTargetOptions,
  findActionableFolderProjectGroup
} from '@/lib/new-workspace-project-options'
import { collectActiveDashboardWorkspaces } from '@/components/dashboard/dashboard-snapshot-workspaces'
import { resolveOriginalPaneTarget } from '@/components/right-sidebar/ai-vault-original-pane'
import { isKnownAiVaultResumeWorkspaceTarget } from '@/components/right-sidebar/ai-vault-session-resume'
import { findWorkspaceFileRoute } from '@/lib/runtime-workspace-file-route'

function group(id: string, name: string): ProjectGroup {
  return {
    id,
    name,
    parentPath: name === TERMINAL_MODE_GROUP_NAME ? null : '/home/dev',
    connectionId: null,
    executionHostId: 'local',
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function workspace(id: string, projectGroupId: string, folderPath?: string): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: folderPath ?? `/home/dev/${id}`,
    connectionId: null,
    executionHostId: 'local',
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

const catalog = { projectGroups: [HIDDEN, CLASSIC], folderWorkspaces: [VTAB, FOLDER] }

describe('the choke point', () => {
  it('excludes the terminal-mode group and its workspaces', () => {
    expect(selectClassicProjectGroups(catalog).map((entry) => entry.id)).toEqual(['classic'])
    expect(selectClassicFolderWorkspaces(catalog).map((entry) => entry.id)).toEqual(['folder'])
  })

  it('names the terminal-mode workspace keys for workspace-keyed surfaces', () => {
    expect([...selectTerminalModeWorkspaceKeys(catalog)]).toEqual(['folder:vtab'])
  })

  it('is a pass-through with no terminal-mode data, preserving array identity', () => {
    const classicOnly = { projectGroups: [CLASSIC], folderWorkspaces: [FOLDER] }
    expect(selectClassicProjectGroups(classicOnly)).toBe(classicOnly.projectGroups)
    expect(selectClassicFolderWorkspaces(classicOnly)).toBe(classicOnly.folderWorkspaces)
  })

  it('re-derives when the catalog changes rather than serving a stale cache', () => {
    const before = selectClassicFolderWorkspaces(catalog)
    const after = selectClassicFolderWorkspaces({
      projectGroups: catalog.projectGroups,
      folderWorkspaces: [VTAB, FOLDER, workspace('second', 'classic')]
    })
    expect(before.map((entry) => entry.id)).toEqual(['folder'])
    expect(after.map((entry) => entry.id)).toEqual(['folder', 'second'])
  })
})

describe('classic enumeration surfaces never see a vertical tab', () => {
  /**
   * These call functions that read the catalog out of `AppState` THEMSELVES, so a
   * consumer reverted to a raw `s.projectGroups` / `s.folderWorkspaces` read fails
   * here. Tests that pre-filter the catalog and hand it in would pass either way and
   * are worthless as tripwires — do not add any.
   */
  it('the workspace file-route owner list', () => {
    // A vertical tab roots at $HOME, so an unfiltered read makes it the longest-match
    // owner for every file the user opens outside a real workspace.
    const state = {
      projectGroups: [HIDDEN, CLASSIC],
      folderWorkspaces: [workspace('home-vtab', 'hidden', '/home/dev'), FOLDER],
      worktreesByRepo: {},
      repos: [],
      settings: null,
      runtimeEnvironments: []
    } as unknown as AppState

    const owner = findWorkspaceFileRoute(state, 'local', '/home/dev/notes/todo.md')
    expect(owner?.worktreeId).not.toBe('folder:home-vtab')
  })

  it('the sidebar host filters pass classic data straight through', () => {
    const groups = selectClassicProjectGroups(catalog)
    const workspaces = selectClassicFolderWorkspaces(catalog)
    for (const hostFilter of [null, new Set<'local'>(['local'])]) {
      expect(filterProjectGroupsForVisibleHosts(groups, hostFilter, 'local')).not.toContain(HIDDEN)
      expect(
        filterFolderWorkspacesForVisibleHosts(workspaces, groups, hostFilter, 'local')
      ).not.toContain(VTAB)
    }
  })

  it('the Cmd+J palette and the new-workspace picker reject a hidden group they are handed', () => {
    // Their callers filter, but these assert the group could not render even if one leaked.
    expect(
      searchCmdJProjectResults({
        query: 'terminal',
        projectGroups: selectClassicProjectGroups(catalog),
        repos: [],
        projects: [],
        projectHostSetups: []
      }).some((result) => result.id === 'project-group:hidden')
    ).toBe(false)
    expect(
      buildNewWorkspaceCreateTargetOptions({
        projectGroups: selectClassicProjectGroups(catalog),
        eligibleRepos: [] as Repo[],
        projects: [],
        projectHostSetups: []
      }).map((option) => option.displayName)
    ).toEqual(['Work'])
    expect(
      findActionableFolderProjectGroup({
        projectGroups: selectClassicProjectGroups(catalog),
        groupId: 'hidden',
        actionableHostIds: new Set(['local'])
      })
    ).toBeNull()
  })

  it('the dashboard / kanban / agent-map card list', () => {
    const state = { repos: [], worktreesByRepo: {}, ...catalog } as unknown as AppState
    expect(collectActiveDashboardWorkspaces(state).map((entry) => entry.worktree.id)).toEqual([
      'folder:folder'
    ])
  })

  it('the AI Vault original-pane jump target', () => {
    const state = {
      ...catalog,
      agentStatusByPaneKey: {},
      retainedAgentsByPaneKey: {},
      sleepingAgentSessionsByPaneKey: {},
      tabsByWorktree: { 'folder:vtab': [{ id: 'tab-1' }] },
      terminalLayoutsByTabId: {}
    } as unknown as AppState

    expect(
      resolveOriginalPaneTarget({ state, paneKey: 'tab-1', worktreeIdHint: 'folder:vtab' })
    ).toBeNull()
  })

  it('the AI Vault resume target', () => {
    const targetState = { ...catalog, repos: [], worktreesByRepo: {} } as unknown as AppState
    expect(isKnownAiVaultResumeWorkspaceTarget(targetState, 'folder:vtab')).toBe(false)
    expect(isKnownAiVaultResumeWorkspaceTarget(targetState, 'folder:folder')).toBe(true)
  })
})
