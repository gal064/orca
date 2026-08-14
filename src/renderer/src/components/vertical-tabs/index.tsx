import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { useTerminalModeHostOptions } from './use-terminal-mode-host-options'
import { getVerticalTabHostId } from '@/store/slices/vertical-tabs'
import NewVerticalTabButton from './NewVerticalTabButton'
import VerticalTabsAgentsEntry from './VerticalTabsAgentsEntry'
import VerticalTabRow from './VerticalTabRow'
import { useVerticalTabStatuses } from './use-vertical-tab-statuses'
import { useActiveVerticalTabId, useVerticalTabs } from './use-vertical-tabs'
import { useActiveVerticalTabPwd } from './use-active-vertical-tab-pwd'
import { useVerticalTabPwds } from './use-terminal-mode-auto-title'
import { resolveVerticalTabDisplayName } from './terminal-mode-auto-title'

/**
 * Terminal-mode left sidebar: the vertical tab strip (docs/terminal-mode-design.md
 * Phase 1). Mounted only while the sidebar is open — anything that must survive a
 * collapsed sidebar lives in TerminalModeSidebarHost instead.
 */
function VerticalTabsSidebar(): React.JSX.Element {
  // Why: this memo boundary needs its own language subscription — the persisted
  // locale lands after boot, and nothing else re-renders this subtree.
  useTranslation()
  const tabs = useVerticalTabs()
  const activeTabId = useActiveVerticalTabId()
  // Working directory the panels follow (Phase 3); shown here so the strip
  // states which terminal directory is in scope.
  const activePwd = useActiveVerticalTabPwd()
  // Auto-title: a tab is named after its focused terminal's directory until renamed.
  const pwdByTabId = useVerticalTabPwds()
  const activateVerticalTab = useAppStore((s) => s.activateVerticalTab)
  const createVerticalTab = useAppStore((s) => s.createVerticalTab)
  const handleCreateFirstTab = useCallback(() => {
    void createVerticalTab()
  }, [createVerticalTab])
  const renameVerticalTab = useAppStore((s) => s.renameVerticalTab)
  const requestVerticalTabClose = useAppStore((s) => s.requestVerticalTabClose)

  // Host badge: only meaningful once more than one host exists, and the label has
  // to come from the same registry the picker uses so the two never disagree.
  const hosts = useTerminalModeHostOptions()
  const hostLabelById = useMemo(
    () => (hosts.length > 1 ? new Map(hosts.map((host) => [host.id, host.label])) : null),
    [hosts]
  )
  const statusByWorkspaceKey = useVerticalTabStatuses(tabs)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const hostLabelByTabId = useMemo(() => {
    if (!hostLabelById) {
      return {}
    }
    const labels: Record<string, string> = {}
    for (const tab of tabs) {
      const hostId = getVerticalTabHostId({ folderWorkspaces, projectGroups }, tab.id)
      const label = hostId === LOCAL_EXECUTION_HOST_ID ? null : hostLabelById.get(hostId)
      if (label) {
        labels[tab.id] = label
      }
    }
    return labels
  }, [folderWorkspaces, hostLabelById, projectGroups, tabs])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="vertical-tabs-sidebar">
      <div className="mt-2 flex h-8 shrink-0 items-center justify-between gap-2 px-2">
        <span className="pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80 select-none">
          {translate('auto.components.verticalTabs.VerticalTabsSidebar.title', 'Terminals')}
        </span>
        <NewVerticalTabButton />
      </div>

      {activePwd ? (
        <div
          className="truncate px-4 pb-1 text-[11px] text-muted-foreground select-none"
          data-testid="vtab-active-pwd"
          title={activePwd}
        >
          {activePwd}
        </div>
      ) : null}

      <div
        className="worktree-sidebar-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1"
        data-testid="vertical-tabs-list"
      >
        {tabs.length === 0 ? (
          // Why a button and not a label: an empty strip is the one state where the
          // user has nothing to click, and the "+" is a 14px target in the header.
          <button
            type="button"
            className="mx-2 rounded-md px-2 py-6 text-center text-xs text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground"
            data-testid="vertical-tabs-empty-create"
            onClick={handleCreateFirstTab}
          >
            {translate(
              'auto.components.verticalTabs.VerticalTabsSidebar.emptyAction',
              'No terminal tabs — create one'
            )}
          </button>
        ) : (
          tabs.map((tab) => (
            <VerticalTabRow
              key={tab.id}
              id={tab.id}
              name={resolveVerticalTabDisplayName(tab, pwdByTabId[tab.id])}
              folderPath={tab.folderPath}
              hostLabel={hostLabelByTabId[tab.id]}
              status={statusByWorkspaceKey.get(folderWorkspaceKey(tab.id)) ?? 'inactive'}
              active={tab.id === activeTabId}
              onActivate={activateVerticalTab}
              onRename={renameVerticalTab}
              onRequestClose={requestVerticalTabClose}
            />
          ))
        )}
      </div>

      <div className="shrink-0 pb-2">
        <VerticalTabsAgentsEntry />
      </div>
    </div>
  )
}

export default React.memo(VerticalTabsSidebar)
