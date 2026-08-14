import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
  SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY,
  TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY
} from './protocol-version'
import {
  declareRemoteRuntimeClientCapabilities,
  getRemoteRuntimeClientCapabilities,
  resetRemoteRuntimeClientCapabilitiesForTests
} from './remote-runtime-client-capabilities'

afterEach(() => {
  resetRemoteRuntimeClientCapabilitiesForTests()
})

describe('remote runtime client capabilities', () => {
  it('advertises only the unconditional set by default', () => {
    // The CLI and headless `orca serve` share this transport and never declare
    // anything: a host must keep giving them its filtered catalog.
    expect(getRemoteRuntimeClientCapabilities()).toEqual([
      SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY,
      AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY
    ])
    expect(getRemoteRuntimeClientCapabilities()).not.toContain(
      TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY
    )
  })

  it('adds a declared token once, however often it is declared', () => {
    declareRemoteRuntimeClientCapabilities([TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY])
    declareRemoteRuntimeClientCapabilities([TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY])
    expect(
      getRemoteRuntimeClientCapabilities().filter(
        (capability) => capability === TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY
      )
    ).toHaveLength(1)
  })

  it('keeps the base set when a token is declared', () => {
    declareRemoteRuntimeClientCapabilities([TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY])
    expect(getRemoteRuntimeClientCapabilities()).toEqual([
      SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY,
      AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY,
      TERMINAL_MODE_CATALOG_CLIENT_CAPABILITY
    ])
  })
})
