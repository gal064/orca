import { describe, expect, it } from 'vitest'
import type { TerminalTab, Worktree } from '../../../shared/types'
import { getUnreadBadgeCount } from './unread-badge-count'

function worktree(id: string, isUnread: boolean): Worktree {
  return { id, isUnread } as Worktree
}

function tab(id: string): TerminalTab {
  return { id } as TerminalTab
}

describe('getUnreadBadgeCount', () => {
  it('counts unread worktrees', () => {
    expect(
      getUnreadBadgeCount({
        folderWorkspaces: [],
        worktreesByRepo: { repo: [worktree('wt-1', true), worktree('wt-2', false)] },
        tabsByWorktree: {},
        unreadTerminalTabs: {}
      })
    ).toBe(1)
  })

  it('dedupes unread terminal tabs against their worktree', () => {
    expect(
      getUnreadBadgeCount({
        folderWorkspaces: [],
        worktreesByRepo: { repo: [worktree('wt-1', true)] },
        tabsByWorktree: { 'wt-1': [tab('tab-1'), tab('tab-2')] },
        unreadTerminalTabs: { 'tab-1': true, 'tab-2': true }
      })
    ).toBe(1)
  })

  it('counts tab-only unread activity by owning worktree', () => {
    expect(
      getUnreadBadgeCount({
        folderWorkspaces: [],
        worktreesByRepo: { repo: [worktree('wt-1', false), worktree('wt-2', false)] },
        tabsByWorktree: { 'wt-1': [tab('tab-1')], 'wt-2': [tab('tab-2')] },
        unreadTerminalTabs: { 'tab-1': true, 'tab-2': true }
      })
    ).toBe(2)
  })

  it('counts an unread folder workspace, which is what a vertical tab is', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: {},
        folderWorkspaces: [{ id: 'vtab-1', isUnread: true } as never],
        tabsByWorktree: {},
        unreadTerminalTabs: {}
      })
    ).toBe(1)
  })

  it('does not double-count a folder workspace that also has an unread tab', () => {
    // The folder key is the same one `tabsByWorktree` uses, so the tab sweep dedupes.
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: {},
        folderWorkspaces: [{ id: 'vtab-1', isUnread: true } as never],
        tabsByWorktree: { 'folder:vtab-1': [tab('tab-1')] },
        unreadTerminalTabs: { 'tab-1': true }
      })
    ).toBe(1)
  })
})
