import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resolveBaselineReleaseRef } from './release-checkout'
import {
  JOURNEY_INPUTS,
  JOURNEY_STEPS,
  runTerminalSkewJourney,
  type JourneyRecord
} from './terminal-skew-journey'
import {
  loadTerminalWireBuild,
  WORKING_TREE,
  type TerminalWireBuild
} from './versioned-terminal-wire'

// Why: a cold CI run extracts the baseline checkout before the first journey.
const SUITE_TIMEOUT_MS = 180_000

/**
 * The frames one journey must produce, named rather than numbered so a diff reads
 * as a protocol change. Any deviation is a change in what a peer publishes or
 * accepts, and needs a human decision against docs/reference/remote-wire-compatibility.md.
 *
 * `Metadata` (opcode 12, host-reported cwd) is deliberately not in this list and is
 * filtered out of `frameSequence`: whether a host sends it is a per-build property
 * that predates this harness, so it gets the counted oracle in
 * `expectCwdMetadataCompatible` instead of a positional one.
 */
const EXPECTED_JOURNEY_FRAMES = [
  'C>H Subscribe',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Input',
  'H>C Output',
  // The second output crosses the transport's credit threshold; the ack is the
  // client returning that credit, and its position is part of the contract.
  'C>H Ack',
  'H>C Output',
  'C>H SnapshotRequest',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Subscribe',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Input',
  'C>H Unsubscribe'
]

let baselineRef: string
let current: TerminalWireBuild
let baseline: TerminalWireBuild

beforeAll(async () => {
  baselineRef = resolveBaselineReleaseRef()
  current = await loadTerminalWireBuild(WORKING_TREE)
  baseline = await loadTerminalWireBuild(baselineRef)
}, SUITE_TIMEOUT_MS)

afterEach(() => {
  // Each journey installs and removes its own window stub; fail loudly if one leaked.
  expect(typeof globalThis.window).toBe('undefined')
})

function expectJourneyActuallyRan(record: JourneyRecord): void {
  // The anti-vacuous-pass oracle. A harness that connects and then does nothing
  // fails here, because "nothing threw" is never enough to call a pairing green.
  expect(record.completed).toEqual([...JOURNEY_STEPS])
  expect(record.frameSequence).toEqual(EXPECTED_JOURNEY_FRAMES)
  expect(record.subscribedEvents).toHaveLength(2)
  expect(record.snapshotStarts).toHaveLength(3)
  expect(record.missingRuntimeMethods).toEqual([])
}

function expectWireCompatible(record: JourneyRecord): void {
  // Rule 2 — no frame may be refused by the receiving build's decoder. An opcode
  // the peer does not know is dropped silently, so this is the only signal.
  expect(record.rejected).toEqual([])
  expect(record.clientErrors).toEqual([])

  // The subscribe handshake still negotiates the optional output-pause opcode,
  // which is what keeps opcode 16 legal to send on this pairing.
  for (const event of record.subscribedEvents) {
    expect(event.capabilities).toEqual({ outputPause: 1 })
  }

  // Input reached the process, before and after the reconnect.
  expect(record.inputAtProcess).toEqual([JOURNEY_INPUTS.first, JOURNEY_INPUTS.second])

  // Rule 3 — what the host publishes, as the client actually rendered it.
  expect(record.snapshotsRendered[0]).toBe(JOURNEY_INPUTS.initialBuffer)
  expect(record.dataRendered.join('')).toBe(`${JOURNEY_INPUTS.output}${JOURNEY_INPUTS.cwdOutput}`)
  expect(record.revealSnapshot?.data).toBe(
    `${JOURNEY_INPUTS.initialBuffer}${JOURNEY_INPUTS.output}${JOURNEY_INPUTS.cwdOutput}`
  )
  expect(record.revealSnapshot).toMatchObject({ cols: 120, rows: 40 })
  for (const start of record.snapshotStarts) {
    expect(start).toMatchObject({ kind: 'scrollback', cols: 120, rows: 40, source: 'headless' })
  }
}

/**
 * The cwd side channel terminal mode's remote panels ride on. Nothing new is sent —
 * the frame shipped long before this feature — so the contract is: it is never
 * refused, never rendered as terminal output, and never acknowledged. A client that
 * predates the decode simply reports no directory.
 */
function expectCwdCompatible(record: JourneyRecord, clientReadsCwd: boolean): void {
  // The host publishes both, on every build: the tracked directory on SnapshotStart
  // and a live `cd` on a Metadata frame.
  expect(record.metadataFrames).toBeGreaterThan(0)
  for (const start of record.snapshotStarts) {
    expect(start.cwd).toBe(JOURNEY_INPUTS.snapshotCwd)
  }
  // Neither may ever reach the pane as terminal output.
  expect(record.dataRendered.join('')).not.toContain(JOURNEY_INPUTS.reportedCwd)
  expect(record.dataRendered.join('')).not.toContain(JOURNEY_INPUTS.snapshotCwd)
  expect(record.snapshotsRendered.join('')).not.toContain(JOURNEY_INPUTS.reportedCwd)
  // A client that predates the decode reports nothing and must not error.
  expect(new Set(record.cwdReported)).toEqual(
    clientReadsCwd ? new Set([JOURNEY_INPUTS.snapshotCwd, JOURNEY_INPUTS.reportedCwd]) : new Set()
  )
}

describe('cross-version remote terminal wire', () => {
  it(
    'skews current code against a real published release',
    () => {
      expect(baselineRef).toMatch(/^v?\d/)
      expect(baseline.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(baseline.revision).not.toBe(current.revision)
    },
    SUITE_TIMEOUT_MS
  )

  it(
    'current client against current server completes the journey',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: current, clientBuild: current })
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      expectCwdCompatible(record, true)
    },
    SUITE_TIMEOUT_MS
  )

  it(
    'old client against new server completes the journey',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: current, clientBuild: baseline })
      expect(record.clientRevision).toBe(baseline.revision)
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      // The new host still publishes both; an old client must drop them silently.
      expectCwdCompatible(record, false)
    },
    SUITE_TIMEOUT_MS
  )

  it(
    'new client against old server completes the journey',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: baseline, clientBuild: current })
      expect(record.hostRevision).toBe(baseline.revision)
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      // The baseline only moves forward and both carriers predate this phase, so the
      // older host publishes them too — and the new client reads them without ever
      // requiring them.
      expectCwdCompatible(record, true)
    },
    SUITE_TIMEOUT_MS
  )
})
