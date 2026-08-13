import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { getRuntimePathBasename } from '../../../../shared/cross-platform-path'
import { getTerminalModeGroupIds } from '../../../../shared/terminal-mode-group'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { translate } from '@/i18n/i18n'
import { isTerminalMode } from '@/lib/terminal-mode'

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

export type VerticalTabsSlice = {
  /** Folder-workspace id awaiting the close confirmation dialog. */
  verticalTabPendingCloseId: string | null
  /**
   * Called by the tab system when a user close empties a workspace. A no-op unless
   * terminal mode is on and the workspace is a vertical tab.
   */
  closeVerticalTabIfEmptied: (workspaceKey: string, options?: { wasActive?: boolean }) => void
  createVerticalTab: (options?: { startDir?: string }) => Promise<string | null>
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
      if (!window.api.terminalMode?.ensureLocalContext) {
        // Paired web clients have no local host to create a vertical tab on.
        throw new Error(
          translate(
            'auto.store.slices.verticalTabs.unsupportedHost',
            'Terminal tabs are only available on the desktop app.'
          )
        )
      }
      const context = await window.api.terminalMode.ensureLocalContext()
      // Why: the group is created lazily on the host, so the renderer catalog has
      // not seen it yet and createFolderWorkspace resolves its owner from there.
      set((state) =>
        state.projectGroups.some((group) => group.id === context.projectGroup.id)
          ? state
          : { projectGroups: [...state.projectGroups, context.projectGroup] }
      )
      const startDir = options?.startDir?.trim() || context.homeDir
      const workspace = await get().createFolderWorkspace(
        {
          projectGroupId: context.projectGroup.id,
          name: getVerticalTabAutoName(startDir),
          folderPath: startDir,
          connectionId: null
        },
        // Why explicit: creation otherwise follows the focused runtime host, and the
        // hidden group we just ensured is local. Remote vtabs arrive in Phase 4.
        { runtimeEnvironmentId: null }
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
    get().setActiveFolderWorkspace(folderWorkspaceId, LOCAL_EXECUTION_HOST_ID)
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
