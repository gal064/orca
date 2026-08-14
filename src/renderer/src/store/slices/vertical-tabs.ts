import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import {
  LOCAL_EXECUTION_HOST_ID,
  getProjectGroupExecutionHostId,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getRuntimePathBasename } from '../../../../shared/cross-platform-path'
import { getTerminalModeGroupIds } from '../../../../shared/terminal-mode-group'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { getActivePwdForVtab } from './terminal-cwd'
import { translate } from '@/i18n/i18n'
import { isTerminalMode } from '@/lib/terminal-mode'
import { getTerminalModeHostRoute, resolveNewVerticalTabHostId } from '@/lib/terminal-mode-hosts'
import { ensureTerminalModeHostContext } from '../terminal-mode-host-context'
import { selectTerminalModeHostOptions } from '@/lib/terminal-mode-host-options'

const NO_VERTICAL_TABS: readonly FolderWorkspace[] = Object.freeze([])

/**
 * Vertical tabs render oldest-first so a new tab appends to the end of the strip,
 * the way a terminal emulator behaves. Drag-reorder (`manualOrder`) is Phase 5.
 */
export function selectVerticalTabs(
  folderWorkspaces: readonly FolderWorkspace[] | undefined,
  projectGroups: readonly ProjectGroup[] | undefined
): readonly FolderWorkspace[] {
  const groupIds = getTerminalModeGroupIds(projectGroups ?? [])
  if (groupIds.size === 0) {
    return NO_VERTICAL_TABS
  }
  // Why no isArchived filter: nothing in terminal mode can archive a vtab, and one
  // that somehow was would be invisible *and* unclosable.
  const tabs = (folderWorkspaces ?? []).filter((workspace) =>
    groupIds.has(workspace.projectGroupId)
  )
  return tabs.length === 0
    ? NO_VERTICAL_TABS
    : tabs.sort(
        (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
      )
}

/** The tab to focus once `closedId` is gone: its right-hand neighbour, else its left. */
export function pickNextVerticalTabId(
  tabs: readonly FolderWorkspace[],
  closedId: string
): string | null {
  const index = tabs.findIndex((tab) => tab.id === closedId)
  if (index === -1) {
    return null
  }
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null
}

/** Which vertical tab the active workspace key points at, if any. */
export function resolveActiveVerticalTabId(
  activeWorkspaceKey: string | null | undefined,
  tabs: readonly FolderWorkspace[]
): string | null {
  const scope = activeWorkspaceKey ? parseWorkspaceKey(activeWorkspaceKey) : null
  if (scope?.type !== 'folder') {
    return null
  }
  return tabs.some((tab) => tab.id === scope.folderWorkspaceId) ? scope.folderWorkspaceId : null
}

export function getVerticalTabAutoName(folderPath: string): string {
  return getRuntimePathBasename(folderPath) || folderPath
}

type VerticalTabHostState = Pick<AppState, 'folderWorkspaces' | 'projectGroups'>

/**
 * A vertical tab's execution host is its hidden group's, never a path heuristic
 * (docs/terminal-mode-design.md Phase 1 notes) — the owner the catalog fetch stamped
 * on the workspace wins, and the group answers for a tab this client created before
 * its host's catalog came back. Local for an unknown tab, so every caller has a host
 * to route with.
 */
export function getVerticalTabHostId(
  state: VerticalTabHostState,
  folderWorkspaceId: string
): ExecutionHostId {
  const workspace = state.folderWorkspaces.find((candidate) => candidate.id === folderWorkspaceId)
  if (!workspace) {
    return LOCAL_EXECUTION_HOST_ID
  }
  const explicitHostId = normalizeExecutionHostId(workspace.executionHostId)
  if (explicitHostId) {
    return explicitHostId
  }
  const group = state.projectGroups.find((entry) => entry.id === workspace.projectGroupId)
  return group
    ? getProjectGroupExecutionHostId(group, LOCAL_EXECUTION_HOST_ID)
    : LOCAL_EXECUTION_HOST_ID
}

/** Host of the active vertical tab, or null when the active workspace is not one. */
export function getActiveVerticalTabHostId(
  state: VerticalTabHostState & Pick<AppState, 'activeWorkspaceKey'>
): ExecutionHostId | null {
  const tabs = selectVerticalTabs(state.folderWorkspaces, state.projectGroups)
  const activeId = resolveActiveVerticalTabId(state.activeWorkspaceKey, tabs)
  return activeId ? getVerticalTabHostId(state, activeId) : null
}

export type VerticalTabsSlice = {
  /** Folder-workspace id awaiting the close confirmation dialog. */
  verticalTabPendingCloseId: string | null
  /**
   * Called by the tab system when a user close empties a workspace. A no-op unless
   * terminal mode is on and the workspace is a vertical tab.
   */
  closeVerticalTabIfEmptied: (workspaceKey: string, options?: { wasActive?: boolean }) => void
  createVerticalTab: (options?: {
    startDir?: string
    /** Explicit pick from the "+" dropdown; omitted means inherit, then the default-host setting. */
    hostId?: ExecutionHostId | null
  }) => Promise<string | null>
  activateVerticalTab: (folderWorkspaceId: string) => void
  renameVerticalTab: (folderWorkspaceId: string, name: string) => Promise<void>
  requestVerticalTabClose: (folderWorkspaceId: string | null) => void
  closeVerticalTab: (folderWorkspaceId: string, options?: { wasActive?: boolean }) => Promise<void>
}

export const createVerticalTabsSlice: StateCreator<AppState, [], [], VerticalTabsSlice> = (
  set,
  get
) => ({
  verticalTabPendingCloseId: null,

  closeVerticalTabIfEmptied: (workspaceKey, options) => {
    const state = get()
    if (!isTerminalMode(state.settings)) {
      return
    }
    const scope = parseWorkspaceKey(workspaceKey)
    if (scope?.type !== 'folder') {
      return
    }
    const tabs = selectVerticalTabs(state.folderWorkspaces, state.projectGroups)
    if (!tabs.some((tab) => tab.id === scope.folderWorkspaceId)) {
      return
    }
    // Why the caller decides: by the time this runs the tab system has already dropped
    // the active workspace, so only it knows whether the closed tab was focused.
    const wasActive = options?.wasActive ?? state.activeWorkspaceKey === workspaceKey
    // Why deferred: this runs at the tail of the tab-close cascade, and deleting the
    // workspace re-enters the store while that cascade's callers are still unwinding.
    queueMicrotask(() => {
      void get().closeVerticalTab(scope.folderWorkspaceId, { wasActive })
    })
  },

  createVerticalTab: async (options) => {
    try {
      const state = get()
      const inheritedHostId = getActiveVerticalTabHostId(state)
      const hostId = resolveNewVerticalTabHostId({
        requestedHostId: options?.hostId ?? null,
        inheritedHostId,
        defaultHostId: state.settings?.terminalModeDefaultHost ?? null,
        availableHosts: selectTerminalModeHostOptions(state)
      })
      const context = await ensureTerminalModeHostContext(hostId)
      const route = getTerminalModeHostRoute(hostId)
      // Why the owner is stamped here: the group was created on `hostId`, but the
      // renderer catalog has not fetched it yet, and every host resolution for the
      // new workspace reads it from this record.
      const projectGroup = { ...context.projectGroup, executionHostId: hostId }
      set((current) =>
        current.projectGroups.some((group) => group.id === projectGroup.id)
          ? {
              projectGroups: current.projectGroups.map((group) =>
                group.id === projectGroup.id ? projectGroup : group
              )
            }
          : { projectGroups: [...current.projectGroups, projectGroup] }
      )
      // Ghostty-style inheritance: a new tab opens where the focused terminal is —
      // but only when it runs on the same host, since a pwd is a path on one machine.
      const focusedPwd =
        inheritedHostId === hostId && state.activeWorkspaceKey
          ? getActivePwdForVtab(state, state.activeWorkspaceKey)
          : null
      const startDir = options?.startDir?.trim() || focusedPwd?.trim() || context.homeDir
      const workspace = await get().createFolderWorkspace(
        {
          projectGroupId: projectGroup.id,
          name: getVerticalTabAutoName(startDir),
          folderPath: startDir,
          connectionId: route.kind === 'ssh' ? route.connectionId : null
        },
        // Why explicit: creation otherwise follows whichever runtime happens to be
        // focused, and the hidden group we just ensured lives on `hostId`.
        { runtimeEnvironmentId: route.kind === 'runtime' ? route.environmentId : null }
      )
      if (!workspace) {
        return null
      }
      // The first terminal spawns from the activation path itself; do not create one here.
      get().activateVerticalTab(workspace.id)
      return workspace.id
    } catch (err) {
      toast.error(
        translate('auto.store.slices.verticalTabs.createFailed', 'Failed to create terminal tab'),
        { description: err instanceof Error ? err.message : undefined }
      )
      return null
    }
  },

  activateVerticalTab: (folderWorkspaceId) => {
    get().setActiveView('terminal')
    // Why the resolved host: `findKnownWorktreeById` disambiguates by execution host,
    // so a remote tab activated as local silently does nothing.
    get().setActiveFolderWorkspace(
      folderWorkspaceId,
      getVerticalTabHostId(get(), folderWorkspaceId)
    )
  },

  renameVerticalTab: async (folderWorkspaceId, name) => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    // terminalModeAutoName pins the title so pwd auto-titling stops (Phase 3).
    const renamed = await get().updateFolderWorkspace(folderWorkspaceId, {
      name: trimmed,
      terminalModeAutoName: false
    })
    if (!renamed) {
      // Why throw: the inline editor only surfaces a failure it can catch, and a
      // silently reverted rename looks like the app ignored the user.
      throw new Error(
        translate('auto.store.slices.verticalTabs.renameFailed', 'Failed to rename terminal tab')
      )
    }
  },

  requestVerticalTabClose: (folderWorkspaceId) => {
    // Why it always asks: closing a vertical tab *deletes the folder workspace* and
    // kills every process in it — irreversible, and one key away from Ctrl+W. The
    // "confirmations stop being read" argument is for reversible actions. What Phase 5
    // adds is not a skip but an answer to "what dies": the dialog names the agents
    // (spec §4, "lists the running agent(s) it would kill"), and a build or a `top`
    // still gets its prompt because the dialog never claims the list is exhaustive.
    set({ verticalTabPendingCloseId: folderWorkspaceId })
  },

  closeVerticalTab: async (folderWorkspaceId, options) => {
    const state = get()
    const tabs = selectVerticalTabs(state.folderWorkspaces, state.projectGroups)
    // Why the caller may override: the last-htab path already dropped the active
    // workspace by the time this runs, so only it knows the tab was focused.
    const wasActive =
      options?.wasActive ?? state.activeWorkspaceKey === folderWorkspaceKey(folderWorkspaceId)
    const nextTabId = pickNextVerticalTabId(tabs, folderWorkspaceId)
    set((current) =>
      current.verticalTabPendingCloseId === folderWorkspaceId
        ? { verticalTabPendingCloseId: null }
        : current
    )
    const deleted = await get().deleteFolderWorkspace(folderWorkspaceId)
    if (!deleted) {
      // Why re-activate: the workspace kept its (now empty) tab record, and the
      // activation path is what re-spawns a terminal for an empty workspace.
      if (wasActive) {
        get().activateVerticalTab(folderWorkspaceId)
      }
      return
    }
    if (!wasActive) {
      return
    }
    if (nextTabId) {
      get().activateVerticalTab(nextTabId)
      return
    }
    // Why guard: the tab system already lands on null when its last htab closed.
    if (get().activeWorkspaceKey === folderWorkspaceKey(folderWorkspaceId)) {
      get().setActiveWorktree(null)
    }
  }
})
