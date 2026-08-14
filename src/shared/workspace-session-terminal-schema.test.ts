import { describe, expect, it } from 'vitest'
import { parseWorkspaceSession } from './workspace-session-schema'

describe('parseWorkspaceSession terminal fields', () => {
  it('preserves terminal startup cwd while accepting older omitted fields', () => {
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt: [
          {
            id: 'tab1',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal 1',
            defaultTitle: 'Terminal 1',
            startupCwd: '/repo/packages/app',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          },
          {
            id: 'tab2',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal 2',
            customTitle: null,
            color: null,
            sortOrder: 1,
            createdAt: 1
          }
        ]
      },
      terminalLayoutsByTabId: {}
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tabsByWorktree.wt[0].startupCwd).toBe('/repo/packages/app')
      expect(result.value.tabsByWorktree.wt[1].startupCwd).toBeUndefined()
    }
  })

  it('round-trips a restored pwd and parses sessions written without one', () => {
    // The field is additive: a session written by a build that predates terminal
    // mode has no `lastCwd` and must parse exactly as it does today.
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: 'folder:vtab',
      activeTabId: 'tab1',
      tabsByWorktree: {
        'folder:vtab': [
          {
            id: 'tab1',
            ptyId: null,
            worktreeId: 'folder:vtab',
            title: 'Terminal 1',
            startupCwd: '/home/dev',
            lastCwd: '/tmp/work',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          },
          {
            id: 'tab2',
            ptyId: null,
            worktreeId: 'folder:vtab',
            title: 'Terminal 2',
            customTitle: null,
            color: null,
            sortOrder: 1,
            createdAt: 1
          }
        ]
      },
      terminalLayoutsByTabId: {}
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tabsByWorktree['folder:vtab'][0].lastCwd).toBe('/tmp/work')
      expect(result.value.tabsByWorktree['folder:vtab'][1].lastCwd).toBeUndefined()
    }
  })

  it('drops a corrupt restored pwd instead of failing the whole session', () => {
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: 'folder:vtab',
      activeTabId: 'tab1',
      tabsByWorktree: {
        'folder:vtab': [
          {
            id: 'tab1',
            ptyId: null,
            worktreeId: 'folder:vtab',
            title: 'Terminal 1',
            startupCwd: '/home/dev',
            lastCwd: 42,
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      },
      terminalLayoutsByTabId: {}
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const tab = result.value.tabsByWorktree['folder:vtab'][0]
      expect(tab.lastCwd).toBeUndefined()
      expect(tab.startupCwd).toBe('/home/dev')
    }
  })

  it('rejects empty terminal startup cwd values', () => {
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt: [
          {
            id: 'tab1',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal 1',
            defaultTitle: 'Terminal 1',
            startupCwd: '',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      },
      terminalLayoutsByTabId: {}
    })

    expect(result.ok).toBe(false)
  })
})
