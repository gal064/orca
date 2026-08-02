// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings, Repo, Worktree, WorktreeCardProperty } from '../../../../shared/types'

const openModal = vi.fn()
const setRenamingWorktreeId = vi.fn()
const setWorktreesPinnedAndReveal = vi.fn()
const updateWorktreeMeta = vi.fn()
const testDoubles = vi.hoisted(() => ({
  activateWorktreeFromSidebar: vi.fn()
}))
let worktreeCardProperties: WorktreeCardProperty[] = ['status', 'comment']
let settings: Partial<GlobalSettings> | null = null
let deleteStateByWorktreeId: Record<string, { isDeleting: boolean }> = {}

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      browserTabsByWorktree: {},
      createBrowserTab: vi.fn(),
      deleteFolderWorkspace: vi.fn(),
      deleteStateByWorktreeId,
      fetchHostedReviewForBranch: vi.fn(),
      fetchIssue: vi.fn(),
      fetchLinearIssue: vi.fn(),
      gitConflictOperationByWorktree: {},
      hostedReviewCache: {},
      issueCache: {},
      linearIssueCache: {},
      openModal,
      openTaskPage: vi.fn(),
      projectGroups: [],
      ptyIdsByTabId: {},
      remoteBranchConflictByWorktreeId: {},
      renamingWorktreeId: null,
      setActiveWorktree: vi.fn(),
      setRemoteBrowserPageHandle: vi.fn(),
      setRenamingWorktreeId,
      setWorktreesPinnedAndReveal,
      settings,
      sshConnectionStates: new Map(),
      sshTargetLabels: new Map(),
      tabsByWorktree: {},
      updateWorktreeMeta,
      workspacePortScan: null,
      worktreeCardProperties
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
  activateWorktreeFromSidebar: testDoubles.activateWorktreeFromSidebar
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

vi.mock('./SshDisconnectedDialog', () => ({
  SshDisconnectedDialog: () => null
}))

vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu-wrapper">{children}</div>
  ),
  CLOSE_ALL_CONTEXT_MENUS_EVENT: 'orca:test-close-context-menus',
  WORKTREE_CONTEXT_MENU_SCOPE_ATTR: 'data-orca-context-menu-scope',
  WORKTREE_NATIVE_CONTEXT_MENU_ATTR: 'data-worktree-native-context-menu'
}))

vi.mock('./WorktreeTitleInlineRename', () => ({
  WorktreeTitleInlineRename: ({
    disabled,
    displayName
  }: {
    disabled?: boolean
    displayName: string
  }) => (
    <span data-testid="inline-rename" data-disabled={disabled ? 'true' : 'false'}>
      {displayName}
    </span>
  )
}))

import WorktreeCard from './WorktreeCard'

function makeRepo(): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1
  }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/worktrees/affiliate',
    repoId: 'repo-1',
    path: '/repo/worktrees/affiliate',
    displayName: 'Affiliate child',
    branch: 'refs/heads/affiliate-child',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: 'read only',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    ...overrides
  }
}

describe('WorktreeCard click interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    worktreeCardProperties = ['status', 'comment']
    settings = null
    deleteStateByWorktreeId = {}
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps the card visual surface but disables mutating list interactions', () => {
    act(() => {
      root.render(
        <WorktreeCard
          worktree={makeWorktree()}
          repo={makeRepo()}
          isActive={false}
          nativeDragEnabled
          flushSurface
          affiliateListMode
        />
      )
    })

    const surface = container.querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
    const parentContent = container.querySelector<HTMLElement>(
      '[data-worktree-card-parent-content=""]'
    )
    expect(surface).not.toBeNull()
    expect(parentContent?.className).toContain('gap-0.5')
    expect(parentContent?.className).toContain('pl-0')
    const statusSlot = container.querySelector<HTMLElement>('[data-worktree-card-status-slot]')
    expect(statusSlot?.className).toContain('px-1')
    expect(container.querySelector('[data-testid="context-menu-wrapper"]')).toBeNull()
    expect(surface?.getAttribute('draggable')).toBe('false')
    expect(
      container.querySelector('[data-testid="inline-rename"]')?.getAttribute('data-disabled')
    ).toBe('true')

    act(() => {
      surface?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(openModal).not.toHaveBeenCalled()
    expect(setRenamingWorktreeId).not.toHaveBeenCalled()
    expect(updateWorktreeMeta).not.toHaveBeenCalled()

    act(() => {
      surface?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(testDoubles.activateWorktreeFromSidebar).toHaveBeenCalledWith(
      'repo-1::/repo/worktrees/affiliate',
      'local'
    )

    act(() => {
      surface?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    expect(setWorktreesPinnedAndReveal).not.toHaveBeenCalled()
  })

  it('still shows inline agent details in affiliate list mode', () => {
    worktreeCardProperties = ['status', 'inline-agents']

    act(() => {
      root.render(
        <WorktreeCard
          worktree={makeWorktree()}
          repo={makeRepo()}
          isActive={false}
          nativeDragEnabled
          flushSurface
          affiliateListMode
        />
      )
    })

    expect(container.querySelector('[data-testid="inline-agents"]')).not.toBeNull()
  })

  it('toggles workspace pinning on shift-click without selecting or activating', () => {
    const onImmediateActivate = vi.fn()
    const onSelectionGesture = vi.fn(() => false)
    const renderCard = (isPinned: boolean): void => {
      act(() => {
        root.render(
          <WorktreeCard
            worktree={makeWorktree({ isPinned })}
            repo={makeRepo()}
            isActive={false}
            onImmediateActivate={onImmediateActivate}
            onSelectionGesture={onSelectionGesture}
          />
        )
      })
    }

    renderCard(false)
    act(() => {
      container
        .querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    renderCard(true)
    act(() => {
      container
        .querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    expect(setWorktreesPinnedAndReveal).toHaveBeenNthCalledWith(
      1,
      ['repo-1::/repo/worktrees/affiliate'],
      true,
      { executionHostId: 'local' }
    )
    expect(setWorktreesPinnedAndReveal).toHaveBeenNthCalledWith(
      2,
      ['repo-1::/repo/worktrees/affiliate'],
      false,
      { executionHostId: 'local' }
    )
    expect(onSelectionGesture).not.toHaveBeenCalled()
    expect(onImmediateActivate).not.toHaveBeenCalled()
    expect(testDoubles.activateWorktreeFromSidebar).not.toHaveBeenCalled()
  })

  it('does not pin a deleting workspace', () => {
    deleteStateByWorktreeId = {
      'repo-1::/repo/worktrees/affiliate': { isDeleting: true }
    }
    act(() => {
      root.render(<WorktreeCard worktree={makeWorktree()} repo={makeRepo()} isActive={false} />)
    })

    const surface = container.querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
    act(() => {
      surface?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    expect(setWorktreesPinnedAndReveal).not.toHaveBeenCalled()
  })

  it('uses the focused runtime for a legacy unstamped workspace', () => {
    settings = { activeRuntimeEnvironmentId: 'env-legacy' }
    act(() => {
      root.render(<WorktreeCard worktree={makeWorktree()} repo={makeRepo()} isActive={false} />)
    })

    act(() => {
      container
        .querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    expect(setWorktreesPinnedAndReveal).toHaveBeenCalledWith(
      ['repo-1::/repo/worktrees/affiliate'],
      true,
      { executionHostId: 'runtime:env-legacy' }
    )
  })
})
