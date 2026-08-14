import { describe, expect, it } from 'vitest'
import {
  isPathInsideWorkspaceRoot,
  requiresAbsolutePathScope,
  resolveTerminalModeGitRoot,
  resolveTerminalModePanelRoot,
  type TerminalModePanelRootInput
} from './terminal-mode-panel-root'

function input(overrides: Partial<TerminalModePanelRootInput> = {}): TerminalModePanelRootInput {
  return {
    pwd: '/repo/src',
    workspaceRoot: '/repo',
    pwdStatus: 'valid',
    absolutePathScope: 'not-required',
    lastValidRoot: null,
    ...overrides
  }
}

describe('resolveTerminalModePanelRoot', () => {
  it('follows the literal pwd once it resolves on the host', () => {
    expect(resolveTerminalModePanelRoot(input())).toEqual({
      root: '/repo/src',
      clampedToWorkspaceRoot: false,
      foreignPwd: false
    })
  })

  it('follows a pwd outside the workspace root', () => {
    expect(resolveTerminalModePanelRoot(input({ pwd: '/tmp' })).root).toBe('/tmp')
  })

  it('falls back to the start directory when no pwd is known', () => {
    expect(resolveTerminalModePanelRoot(input({ pwd: null })).root).toBe('/repo')
  })

  it('waits on the last valid root while the host has not confirmed the pwd', () => {
    const result = resolveTerminalModePanelRoot(
      input({ pwdStatus: 'unknown', lastValidRoot: '/repo/lib' })
    )
    expect(result).toEqual({
      root: '/repo/lib',
      clampedToWorkspaceRoot: false,
      foreignPwd: false
    })
  })

  it('stays on the last valid root for a foreign pwd and flags it', () => {
    const result = resolveTerminalModePanelRoot(
      input({ pwd: '/remote/only', pwdStatus: 'foreign', lastValidRoot: '/repo/lib' })
    )
    expect(result).toEqual({
      root: '/repo/lib',
      clampedToWorkspaceRoot: false,
      foreignPwd: true
    })
  })

  it('falls back to the start directory for a foreign pwd with no history', () => {
    const result = resolveTerminalModePanelRoot(
      input({ pwd: '/remote/only', pwdStatus: 'foreign' })
    )
    expect(result.root).toBe('/repo')
    expect(result.foreignPwd).toBe(true)
  })

  it('clamps to the workspace root when the host cannot address absolute paths', () => {
    const result = resolveTerminalModePanelRoot(
      input({ pwd: '/tmp', absolutePathScope: 'unavailable' })
    )
    expect(result).toEqual({
      root: '/repo',
      clampedToWorkspaceRoot: true,
      foreignPwd: false
    })
  })

  it('does not clamp when the host advertises the capability', () => {
    expect(
      resolveTerminalModePanelRoot(input({ pwd: '/tmp', absolutePathScope: 'available' })).root
    ).toBe('/tmp')
  })
})

describe('requiresAbsolutePathScope', () => {
  it('is false for local and ssh workspaces, whose file APIs take absolute paths', () => {
    expect(requiresAbsolutePathScope('local', '/repo', '/tmp')).toBe(false)
    expect(requiresAbsolutePathScope('ssh', '/repo', '/tmp')).toBe(false)
  })

  it('is false for a remote workspace sitting exactly on its start folder', () => {
    expect(requiresAbsolutePathScope('runtime', '/repo', '/repo')).toBe(false)
  })

  it('is false for a remote pwd inside the start folder, which relative paths address', () => {
    // Phase 4 threaded the workspace root through every explorer call site, so a
    // subdirectory is addressable with the relative contract every host answers.
    expect(requiresAbsolutePathScope('runtime', '/repo', '/repo/src')).toBe(false)
  })

  it('is true for a remote pwd outside the start folder', () => {
    expect(requiresAbsolutePathScope('runtime', '/repo', '/tmp')).toBe(true)
    expect(requiresAbsolutePathScope('runtime', '/repo', '/repo-other')).toBe(true)
    expect(requiresAbsolutePathScope('runtime', null, '/tmp')).toBe(true)
  })
})

describe('isPathInsideWorkspaceRoot', () => {
  it('accepts the root itself and its descendants only', () => {
    expect(isPathInsideWorkspaceRoot('/repo', '/repo')).toBe(true)
    expect(isPathInsideWorkspaceRoot('/repo', '/repo/a/b')).toBe(true)
    expect(isPathInsideWorkspaceRoot('/repo', '/repository')).toBe(false)
    expect(isPathInsideWorkspaceRoot(null, '/repo')).toBe(false)
  })
})

describe('resolveTerminalModeGitRoot', () => {
  it('follows the pwd repository on local and ssh workspaces', () => {
    expect(resolveTerminalModeGitRoot('local', '/repo', '/repo/sub')).toBe('/repo')
    expect(resolveTerminalModeGitRoot('ssh', '/repo', '/repo/sub')).toBe('/repo')
    expect(resolveTerminalModeGitRoot('local', null, '/repo')).toBeNull()
  })

  it('stays undefined while the lookup has not answered', () => {
    expect(resolveTerminalModeGitRoot('local', undefined, '/repo')).toBeUndefined()
    expect(resolveTerminalModeGitRoot('runtime', undefined, '/repo')).toBeUndefined()
  })

  it('shows a remote workspace only its own root, whose selector every git RPC resolves', () => {
    expect(resolveTerminalModeGitRoot('runtime', '/repo', '/repo')).toBe('/repo')
    expect(resolveTerminalModeGitRoot('runtime', '/repo', '/repo/sub')).toBeNull()
    expect(resolveTerminalModeGitRoot('runtime', null, '/repo')).toBeNull()
  })
})
