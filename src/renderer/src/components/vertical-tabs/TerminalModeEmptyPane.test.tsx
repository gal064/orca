// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import TerminalModeEmptyPane from './TerminalModeEmptyPane'

const real = {
  createVerticalTab: useAppStore.getState().createVerticalTab,
  activateVerticalTab: useAppStore.getState().activateVerticalTab,
  openNewTerminalTabInActiveWorkspace: useAppStore.getState().openNewTerminalTabInActiveWorkspace
}

afterEach(() => {
  cleanup()
  useAppStore.setState({ ...real, verticalTabCreatesInFlight: 0 })
})

describe('TerminalModeEmptyPane', () => {
  it('offers to open a terminal in the vertical tab that emptied, through the one funnel', () => {
    const openNewTerminalTabInActiveWorkspace = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ openNewTerminalTabInActiveWorkspace })
    const { getByTestId, container } = render(
      <TerminalModeEmptyPane state={{ kind: 'empty-vertical-tab', workspaceKey: 'folder:vt-1' }} />
    )

    expect(container.textContent).toContain('No terminals in this tab.')
    fireEvent.click(getByTestId('terminal-mode-empty-pane-open'))
    expect(openNewTerminalTabInActiveWorkspace).toHaveBeenCalled()
  })

  it('offers a way back when tabs exist but none is selected', () => {
    const activateVerticalTab = vi.fn()
    useAppStore.setState({
      activateVerticalTab,
      projectGroups: [{ id: 'g-terminal', name: '__terminal-mode__' }],
      folderWorkspaces: [{ id: 'vt-9', projectGroupId: 'g-terminal', createdAt: 1 }]
    } as never)
    const { getByTestId, container } = render(
      <TerminalModeEmptyPane state={{ kind: 'no-active-vertical-tab' }} />
    )

    expect(container.textContent).toContain('No terminal tab selected.')
    fireEvent.click(getByTestId('terminal-mode-empty-pane-open'))
    expect(activateVerticalTab).toHaveBeenCalledWith('vt-9')
    useAppStore.setState({ projectGroups: [], folderWorkspaces: [] } as never)
  })

  it('offers to create a tab when there is no vertical tab at all', () => {
    const createVerticalTab = vi.fn()
    useAppStore.setState({ createVerticalTab })
    const { getByTestId, container } = render(
      <TerminalModeEmptyPane state={{ kind: 'no-vertical-tabs' }} />
    )

    expect(container.textContent).toContain('No terminal tabs.')
    fireEvent.click(getByTestId('terminal-mode-empty-pane-open'))
    expect(createVerticalTab).toHaveBeenCalled()
  })

  it('carries no classic project or worktree concepts', () => {
    const { container } = render(
      <TerminalModeEmptyPane state={{ kind: 'empty-vertical-tab', workspaceKey: 'folder:vt-1' }} />
    )
    const text = container.textContent ?? ''
    for (const word of ['Project', 'project', 'worktree', 'Worktree', 'workspace', 'Workspace']) {
      expect(text).not.toContain(word)
    }
  })

  it('shows the create-a-tab wait state', () => {
    useAppStore.setState({ verticalTabCreatesInFlight: 1 })
    const noTabs = render(<TerminalModeEmptyPane state={{ kind: 'no-vertical-tabs' }} />)
    expect(
      (noTabs.getByTestId('terminal-mode-empty-pane-open') as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('does not open two terminals on a double click', () => {
    let resolveOpen = (): void => {}
    const openNewTerminalTabInActiveWorkspace = vi.fn(
      () => new Promise<void>((resolve) => (resolveOpen = resolve))
    )
    useAppStore.setState({ openNewTerminalTabInActiveWorkspace })
    const { getByTestId } = render(
      <TerminalModeEmptyPane state={{ kind: 'empty-vertical-tab', workspaceKey: 'folder:vt-1' }} />
    )
    const button = getByTestId('terminal-mode-empty-pane-open') as HTMLButtonElement

    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(openNewTerminalTabInActiveWorkspace).toHaveBeenCalledTimes(1)
    resolveOpen()
  })
})
