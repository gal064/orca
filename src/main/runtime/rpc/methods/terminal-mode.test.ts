import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_MODE_METHODS } from './terminal-mode'
import { ALL_RPC_METHODS } from './index'
import {
  ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY,
  RUNTIME_CAPABILITIES,
  TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY,
  TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY,
  isTerminalModeRuntimeCapability
} from '../../../../shared/protocol-version'

function method(name: string) {
  const found = TERMINAL_MODE_METHODS.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`missing method ${name}`)
  }
  return found
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    runtime: {
      ensureTerminalModeContext: vi.fn(() => ({
        projectGroup: { id: 'hidden' },
        homeDir: '/home/host'
      })),
      setTerminalModePathScope: vi.fn(async () => ({ accepted: true, repoRoot: null }))
    },
    ...overrides
  } as never
}

describe('terminalMode RPC surface', () => {
  it('is registered on the host', () => {
    const names = ALL_RPC_METHODS.map((entry) => entry.name)
    expect(names).toContain('terminalMode.ensureContext')
    expect(names).toContain('terminalMode.setPathScope')
  })

  it('answers a desktop runtime client', async () => {
    const ctx = context()
    expect(await method('terminalMode.ensureContext').handler(undefined, ctx)).toMatchObject({
      homeDir: '/home/host'
    })
    expect(
      await method('terminalMode.setPathScope').handler(
        { workspaceKey: 'folder:vtab', root: '/tmp' },
        ctx
      )
    ).toEqual({ accepted: true, repoRoot: null })
  })

  it('refuses a paired mobile client outright', async () => {
    const ctx = context({ clientKind: 'mobile' })
    await expect(
      (async () => method('terminalMode.ensureContext').handler(undefined, ctx))()
    ).rejects.toThrow('terminal_mode_unavailable_for_mobile_clients')
    await expect(
      (async () =>
        method('terminalMode.setPathScope').handler(
          { workspaceKey: 'folder:vtab', root: '/tmp' },
          ctx
        ))()
    ).rejects.toThrow('terminal_mode_unavailable_for_mobile_clients')
  })

  it('accepts a null root as the revoke form', () => {
    const schema = method('terminalMode.setPathScope').params
    expect(schema?.safeParse({ workspaceKey: 'folder:vtab', root: null }).success).toBe(true)
    expect(schema?.safeParse({ workspaceKey: '', root: '/tmp' }).success).toBe(false)
    expect(schema?.safeParse({ workspaceKey: 'folder:vtab' }).success).toBe(false)
  })
})

describe('terminal-mode capability tokens', () => {
  it('advertises the two host tokens Phase 4 turns on', () => {
    expect(RUNTIME_CAPABILITIES).toContain(TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY)
    expect(RUNTIME_CAPABILITIES).toContain(ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY)
  })

  it('never advertises the client-side catalog token as a host capability', () => {
    // A host answering it would claim it filters its own vertical tabs, which is
    // exactly the opposite of what the token means.
    expect(RUNTIME_CAPABILITIES as readonly string[]).not.toContain(
      TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY
    )
  })

  it('names exactly the tokens the E2E suppression switch withholds', () => {
    expect(isTerminalModeRuntimeCapability(TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY)).toBe(
      true
    )
    expect(isTerminalModeRuntimeCapability(ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY)).toBe(true)
    expect(isTerminalModeRuntimeCapability('terminal.multiplex.v1')).toBe(false)
    expect(isTerminalModeRuntimeCapability(TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY)).toBe(false)
  })
})
