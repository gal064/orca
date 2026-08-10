// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo, Worktree } from '../../../../shared/types'
import { setVisibleWorktreeIds } from './visible-worktrees'

let keybindings: Record<string, string[]> | undefined

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      browserTabsByWorktree: {},
      createBrowserTab: vi.fn(),
      deleteFolderWorkspace: vi.fn(),
      deleteStateByWorktreeId: {},
      fetchHostedReviewForBranch: vi.fn(),
      fetchIssue: vi.fn(),
      fetchLinearIssue: vi.fn(),
      gitConflictOperationByWorktree: {},
      hostedReviewCache: {},
      issueCache: {},
      keybindings,
      linearIssueCache: {},
      openModal: vi.fn(),
      openTaskPage: vi.fn(),
      projectGroups: [],
      ptyIdsByTabId: {},
      remoteBranchConflictByWorktreeId: {},
      renamingWorktreeId: null,
      setActiveWorktree: vi.fn(),
      setRemoteBrowserPageHandle: vi.fn(),
      setRenamingWorktreeId: vi.fn(),
      setWorktreesPinnedAndReveal: vi.fn(),
      settings: null,
      sshConnectionStates: new Map(),
      sshTargetLabels: new Map(),
      tabsByWorktree: {},
      updateWorktreeMeta: vi.fn(),
      workspacePortScan: null,
      worktreeCardProperties: ['status', 'comment']
    })
}))

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/lib/sidebar-worktree-activation', () => ({
  activateWorktreeFromSidebar: vi.fn()
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  getActiveRuntimeTarget: () => ({ kind: 'local' })
}))

vi.mock('./use-worktree-activity-status', () => ({
  useWorktreeActivityStatus: () => 'idle'
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownStartedAt: () => null
}))

vi.mock('./WorktreeCardAgents', () => ({
  default: () => <div data-testid="inline-agents" />
}))

vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CLOSE_ALL_CONTEXT_MENUS_EVENT: 'orca:test-close-context-menus',
  WORKTREE_CONTEXT_MENU_SCOPE_ATTR: 'data-orca-context-menu-scope',
  WORKTREE_NATIVE_CONTEXT_MENU_ATTR: 'data-worktree-native-context-menu'
}))

vi.mock('./WorktreeTitleInlineRename', () => ({
  WorktreeTitleInlineRename: ({ displayName }: { displayName: string }) => (
    <span data-testid="inline-rename">{displayName}</span>
  )
}))

import WorktreeCard from './WorktreeCard'

const WORKTREE_ID = 'repo-1::/repo/worktrees/seven'

function makeRepo(): Repo {
  return { id: 'repo-1', path: '/repo', displayName: 'orca', badgeColor: '#999999', addedAt: 1 }
}

function makeWorktree(): Worktree {
  return {
    id: WORKTREE_ID,
    repoId: 'repo-1',
    path: '/repo/worktrees/seven',
    displayName: 'Seventh workspace',
    branch: 'refs/heads/seventh',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1
  }
}

describe('WorktreeCard workspace shortcut badge', () => {
  let container: HTMLDivElement
  let root: Root

  function renderCard(affiliateListMode = false): void {
    act(() => {
      root.render(
        <WorktreeCard
          worktree={makeWorktree()}
          repo={makeRepo()}
          isActive={false}
          flushSurface
          affiliateListMode={affiliateListMode}
        />
      )
    })
  }

  // Why read the caps rather than a testid: this asserts what the user sees.
  function shortcutCapLabels(): string[] {
    return Array.from(container.querySelectorAll('span'))
      .map((node) => node.textContent ?? '')
      .filter((text) => text === '7' || text === '⌘' || text === 'Ctrl')
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    keybindings = undefined
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    setVisibleWorktreeIds(null)
  })

  it('shows the digit matching the workspace position in the sidebar order', () => {
    setVisibleWorktreeIds([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      WORKTREE_ID // seventh row -> Mod+7
    ])
    renderCard()
    expect(shortcutCapLabels()).toContain('7')
  })

  it('shows no badge past the addressable range', () => {
    setVisibleWorktreeIds(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', WORKTREE_ID])
    renderCard()
    expect(shortcutCapLabels()).toHaveLength(0)
  })

  it('shows no badge when the action is unbound', () => {
    keybindings = { 'workspace.selectByIndex': [] }
    setVisibleWorktreeIds([WORKTREE_ID])
    renderCard()
    expect(shortcutCapLabels()).toHaveLength(0)
  })

  it('shows no badge in affiliate lists, whose rows are not the numbered order', () => {
    setVisibleWorktreeIds([WORKTREE_ID])
    renderCard(true)
    expect(shortcutCapLabels()).toHaveLength(0)
  })

  // Layout-shift guards. happy-dom computes no real box, so pin the contract
  // instead: hovering must not remove the chip's box, and the chip must never
  // be the element that decides row height.
  describe('does not shift card layout on hover', () => {
    function badgeWrapper(): HTMLElement {
      const cap = Array.from(container.querySelectorAll('span')).find(
        (node) => node.textContent === '7'
      )
      // cap -> ShortcutKeyCombo root -> hover-toggled wrapper
      const wrapper = cap?.parentElement?.parentElement
      if (!wrapper) {
        throw new Error('shortcut badge wrapper not found')
      }
      return wrapper
    }

    beforeEach(() => {
      setVisibleWorktreeIds(['a', 'b', 'c', 'd', 'e', 'f', WORKTREE_ID])
      renderCard()
    })

    it('stays visible on hover instead of being toggled away', () => {
      const className = badgeWrapper().className
      // display:none collapses the box and jumps every row below it; visibility
      // toggling merely blanks a chip the user wants to read. Neither belongs.
      expect(className).not.toContain('group-hover/worktree-card:hidden')
      expect(className).not.toContain('group-hover/worktree-card:invisible')
      expect(className).not.toContain('group-focus-within/worktree-card:hidden')
    })

    it('pins the key cap height so the title line decides row height', () => {
      const cap = Array.from(container.querySelectorAll('span')).find(
        (node) => node.textContent === '7'
      )
      // 16px cap under the 20px (leading-5) title line, with no inherited
      // line-height able to stretch it.
      expect(cap?.className).toContain('h-4')
      expect(cap?.className).toContain('leading-none')
    })
  })
})
