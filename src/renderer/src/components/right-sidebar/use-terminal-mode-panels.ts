import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  selectTerminalModePanelRoot,
  selectTerminalModePanelScopeForWorkspace,
  type TerminalModePanelScope
} from '@/store/slices/terminal-mode-panels'
import {
  buildTerminalModeGitWorkspace,
  type TerminalModeGitWorkspace
} from './terminal-mode-git-workspace'

/** Explorer root for the workspace in terminal mode; null means classic behavior. */
export function useTerminalModePanelRoot(workspaceKey: string | null | undefined): string | null {
  return useAppStore((s) => selectTerminalModePanelRoot(s, workspaceKey))
}

function useScopeForWorkspace(
  workspaceKey: string | null | undefined
): TerminalModePanelScope | null {
  return useAppStore((s) => selectTerminalModePanelScopeForWorkspace(s, workspaceKey))
}

/**
 * True when the explorer root had to be clamped to the tab's start folder because
 * the remote host cannot address paths outside it.
 */
export function useTerminalModePanelClamped(workspaceKey: string | null | undefined): boolean {
  return useScopeForWorkspace(workspaceKey)?.clampedToWorkspaceRoot === true
}

/**
 * Worktree/repo pair Source Control and the git-status poller should use in
 * terminal mode, or null when terminal mode does not own this workspace's panel.
 */
export function useTerminalModeGitWorkspace(
  workspaceKey: string | null | undefined
): TerminalModeGitWorkspace | null {
  const scope = useScopeForWorkspace(workspaceKey)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  return useMemo(() => {
    if (!scope) {
      return null
    }
    const parsed = parseWorkspaceKey(scope.workspaceKey)
    if (parsed?.type !== 'folder') {
      return null
    }
    const folderWorkspace = folderWorkspaces.find(
      (candidate) => candidate.id === parsed.folderWorkspaceId
    )
    return folderWorkspace ? buildTerminalModeGitWorkspace(folderWorkspace, scope.repoRoot) : null
  }, [folderWorkspaces, scope])
}
