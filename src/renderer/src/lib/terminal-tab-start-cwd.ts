import type { TerminalTab } from '../../../shared/types'

/**
 * Directory a tab's shell opens in: terminal mode's restored pwd
 * (terminal-mode-spec.md §4) when the tab has one, else whatever the caller
 * already resolved. Read from a store snapshot at mount — the `cwd` prop is a
 * dependency of the effect that owns the PaneManager.
 */
export function resolveMountedTabStartCwd(
  tabsByWorktree: Record<string, readonly Pick<TerminalTab, 'id' | 'lastCwd'>[]>,
  worktreeId: string,
  tabId: string,
  fallbackCwd: string
): string {
  const tab = tabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId)
  return tab?.lastCwd?.trim() || fallbackCwd
}
