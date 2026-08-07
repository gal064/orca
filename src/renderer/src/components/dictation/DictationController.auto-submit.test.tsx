// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insertText: vi.fn(),
  insertTextAndSubmit: vi.fn(async () => {}),
  setDictationState: vi.fn(),
  setPartialTranscript: vi.fn(),
  recordFeatureInteraction: vi.fn(),
  startCapture: vi.fn(async () => ({})),
  stopCapture: vi.fn(),
  flushBufferedAudio: vi.fn(async () => {}),
  discardBufferedAudio: vi.fn(),
  getCapturedChunkCount: vi.fn(() => 1)
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      dictationState: 'idle',
      setDictationState: mocks.setDictationState,
      setPartialTranscript: mocks.setPartialTranscript,
      recordFeatureInteraction: mocks.recordFeatureInteraction,
      settings: {
        voice: {
          enabled: true,
          sttModel: 'local-model',
          dictationMode: 'toggle',
          autoSubmit: true
        }
      },
      keybindings: {}
    })
}))

vi.mock('@/hooks/use-audio-capture', () => ({
  useAudioCapture: () => ({
    start: mocks.startCapture,
    stop: mocks.stopCapture,
    flushBufferedAudio: mocks.flushBufferedAudio,
    discardBufferedAudio: mocks.discardBufferedAudio,
    getCapturedChunkCount: mocks.getCapturedChunkCount
  })
}))

vi.mock('./dictation-insertion-target', () => ({
  captureInsertionTarget: () => ({ kind: 'terminal', tabId: 'tab-1', paneId: 1 }),
  insertText: mocks.insertText,
  insertTextAndSubmit: mocks.insertTextAndSubmit
}))

vi.mock('./DictationIndicator', () => ({ DictationIndicator: () => null }))
vi.mock('./use-hold-dictation-gesture', () => ({ useHoldDictationGesture: () => {} }))
vi.mock('./dictation-start-error-toast', () => ({ showDictationStartErrorToast: vi.fn() }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn() })
}))

import { DictationController } from './DictationController'

type TranscriptHandler = (data: { text: string; sessionId: string }) => void
type SessionHandler = (data: { sessionId: string }) => void

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

describe('DictationController automatic submission', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('waits for transcription completion before inserting and submitting', async () => {
    let toggleDictation: (() => void) | undefined
    let onFinal: TranscriptHandler | undefined
    let onStopped: SessionHandler | undefined
    Object.assign(window, {
      api: {
        ui: {
          onDictationKeyDown: vi.fn((callback: () => void) => {
            toggleDictation = callback
            return () => {}
          })
        },
        speech: {
          startDictation: vi.fn(async () => {}),
          stopDictation: vi.fn(async () => {}),
          onPartialTranscript: vi.fn(() => () => {}),
          onFinalTranscript: vi.fn((callback: TranscriptHandler) => {
            onFinal = callback
            return () => {}
          }),
          onStopped: vi.fn((callback: SessionHandler) => {
            onStopped = callback
            return () => {}
          }),
          onError: vi.fn(() => () => {})
        }
      }
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<DictationController />)
      await flushMicrotasks()
    })

    await act(async () => {
      toggleDictation?.()
      await flushMicrotasks()
    })
    act(() => toggleDictation?.())
    act(() => onFinal?.({ text: 'delayed transcript', sessionId: '1' }))

    expect(mocks.insertText).not.toHaveBeenCalled()
    expect(mocks.insertTextAndSubmit).not.toHaveBeenCalled()

    await act(async () => {
      onStopped?.({ sessionId: '1' })
      await flushMicrotasks()
    })

    expect(mocks.insertTextAndSubmit).toHaveBeenCalledWith('delayed transcript', {
      kind: 'terminal',
      tabId: 'tab-1',
      paneId: 1
    })
    act(() => root.unmount())
  })
})
