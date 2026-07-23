import { describe, expect, it } from 'vitest'
import { WorktreeActivate, WorktreeCreate } from './worktree-schemas'

describe('worktree RPC schemas', () => {
  it('validates additive navigation intent', () => {
    expect(WorktreeActivate.parse({ worktree: 'id:wt-1', navigation: 'clients' }).navigation).toBe(
      'clients'
    )
    expect(
      WorktreeActivate.safeParse({ worktree: 'id:wt-1', navigation: 'everyone' }).success
    ).toBe(false)
  })

  it('rejects invalid startup agent values', () => {
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'agent-startup',
      startupAgent: 'wat',
      startupPrompt: 'hi'
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects startup prompts without startup agents', () => {
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'agent-startup',
      startupPrompt: 'hi'
    })

    expect(parsed.success).toBe(false)
  })

  it('preserves reuseCheckout so remote-server creates skip git worktree add', () => {
    // Why: Zod strips unknown keys by default; without the schema field the
    // flag would be dropped and the server would create a real worktree instead.
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'reuse',
      reuseCheckout: true
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.reuseCheckout).toBe(true)
  })

  it('leaves reuseCheckout undefined when omitted', () => {
    const parsed = WorktreeCreate.safeParse({ repo: 'repo-1', name: 'plain' })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.reuseCheckout).toBeUndefined()
  })
})
