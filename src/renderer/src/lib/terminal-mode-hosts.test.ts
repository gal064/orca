import { describe, expect, it } from 'vitest'
import type { ExecutionHostRegistryEntry } from '../../../shared/execution-host-registry'
import { TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import {
  buildTerminalModeHostOptions,
  getTerminalModeHostRoute,
  isTerminalModeHostSupported,
  resolveNewVerticalTabHostId
} from './terminal-mode-hosts'

function host(entry: Partial<ExecutionHostRegistryEntry>): ExecutionHostRegistryEntry {
  return {
    id: 'local',
    kind: 'local',
    label: 'Local',
    detail: 'This computer',
    health: 'local',
    ...entry
  } as ExecutionHostRegistryEntry
}

const LOCAL = host({})
const SSH = host({ id: 'ssh:box', kind: 'ssh', label: 'box', health: 'available' })
const NEW_RUNTIME = host({
  id: 'runtime:env-1',
  kind: 'runtime',
  label: 'Server',
  health: 'available',
  capabilities: [TERMINAL_MODE_VERTICAL_TABS_RUNTIME_CAPABILITY]
})
const OLD_RUNTIME = host({
  id: 'runtime:env-old',
  kind: 'runtime',
  label: 'Old server',
  health: 'available',
  capabilities: ['terminal.multiplex.v1']
})

describe('buildTerminalModeHostOptions', () => {
  it('marks a runtime host unsupported until it advertises the terminal-mode token', () => {
    const options = buildTerminalModeHostOptions([LOCAL, SSH, NEW_RUNTIME, OLD_RUNTIME])
    expect(options.map((option) => [option.id, option.supported])).toEqual([
      ['local', true],
      ['ssh:box', true],
      ['runtime:env-1', true],
      ['runtime:env-old', false]
    ])
  })

  it('keeps an unsupported host listed so it does not read as disconnected', () => {
    expect(buildTerminalModeHostOptions([OLD_RUNTIME])).toHaveLength(1)
  })

  it('keeps a runtime host whose status has not arrived selectable', () => {
    // "We have not asked yet" is not "too old"; the create path asserts the capability,
    // so an unprobed host costs one clear error rather than a wrong label.
    const options = buildTerminalModeHostOptions([
      host({ id: 'runtime:env-2', kind: 'runtime', label: 'Unknown', health: 'connecting' })
    ])
    expect(options[0]?.supported).toBe(true)
  })

  it('marks a runtime host that answered without the token unsupported', () => {
    const options = buildTerminalModeHostOptions([
      host({
        id: 'runtime:env-3',
        kind: 'runtime',
        label: 'Bare',
        health: 'available',
        capabilities: []
      })
    ])
    expect(options[0]?.supported).toBe(false)
  })
})

describe('resolveNewVerticalTabHostId', () => {
  const availableHosts = buildTerminalModeHostOptions([LOCAL, SSH, NEW_RUNTIME, OLD_RUNTIME])

  it('honors an explicit pick from the dropdown above everything else', () => {
    expect(
      resolveNewVerticalTabHostId({
        requestedHostId: 'runtime:env-1',
        inheritedHostId: 'local',
        defaultHostId: 'ssh:box',
        availableHosts
      })
    ).toBe('runtime:env-1')
  })

  it('inherits the focused terminal host before the configured default', () => {
    expect(
      resolveNewVerticalTabHostId({
        inheritedHostId: 'ssh:box',
        defaultHostId: 'runtime:env-1',
        availableHosts
      })
    ).toBe('ssh:box')
  })

  it('uses the configured default when nothing is focused', () => {
    expect(resolveNewVerticalTabHostId({ defaultHostId: 'runtime:env-1', availableHosts })).toBe(
      'runtime:env-1'
    )
  })

  it('falls back to local when nothing is focused and no default is set', () => {
    expect(resolveNewVerticalTabHostId({ availableHosts })).toBe('local')
  })

  it('falls back past a default host that is gone', () => {
    expect(
      resolveNewVerticalTabHostId({ defaultHostId: 'runtime:env-removed', availableHosts })
    ).toBe('local')
  })

  it('falls back past a default host that cannot serve vertical tabs', () => {
    expect(resolveNewVerticalTabHostId({ defaultHostId: 'runtime:env-old', availableHosts })).toBe(
      'local'
    )
  })

  it('falls back past an inherited host that is gone, to the default', () => {
    expect(
      resolveNewVerticalTabHostId({
        inheritedHostId: 'runtime:env-removed',
        defaultHostId: 'ssh:box',
        availableHosts
      })
    ).toBe('ssh:box')
  })

  it('ignores a malformed host id', () => {
    expect(
      resolveNewVerticalTabHostId({
        requestedHostId: '   ' as never,
        defaultHostId: null,
        availableHosts
      })
    ).toBe('local')
  })
})

describe('isTerminalModeHostSupported', () => {
  it('is false for a host that is not in the list at all', () => {
    expect(isTerminalModeHostSupported(buildTerminalModeHostOptions([LOCAL]), 'ssh:box')).toBe(
      false
    )
  })
})

describe('getTerminalModeHostRoute', () => {
  it('maps each host id to the transport that owns it', () => {
    expect(getTerminalModeHostRoute('local')).toEqual({ kind: 'local' })
    expect(getTerminalModeHostRoute('ssh:box')).toEqual({ kind: 'ssh', connectionId: 'box' })
    expect(getTerminalModeHostRoute('runtime:env-1')).toEqual({
      kind: 'runtime',
      environmentId: 'env-1'
    })
  })

  it('decodes an encoded host segment', () => {
    expect(getTerminalModeHostRoute('ssh:my%20box')).toEqual({
      kind: 'ssh',
      connectionId: 'my box'
    })
  })
})
