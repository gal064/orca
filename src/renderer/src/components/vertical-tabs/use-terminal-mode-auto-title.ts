import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { getActivePwdForVtab } from '@/store/slices/terminal-cwd'
import { useVerticalTabs } from './use-vertical-tabs'
import { collectVerticalTabNamePersists } from './terminal-mode-auto-title'

/** Slow on purpose: the display name already tracks `cd` live, so the write only
 *  has to carry the name across a restart. */
export const AUTO_TITLE_PERSIST_DEBOUNCE_MS = 10_000

/** Live pwd per vertical tab — undebounced, because a tab strip label may flicker
 *  where a re-rooted panel may not. */
export function useVerticalTabPwds(): Record<string, string | null> {
  const tabs = useVerticalTabs()
  const cwdByPtyId = useAppStore((s) => s.cwdByPtyId)
  const activeTabIdByWorktree = useAppStore((s) => s.activeTabIdByWorktree)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const unifiedTabsByWorktree = useAppStore((s) => s.unifiedTabsByWorktree)
  const lastTerminalTabIdByWorkspace = useAppStore((s) => s.lastTerminalTabIdByWorkspace)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  return useMemo(() => {
    const state: Parameters<typeof getActivePwdForVtab>[0] = {
      cwdByPtyId,
      activeTabIdByWorktree,
      ptyIdsByTabId,
      terminalLayoutsByTabId,
      unifiedTabsByWorktree,
      lastTerminalTabIdByWorkspace,
      folderWorkspaces
    }
    const pwds: Record<string, string | null> = {}
    for (const tab of tabs) {
      pwds[tab.id] = getActivePwdForVtab(state, folderWorkspaceKey(tab.id))
    }
    return pwds
  }, [
    activeTabIdByWorktree,
    cwdByPtyId,
    folderWorkspaces,
    ptyIdsByTabId,
    tabs,
    lastTerminalTabIdByWorkspace,
    terminalLayoutsByTabId,
    unifiedTabsByWorktree
  ])
}

/**
 * Persists auto-titles on a slow debounce so a restart shows the directory each
 * tab was last in, without writing the store once per shell prompt.
 */
export function useTerminalModeAutoTitlePersistence(): void {
  const tabs = useVerticalTabs()
  const pwdByTabId = useVerticalTabPwds()
  const updateFolderWorkspace = useAppStore((s: AppState) => s.updateFolderWorkspace)
  const updates = useMemo(
    () => collectVerticalTabNamePersists(tabs, pwdByTabId),
    [pwdByTabId, tabs]
  )
  // Why a value key: `cwdByPtyId` gets a new identity on every OSC 7 emit in every
  // terminal, so a debounce keyed on it is reset by unrelated churn and never
  // fires. The debounce must be driven by the value that would be written.
  const pendingKey = updates.map((update) => `${update.id}\0${update.name}`).join('|')
  const pendingRef = useRef(updates)

  useEffect(() => {
    pendingRef.current = updates
  }, [updates])

  useEffect(() => {
    if (updates.length === 0) {
      return
    }
    const timer = setTimeout(() => {
      for (const update of pendingRef.current) {
        // Why fire-and-forget: a failed rename only costs the restart label, and
        // surfacing a toast for a background write would be noise.
        void updateFolderWorkspace(update.id, { name: update.name })
      }
    }, AUTO_TITLE_PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value to
    // be written, not on the object identity that churns with every shell prompt.
  }, [pendingKey, updateFolderWorkspace])
}
