import { describe, expect, it } from 'vitest'
import { resolveMountedTabStartCwd } from './terminal-tab-start-cwd'

const tabsByWorktree = {
  'folder:vtab': [
    { id: 'tab-1', startupCwd: '/home/dev', lastCwd: '/tmp/work' },
    { id: 'tab-2', startupCwd: '/home/dev/repo' }
  ],
  'repo-1::/repo/app': [{ id: 'tab-3', startupCwd: '/repo/app/packages/web' }]
}

describe('resolveMountedTabStartCwd', () => {
  it('prefers the restored pwd over the cwd the caller resolved', () => {
    expect(resolveMountedTabStartCwd(tabsByWorktree, 'folder:vtab', 'tab-1', '/home/dev')).toBe(
      '/tmp/work'
    )
  })

  it("keeps the caller's cwd for every tab with no restored pwd", () => {
    // Classic tabs, and floating/overlay panes that resolve their own directory,
    // must come out byte-identical to what the call site passed.
    expect(
      resolveMountedTabStartCwd(tabsByWorktree, 'folder:vtab', 'tab-2', '/home/dev/repo')
    ).toBe('/home/dev/repo')
    expect(
      resolveMountedTabStartCwd(tabsByWorktree, 'repo-1::/repo/app', 'tab-3', '/repo/app')
    ).toBe('/repo/app')
    expect(resolveMountedTabStartCwd({}, 'folder:vtab', 'tab-1', '/home/dev')).toBe('/home/dev')
  })

  it('never borrows another workspace or tab', () => {
    expect(resolveMountedTabStartCwd(tabsByWorktree, 'repo-1::/repo/app', 'tab-1', '/x')).toBe('/x')
    expect(resolveMountedTabStartCwd(tabsByWorktree, 'folder:missing', 'tab-1', '/x')).toBe('/x')
  })

  it('ignores a blank restored pwd from a hand-edited session', () => {
    expect(
      resolveMountedTabStartCwd({ wt: [{ id: 'tab-1', lastCwd: '   ' }] }, 'wt', 'tab-1', '/home')
    ).toBe('/home')
  })
})
