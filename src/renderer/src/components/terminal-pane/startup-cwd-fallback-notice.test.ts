import { describe, expect, it } from 'vitest'
import { getStartupCwdFallbackNotice } from './startup-cwd-fallback-notice'

describe('getStartupCwdFallbackNotice', () => {
  it('distinguishes a deleted start folder from an unreadable one', () => {
    expect(
      getStartupCwdFallbackNotice({ kind: 'worktree', reason: 'missing', cwd: '/a' })
    ).toContain('no longer exists')
    expect(
      getStartupCwdFallbackNotice({ kind: 'worktree', reason: 'inaccessible', cwd: '/a' })
    ).toContain('is not accessible')
  })

  it('names the home directory when that is where the terminal opened', () => {
    const notice = getStartupCwdFallbackNotice({ kind: 'home', reason: 'inaccessible', cwd: '/h' })
    expect(notice).toContain('home directory')
    expect(notice).toContain('is not accessible')
  })

  it('never leaks the rejected path and stays terminal-framed', () => {
    const notice = getStartupCwdFallbackNotice({
      kind: 'worktree',
      reason: 'inaccessible',
      cwd: '/secret/project'
    })
    expect(notice).not.toContain('/secret/project')
    expect(notice.startsWith('\r\n[')).toBe(true)
    expect(notice.endsWith(']\r\n')).toBe(true)
  })
})
