import { describe, expect, it } from 'vitest'
import {
  selectTerminalModePanelRoot,
  selectTerminalModeWatchRoots,
  type TerminalModePanelScope
} from './terminal-mode-panels'

function state(scope: TerminalModePanelScope | null): { terminalModePanelScope: typeof scope } {
  return { terminalModePanelScope: scope }
}

const scope: TerminalModePanelScope = {
  workspaceKey: 'folder:vtab-1',
  root: '/repo/src',
  workspaceRoot: '/repo',
  repoRoot: '/repo',
  addressing: 'relative',
  clampedToWorkspaceRoot: false
}

describe('terminal-mode panel selectors', () => {
  it('answer nothing in classic mode', () => {
    expect(selectTerminalModePanelRoot(state(null), 'folder:vtab-1')).toBeNull()
    expect(selectTerminalModeWatchRoots(state(null), 'folder:vtab-1')).toBeNull()
  })

  it('answer nothing for a different workspace', () => {
    expect(selectTerminalModePanelRoot(state(scope), 'folder:other')).toBeNull()
    expect(selectTerminalModeWatchRoots(state(scope), 'folder:other')).toBeNull()
  })

  it('expose the explorer root for the owning workspace only', () => {
    expect(selectTerminalModePanelRoot(state(scope), 'folder:vtab-1')).toBe('/repo/src')
  })
})

describe('selectTerminalModeWatchRoots', () => {
  it('watches the pwd and the repo root when they differ', () => {
    expect(selectTerminalModeWatchRoots(state(scope), 'folder:vtab-1')).toEqual([
      '/repo/src',
      '/repo'
    ])
  })

  it('watches one path when the pwd is the repo root', () => {
    expect(
      selectTerminalModeWatchRoots(state({ ...scope, root: '/repo' }), 'folder:vtab-1')
    ).toEqual(['/repo'])
  })

  it('watches only the pwd outside a repository', () => {
    expect(
      selectTerminalModeWatchRoots(
        state({ ...scope, root: '/tmp', repoRoot: null }),
        'folder:vtab-1'
      )
    ).toEqual(['/tmp'])
  })
})
