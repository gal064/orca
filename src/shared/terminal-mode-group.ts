import {
  LOCAL_EXECUTION_HOST_ID,
  getProjectGroupExecutionHostId,
  type ExecutionHostId
} from './execution-host'
import type { FolderWorkspace, ProjectGroup } from './types'

/**
 * Terminal-mode vertical tabs are folder workspaces parked under a reserved
 * project group (one per execution host) so no classic surface ever renders
 * them. The name is the marker: it survives persistence round-trips and the
 * remote `projectGroup.create` RPC without a schema change.
 */
export const TERMINAL_MODE_GROUP_NAME = '__terminal-mode__'

export type TerminalModeLocalContext = {
  projectGroup: ProjectGroup
  /** Start directory for a vtab with no pwd to inherit (docs/terminal-mode-spec.md §2). */
  homeDir: string
}

/**
 * The sentinel is load-bearing: a user group carrying it would disappear from
 * every classic surface with no UI path back, and terminal mode would adopt it.
 */
export function assertProjectGroupNameNotReserved(name: string): void {
  if (name.trim() === TERMINAL_MODE_GROUP_NAME) {
    throw new Error('project_group_name_reserved')
  }
}

export function isTerminalModeGroup(group: Pick<ProjectGroup, 'name'> | null | undefined): boolean {
  return group?.name === TERMINAL_MODE_GROUP_NAME
}

/** One hidden group per host: a vtab must be created where its ptys live. */
export function findTerminalModeGroupForHost<T extends ProjectGroup>(
  groups: readonly T[],
  hostId: ExecutionHostId
): T | undefined {
  return groups.find(
    (group) =>
      isTerminalModeGroup(group) &&
      getProjectGroupExecutionHostId(group, LOCAL_EXECUTION_HOST_ID) === hostId
  )
}

/** Ids of every terminal-mode group in a catalog — the filter key for classic surfaces. */
export function getTerminalModeGroupIds(
  groups: readonly Pick<ProjectGroup, 'id' | 'name'>[]
): Set<string> {
  const ids = new Set<string>()
  for (const group of groups) {
    if (isTerminalModeGroup(group)) {
      ids.add(group.id)
    }
  }
  return ids
}

/**
 * Classic surfaces (sidebar rows, pickers, dashboards) must never show vtabs, in
 * either mode. Returns the input array untouched when there is nothing to hide,
 * so memoized consumers keep their reference identity.
 */
export function excludeTerminalModeGroups<T extends Pick<ProjectGroup, 'name'>>(
  groups: readonly T[]
): readonly T[] {
  return groups.some((group) => isTerminalModeGroup(group))
    ? groups.filter((group) => !isTerminalModeGroup(group))
    : groups
}

export function excludeTerminalModeFolderWorkspaces<
  T extends Pick<FolderWorkspace, 'projectGroupId'>
>(
  folderWorkspaces: readonly T[],
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'name'>[]
): readonly T[] {
  const terminalModeGroupIds = getTerminalModeGroupIds(projectGroups)
  if (terminalModeGroupIds.size === 0) {
    return folderWorkspaces
  }
  return folderWorkspaces.filter((workspace) => !terminalModeGroupIds.has(workspace.projectGroupId))
}
