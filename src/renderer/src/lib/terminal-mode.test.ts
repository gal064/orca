import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTerminalMode, isTerminalModeSupportedPlatform } from './terminal-mode'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isTerminalModeSupportedPlatform', () => {
  it('supports macOS and Linux but not Windows', () => {
    expect(isTerminalModeSupportedPlatform('darwin')).toBe(true)
    expect(isTerminalModeSupportedPlatform('linux')).toBe(true)
    expect(isTerminalModeSupportedPlatform('win32')).toBe(false)
  })
})

describe('isTerminalMode', () => {
  it('is off until the experimental flag is explicitly enabled', () => {
    expect(isTerminalMode(null, 'linux')).toBe(false)
    expect(isTerminalMode(undefined, 'linux')).toBe(false)
    expect(isTerminalMode({}, 'linux')).toBe(false)
    expect(isTerminalMode({ experimentalTerminalMode: false }, 'linux')).toBe(false)
  })

  it('is on with the flag enabled on supported platforms', () => {
    expect(isTerminalMode({ experimentalTerminalMode: true }, 'linux')).toBe(true)
    expect(isTerminalMode({ experimentalTerminalMode: true }, 'darwin')).toBe(true)
  })

  it('stays off on Windows even with the flag enabled', () => {
    expect(isTerminalMode({ experimentalTerminalMode: true }, 'win32')).toBe(false)
    expect(isTerminalMode({ experimentalTerminalMode: false }, 'win32')).toBe(false)
  })

  it('defaults to the running renderer platform', () => {
    vi.stubGlobal('window', { api: { platform: { get: () => ({ platform: 'win32' }) } } })
    expect(isTerminalMode({ experimentalTerminalMode: true })).toBe(false)

    vi.stubGlobal('window', { api: { platform: { get: () => ({ platform: 'darwin' }) } } })
    expect(isTerminalMode({ experimentalTerminalMode: true })).toBe(true)
  })
})
