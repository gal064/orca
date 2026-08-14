// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { TERMINAL_MODE_GROUP_NAME } from '../../../../shared/terminal-mode-group'
import VerticalTabsSidebar from './index'
import TerminalModeSidebarHost from './TerminalModeSidebarHost'

const hidden: ProjectGroup = {
  id: 'hidden',
  name: TERMINAL_MODE_GROUP_NAME,
  parentPath: '/home/dev',
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

function vtab(id: string, createdAt: number): FolderWorkspace {
  return {
    id,
    projectGroupId: 'hidden',
    name: id,
    folderPath: `/home/dev/${id}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt,
    updatedAt: createdAt
  }
}

function renderSidebar(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <VerticalTabsSidebar />
    </TooltipProvider>
  )
}

// Why captured up front: several tests swap these for spies via `setState`, and zustand
// has no "restore" — without this the next test drives the previous test's mock.
const realActions = {
  requestVerticalTabClose: useAppStore.getState().requestVerticalTabClose,
  createVerticalTab: useAppStore.getState().createVerticalTab,
  closeVerticalTab: useAppStore.getState().closeVerticalTab,
  activateVerticalTab: useAppStore.getState().activateVerticalTab,
  settings: useAppStore.getState().settings
}

afterEach(() => {
  cleanup()
  useAppStore.setState({
    ...realActions,
    folderWorkspaces: [],
    projectGroups: [],
    activeWorkspaceKey: null,
    verticalTabPendingCloseId: null,
    activeTabIdByWorktree: {},
    ptyIdsByTabId: {},
    cwdByPtyId: {},
    tabsByWorktree: {},
    agentStatusByPaneKey: {}
  })
})

describe('VerticalTabsSidebar', () => {
  it('shows the empty state when no vertical tab exists', () => {
    const view = renderSidebar()

    expect(view.getByTestId('vertical-tabs-sidebar').textContent).toContain('Terminals')
    expect(view.getByTestId('vertical-tabs-list').textContent).toContain('No terminal tabs')
    expect(view.getByTestId('vertical-tabs-new-tab').hasAttribute('disabled')).toBe(false)
  })

  it('creates a vertical tab from the empty state, not just the 14px "+"', () => {
    const createVerticalTab = vi.fn(async () => null)
    useAppStore.setState({ projectGroups: [hidden], folderWorkspaces: [], createVerticalTab })
    const view = renderSidebar()

    fireEvent.click(view.getByTestId('vertical-tabs-empty-create'))

    expect(createVerticalTab).toHaveBeenCalled()
  })

  it('renders the Agents entry with an unread badge the vertical tabs feed', () => {
    // Why the settings: an unread vertical tab is only reachable — and so only
    // countable — in terminal mode. With the flag off the badge must stay empty.
    // `experimentalActivity` is the Activity surface's own gate (below).
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [{ ...vtab('first', 1), isUnread: true }],
      settings: {
        ...useAppStore.getState().settings,
        experimentalTerminalMode: true,
        experimentalActivity: true
      } as never
    })
    const view = renderSidebar()

    expect(view.getByTestId('vertical-tabs-agents-entry')).toBeTruthy()
    expect(view.getByTestId('vertical-tabs-agents-entry-unread').textContent).toBe('1')
  })

  it('hides the Agents entry when the Activity experiment is off', () => {
    // Classic parity is asserted in SidebarNav.test.tsx, which renders both rows;
    // this is the terminal-mode half: with the flag off the Activity page cannot
    // be opened, so a row here would badge and do nothing.
    for (const experimentalActivity of [false, true]) {
      useAppStore.setState({
        projectGroups: [hidden],
        folderWorkspaces: [{ ...vtab('first', 1), isUnread: true }],
        settings: {
          ...useAppStore.getState().settings,
          experimentalTerminalMode: true,
          experimentalActivity
        } as never
      })
      const view = renderSidebar()

      expect(view.queryByTestId('vertical-tabs-agents-entry') !== null).toBe(experimentalActivity)
      cleanup()
    }
  })

  it('rolls a working agent up to the row status dot', () => {
    // Attribution runs through `tabsByWorktree`, keyed by the tab's `folder:` key.
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('first', 1)],
      tabsByWorktree: { 'folder:first': [{ id: 'tab-1' } as never] },
      agentStatusByPaneKey: {
        'tab-1:11111111-1111-4111-8111-111111111111': {
          state: 'working',
          prompt: '',
          updatedAt: Date.now(),
          stateStartedAt: Date.now(),
          paneKey: 'tab-1:11111111-1111-4111-8111-111111111111'
        } as never
      }
    })
    const view = renderSidebar()

    // The sr-only label, not the spinner: it is what assistive tech reads.
    expect(view.getByTestId('vertical-tab-row').textContent).toContain('Working')
  })

  it('creates a vertical tab from the "+" button', () => {
    const createVerticalTab = vi.fn(async () => 'new')
    useAppStore.setState({ createVerticalTab })
    const view = renderSidebar()

    fireEvent.click(view.getByTestId('vertical-tabs-new-tab'))

    expect(createVerticalTab).toHaveBeenCalledOnce()
  })

  it('renders rows in order and marks the active one', () => {
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('second', 2), vtab('first', 1)],
      activeWorkspaceKey: 'folder:second'
    })
    const view = renderSidebar()

    const rows = view.getAllByTestId('vertical-tab-row')
    expect(rows.map((row) => row.getAttribute('data-vertical-tab-id'))).toEqual(['first', 'second'])
    expect(rows[0].getAttribute('data-current')).toBeNull()
    expect(rows[1].getAttribute('data-current')).toBe('true')
  })

  it('activates a vertical tab on click', () => {
    const activateVerticalTab = vi.fn()
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('first', 1)],
      activateVerticalTab
    })
    const view = renderSidebar()

    fireEvent.click(view.getByTestId('vertical-tab-row'))

    expect(activateVerticalTab).toHaveBeenCalledWith('first')
  })

  it('routes the row close button through the confirmation dialog', () => {
    const requestVerticalTabClose = vi.fn()
    const closeVerticalTab = vi.fn(async () => {})
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('first', 1)],
      requestVerticalTabClose,
      closeVerticalTab
    })
    const view = renderSidebar()

    fireEvent.click(view.getByTestId('vertical-tab-close'))

    expect(requestVerticalTabClose).toHaveBeenCalledWith('first')
    expect(closeVerticalTab).not.toHaveBeenCalled()
  })

  it('opens the confirmation even when no agent is running', () => {
    // The dialog is the only thing between the close button and an irreversible
    // `deleteFolderWorkspace` that also kills a build or a `top` no agent list can see.
    // Phase 5 makes it informative, never optional — so this drives the real action.
    const closeVerticalTab = vi.fn(async () => {})
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('first', 1)],
      agentStatusByPaneKey: {},
      closeVerticalTab
    })
    const view = renderSidebar()

    fireEvent.click(view.getByTestId('vertical-tab-close'))

    expect(useAppStore.getState().verticalTabPendingCloseId).toBe('first')
    expect(closeVerticalTab).not.toHaveBeenCalled()
  })

  it('surfaces the focused terminal pwd, falling back to the tab start directory', () => {
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('first', 1)],
      activeWorkspaceKey: 'folder:first',
      activeTabIdByWorktree: { 'folder:first': 'tab-1' },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] }
    })
    const fallback = renderSidebar()
    expect(fallback.getByTestId('vtab-active-pwd').textContent).toBe('/home/dev/first')
    cleanup()

    useAppStore.setState({ cwdByPtyId: { 'pty-1': { cwd: '/srv/app', source: 'osc7' } } })
    const tracked = renderSidebar()
    expect(tracked.getByTestId('vtab-active-pwd').textContent).toBe('/srv/app')
  })

  it('activates a vertical tab from the keyboard', () => {
    const activateVerticalTab = vi.fn()
    useAppStore.setState({
      projectGroups: [hidden],
      folderWorkspaces: [vtab('first', 1)],
      activateVerticalTab
    })
    const view = renderSidebar()

    fireEvent.keyDown(view.getByTestId('vertical-tab-row'), { key: 'Enter' })

    expect(activateVerticalTab).toHaveBeenCalledWith('first')
  })
})

// Why a separate host: the confirmation and the close-on-empty reconciler must keep
// working while the sidebar is collapsed and the tab strip is unmounted.
describe('TerminalModeSidebarHost', () => {
  it('closes only after the confirmation is accepted', () => {
    const closeVerticalTab = vi.fn(async () => {})
    useAppStore.setState({ verticalTabPendingCloseId: 'first', closeVerticalTab })
    const view = render(<TerminalModeSidebarHost />)

    fireEvent.click(view.getByTestId('vertical-tab-close-confirm-action'))

    expect(closeVerticalTab).toHaveBeenCalledWith('first')
  })

  it('names the agents the close would kill', () => {
    useAppStore.setState({
      verticalTabPendingCloseId: 'first',
      tabsByWorktree: { 'folder:first': [{ id: 'tab-1' } as never] },
      agentStatusByPaneKey: {
        'tab-1:11111111-1111-4111-8111-111111111111': {
          state: 'working',
          prompt: '',
          agentType: 'claude',
          updatedAt: Date.now(),
          stateStartedAt: Date.now(),
          paneKey: 'tab-1:11111111-1111-4111-8111-111111111111'
        } as never
      }
    })
    const view = render(<TerminalModeSidebarHost />)

    expect(view.getByTestId('vertical-tab-close-confirm-agents').textContent).toContain('claude')
  })

  it('renders no dialog when nothing is pending', () => {
    useAppStore.setState({ verticalTabPendingCloseId: null })
    const view = render(<TerminalModeSidebarHost />)

    expect(view.queryByTestId('vertical-tab-close-confirm')).toBeNull()
  })
})
