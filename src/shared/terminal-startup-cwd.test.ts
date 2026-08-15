import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from './constants'
import {
  resolveTerminalStartupCwd,
  resolveTerminalStartupCwdForWorkspace,
  resolveTerminalStartupCwdResult
} from './terminal-startup-cwd'
import { folderWorkspaceKey } from './workspace-scope'

describe('resolveTerminalStartupCwd', () => {
  it('accepts absolute child paths inside the worktree', () => {
    expect(resolveTerminalStartupCwd('/repo/app', '/repo/app/packages/web')).toBe(
      '/repo/app/packages/web'
    )
  })

  it('resolves relative paths against the worktree', () => {
    expect(resolveTerminalStartupCwd('/repo/app', 'packages/web')).toBe('/repo/app/packages/web')
  })

  it('allows absolute cwds outside the worktree (#7685)', () => {
    // Why: opening/splitting a terminal outside the worktree (e.g. after
    // `cd ..`) is allowed; the cwd is resolved, not constrained.
    expect(resolveTerminalStartupCwd('/repo/app', '/repo/app-other')).toBe('/repo/app-other')
  })

  it('resolves parent traversal to a path outside the worktree (#7685)', () => {
    expect(resolveTerminalStartupCwd('/repo/app', '../other')).toBe('/repo/other')
  })

  it('trims whitespace-padded requested cwds before resolving', () => {
    expect(resolveTerminalStartupCwd('/repo/app', ' packages/web ')).toBe('/repo/app/packages/web')
  })

  it('returns undefined for an empty requested cwd', () => {
    expect(resolveTerminalStartupCwd('/repo/app', '')).toBeUndefined()
    expect(resolveTerminalStartupCwd('/repo/app', '   ')).toBeUndefined()
    expect(resolveTerminalStartupCwd('/repo/app', null)).toBeUndefined()
  })

  it('normalizes Windows separators and allows out-of-worktree drives', () => {
    expect(resolveTerminalStartupCwd('C:\\Repo\\App', 'packages\\web')).toBe(
      'C:/Repo/App/packages/web'
    )
    expect(resolveTerminalStartupCwd('C:\\Repo\\App', 'C:\\Repo\\AppOther')).toBe(
      'C:/Repo/AppOther'
    )
  })

  it('resolves renderer PTY cwd values against raw worktree IDs', () => {
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: 'repo-1::/repo/app',
        requestedCwd: '/repo/app/packages/web'
      }).cwd
    ).toBe('/repo/app/packages/web')
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: 'repo-1::/repo/app',
        requestedCwd: '/repo/app-other'
      }).cwd
    ).toBe('/repo/app-other')
  })

  it('passes floating terminal cwds through untouched', () => {
    // Why: floating terminal cwds are validated against trusted-directory
    // grants in main and have no worktree root to resolve against.
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: FLOATING_TERMINAL_WORKTREE_ID,
        requestedCwd: '/Volumes/work/notes'
      }).cwd
    ).toBe('/Volumes/work/notes')
  })

  it('falls back to the provider default when no workspace root is resolvable', () => {
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: undefined,
        requestedCwd: '/anywhere'
      }).cwd
    ).toBeUndefined()
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: 'opaque-worktree-id',
        requestedCwd: '/anywhere'
      }).cwd
    ).toBeUndefined()
  })

  it('falls back to the workspace root when the requested cwd directory is missing', () => {
    expect(
      resolveTerminalStartupCwdResult('/repo/app', '/repo/app/deleted-folder', {
        directoryUsability: (path) => (path === '/repo/app' ? 'usable' : 'missing')
      })
    ).toEqual({
      cwd: '/repo/app',
      fallback: { kind: 'worktree', reason: 'missing', rejectedCwd: '/repo/app/deleted-folder' }
    })
  })

  it('falls back to a non-ASCII workspace root for a missing cwd (#7239)', () => {
    // Why: issue #7239 reproduced in a Japanese-named worktree; the fallback
    // must preserve the selected worktree path verbatim.
    const worktreePath = '/Users/motoki/orca/workspaces/nakamuramotoki/Fableと議論'
    expect(
      resolveTerminalStartupCwd(worktreePath, '/var/tmp/orca-stale', {
        directoryUsability: (path) => (path === worktreePath ? 'usable' : 'missing')
      })
    ).toBe(worktreePath)
  })

  it('keeps an existing cwd outside the worktree when fallback is enabled (#7685)', () => {
    expect(
      resolveTerminalStartupCwdResult('/repo/app', '/repo/app-other', {
        directoryUsability: () => 'usable'
      })
    ).toEqual({ cwd: '/repo/app-other' })
  })

  it('keeps an existing nested cwd when fallback is enabled', () => {
    expect(
      resolveTerminalStartupCwdResult('/repo/app', 'packages/web', {
        directoryUsability: () => 'usable'
      })
    ).toEqual({ cwd: '/repo/app/packages/web' })
  })

  it('keeps the requested cwd when the workspace root is missing too', () => {
    // Why: unmounted volume / stopped WSL distro — falling back would spawn a
    // misleading shell; let the provider surface its normal error instead.
    expect(
      resolveTerminalStartupCwdResult('/repo/app', '/repo/app/deleted-folder', {
        directoryUsability: () => 'missing'
      })
    ).toEqual({
      cwd: '/repo/app/deleted-folder',
      unrecoverable: { rejectedCwd: '/repo/app/deleted-folder', reason: 'missing' }
    })
  })

  it('prefers the tab start folder over the workspace root for a missing cwd', () => {
    // Terminal mode restores a tab in its last-known pwd; when that directory is
    // gone the tab's own creation folder is closer than the workspace root.
    // No notice: nothing surprising happened to the user.
    expect(
      resolveTerminalStartupCwdResult('/home/dev', '/tmp/gone', {
        directoryUsability: (path) => (path === '/tmp/gone' ? 'missing' : 'usable'),
        fallbackCwd: () => '/home/dev/repo/src'
      })
    ).toEqual({ cwd: '/home/dev/repo/src' })
  })

  it('falls through to the workspace root when the tab start folder is gone too', () => {
    expect(
      resolveTerminalStartupCwdResult('/home/dev', '/tmp/gone', {
        directoryUsability: (path) => (path === '/home/dev' ? 'usable' : 'missing'),
        fallbackCwd: () => '/home/dev/repo/src'
      })
    ).toEqual({
      cwd: '/home/dev',
      fallback: { kind: 'worktree', reason: 'missing', rejectedCwd: '/tmp/gone' }
    })
  })

  it('ignores a tab start folder equal to the missing cwd', () => {
    const directoryUsability = vi.fn((path: string) =>
      path === '/home/dev' ? ('usable' as const) : ('missing' as const)
    )
    expect(
      resolveTerminalStartupCwd('/home/dev', '/tmp/gone', {
        directoryUsability,
        fallbackCwd: () => ' /tmp/gone '
      })
    ).toBe('/home/dev')
  })

  it('keeps an existing cwd without consulting the tab start folder', () => {
    const directoryUsability = vi.fn(() => 'usable' as const)
    expect(
      resolveTerminalStartupCwd('/home/dev', '/tmp/keep', {
        directoryUsability,
        fallbackCwd: () => '/home/dev/repo/src'
      })
    ).toBe('/tmp/keep')
    expect(directoryUsability).toHaveBeenCalledTimes(1)
  })

  it('keeps the workspace root when the requested cwd resolves to it and is usable', () => {
    const directoryUsability = vi.fn(() => 'usable' as const)
    expect(resolveTerminalStartupCwd('/repo/app', '/repo/app', { directoryUsability })).toBe(
      '/repo/app'
    )
    expect(directoryUsability).toHaveBeenCalledTimes(1)
  })

  it('falls back from a missing parent-traversal cwd to the workspace root', () => {
    expect(
      resolveTerminalStartupCwd('/repo/app', '../deleted', {
        directoryUsability: (path) => (path === '/repo/app' ? 'usable' : 'missing')
      })
    ).toBe('/repo/app')
  })

  it('recovers missing renderer cwd values against raw worktree IDs', () => {
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: 'repo-1::/repo/app',
        requestedCwd: '/repo/app/deleted-folder',
        missingDirFallback: {
          directoryUsability: (path) => (path === '/repo/app' ? 'usable' : 'missing')
        }
      }).cwd
    ).toBe('/repo/app')
  })

  it('recovers missing cwd values against a resolved folder workspace root', () => {
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: folderWorkspaceKey('folder-1'),
        requestedCwd: 'deleted-folder',
        resolveFolderWorkspacePath: (id) => (id === 'folder-1' ? '/repo/app' : null),
        missingDirFallback: {
          directoryUsability: (path) => (path === '/repo/app' ? 'usable' : 'missing')
        }
      }).cwd
    ).toBe('/repo/app')
  })

  it('never probes floating terminal cwds', () => {
    const directoryUsability = vi.fn(() => 'missing' as const)
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: FLOATING_TERMINAL_WORKTREE_ID,
        requestedCwd: '/Volumes/work/notes',
        missingDirFallback: { directoryUsability }
      }).cwd
    ).toBe('/Volumes/work/notes')
    expect(directoryUsability).not.toHaveBeenCalled()
  })

  it('resolves renderer PTY cwd values against folder workspace keys', () => {
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: folderWorkspaceKey('folder-1'),
        requestedCwd: 'packages/web',
        resolveFolderWorkspacePath: (id) => (id === 'folder-1' ? '/repo/app' : null)
      }).cwd
    ).toBe('/repo/app/packages/web')
    expect(
      resolveTerminalStartupCwdForWorkspace({
        workspaceId: folderWorkspaceKey('folder-1'),
        requestedCwd: '../other',
        resolveFolderWorkspacePath: (id) => (id === 'folder-1' ? '/repo/app' : null)
      }).cwd
    ).toBe('/repo/other')
  })
  it('falls back to the workspace root when the requested cwd is unreadable', () => {
    // A chmod 000 directory stats fine but the child's chdir fails, so it must
    // travel the same chain as a deleted one — with its own reason.
    expect(
      resolveTerminalStartupCwdResult('/repo/app', '/repo/app/locked', {
        directoryUsability: (path) => (path === '/repo/app' ? 'usable' : 'inaccessible')
      })
    ).toEqual({
      cwd: '/repo/app',
      fallback: { kind: 'worktree', reason: 'inaccessible', rejectedCwd: '/repo/app/locked' }
    })
  })

  it('falls back to the home directory when the workspace root is unreadable too', () => {
    // A terminal-mode vertical tab's root *is* its start folder, so an unusable
    // root has no worktree step left to take.
    expect(
      resolveTerminalStartupCwdResult('/tmp/locked', '/tmp/locked', {
        directoryUsability: (path) => (path === '/home/dev' ? 'usable' : 'inaccessible'),
        homeCwd: () => '/home/dev'
      })
    ).toEqual({
      cwd: '/home/dev',
      fallback: { kind: 'home', reason: 'inaccessible', rejectedCwd: '/tmp/locked' }
    })
  })

  it('keeps an unusable cwd when no home fallback was offered', () => {
    // Classic workspaces pass no homeCwd, so an unmounted worktree still surfaces
    // the provider's own error instead of silently opening somewhere else.
    expect(
      resolveTerminalStartupCwdResult('/mnt/vol/app', '/mnt/vol/app', {
        directoryUsability: () => 'missing'
      })
    ).toEqual({
      cwd: '/mnt/vol/app',
      unrecoverable: { rejectedCwd: '/mnt/vol/app', reason: 'missing' }
    })
  })

  it('prefers the workspace root over the home directory', () => {
    expect(
      resolveTerminalStartupCwdResult('/repo/app', '/tmp/locked', {
        directoryUsability: (path) => (path === '/tmp/locked' ? 'inaccessible' : 'usable'),
        homeCwd: () => '/home/dev'
      })
    ).toEqual({
      cwd: '/repo/app',
      fallback: { kind: 'worktree', reason: 'inaccessible', rejectedCwd: '/tmp/locked' }
    })
  })

  it('reports an unusable home fallback rather than opening there', () => {
    expect(
      resolveTerminalStartupCwdResult('/tmp/locked', '/tmp/locked', {
        directoryUsability: () => 'inaccessible',
        homeCwd: () => '/home/dev'
      })
    ).toEqual({
      cwd: '/tmp/locked',
      unrecoverable: { rejectedCwd: '/tmp/locked', reason: 'inaccessible' }
    })
  })
})
