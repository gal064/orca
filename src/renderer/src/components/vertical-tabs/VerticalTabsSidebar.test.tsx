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

afterEach(() => {
  cleanup()
  useAppStore.setState({
    folderWorkspaces: [],
    projectGroups: [],
    activeWorkspaceKey: null,
    verticalTabPendingCloseId: null
  })
})

describe('VerticalTabsSidebar', () => {
  it('shows the empty state when no vertical tab exists', () => {
    const view = renderSidebar()

    expect(view.getByTestId('vertical-tabs-sidebar').textContent).toContain('Terminals')
    expect(view.getByTestId('vertical-tabs-list').textContent).toContain('No terminal tabs')
    expect(view.getByTestId('vertical-tabs-new-tab').hasAttribute('disabled')).toBe(false)
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

  it('renders no dialog when nothing is pending', () => {
    useAppStore.setState({ verticalTabPendingCloseId: null })
    const view = render(<TerminalModeSidebarHost />)

    expect(view.queryByTestId('vertical-tab-close-confirm')).toBeNull()
  })
})
