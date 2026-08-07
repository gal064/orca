// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TEXT_CONTROL_PASTE_CHUNK_MAX_BYTES,
  TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES,
  TEXT_CONTROL_PASTE_MAX_BYTES,
  getTextControlPasteByteLength
} from '@/lib/text-control-paste'
import { insertText, insertTextAndSubmit } from './dictation-insertion-target'

type DocumentWithExecCommand = Document & {
  execCommand?: (commandId: string, showUi?: boolean, value?: string) => boolean
}

const originalExecCommand = (document as DocumentWithExecCommand).execCommand

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: originalExecCommand
  })
})

function appendTextarea(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  textarea.focus()
  return textarea
}

function appendContentEditable(): HTMLElement {
  const element = document.createElement('div')
  element.contentEditable = 'true'
  element.tabIndex = 0
  document.body.appendChild(element)
  element.focus()
  return element
}

function installExecCommandMock(
  implementation: (commandId: string, showUi?: boolean, value?: string) => boolean
): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn(implementation)
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommand
  })
  return execCommand
}

describe('dictation insertion target', () => {
  it('dispatches terminal dictation with the captured pane target', () => {
    const listener = vi.fn()
    document.addEventListener('dictation:insertText', listener)

    insertText('git status', { kind: 'terminal', tabId: 'tab-1', paneId: 7 })

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: 'git status',
      tabId: 'tab-1',
      paneId: 7
    })
  })

  it('marks terminal dictation for submission after the paste completes', async () => {
    const listener = vi.fn()
    document.addEventListener('dictation:insertText', listener)

    await insertTextAndSubmit('git status', { kind: 'terminal', tabId: 'tab-1', paneId: 7 })

    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: 'git status',
      tabId: 'tab-1',
      paneId: 7,
      submitAfterPaste: true
    })
  })

  it('submits a marked text target only after dictated text is inserted', async () => {
    vi.useFakeTimers()
    const textarea = appendTextarea()
    textarea.dataset.dictationSubmit = 'enter'
    const valuesAtSubmit: string[] = []
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        valuesAtSubmit.push(textarea.value)
      }
    })

    const insertion = insertTextAndSubmit('ship it', { kind: 'text', element: textarea })
    await vi.runAllTimersAsync()
    await insertion

    expect(valuesAtSubmit).toEqual(['ship it'])
  })

  it('does not submit an ordinary text target', async () => {
    const textarea = appendTextarea()
    const keydown = vi.fn()
    textarea.addEventListener('keydown', keydown)

    await insertTextAndSubmit('keep editing', { kind: 'text', element: textarea })

    expect(textarea.value).toBe('keep editing')
    expect(keydown).not.toHaveBeenCalled()
  })

  it('chunks large textarea dictation without one large input event', async () => {
    vi.useFakeTimers()
    const textarea = appendTextarea()
    const inputEvents: InputEvent[] = []
    textarea.addEventListener('input', (event) => inputEvents.push(event as InputEvent))
    const text = 'a'.repeat(TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES + 5)

    insertText(text, { kind: 'text', element: textarea })
    await vi.runAllTimersAsync()

    expect(textarea.value).toBe(text)
    expect(inputEvents).toHaveLength(1)
    expect(inputEvents[0].inputType).toBe('insertText')
    expect(inputEvents[0].data ?? '').toBe('')
  })

  it('chunks large contenteditable dictation through bounded insertText calls', async () => {
    vi.useFakeTimers()
    const editor = appendContentEditable()
    const beforeInputEvents: InputEvent[] = []
    editor.addEventListener('beforeinput', (event) => beforeInputEvents.push(event as InputEvent))
    const execCommand = installExecCommandMock(() => true)
    const text = 'ab\u{1f600}'.repeat(20_000)

    insertText(text, { kind: 'contentEditable', element: editor })
    await vi.runAllTimersAsync()

    expect(execCommand.mock.calls.length).toBeGreaterThan(1)
    expect(
      execCommand.mock.calls.every(
        (call) =>
          getTextControlPasteByteLength(String(call[2] ?? '')) <= TEXT_CONTROL_PASTE_CHUNK_MAX_BYTES
      )
    ).toBe(true)
    expect(beforeInputEvents).toHaveLength(execCommand.mock.calls.length)
    expect(beforeInputEvents.some((event) => event.data === text)).toBe(false)
  })

  it('waits for yielded contenteditable dictation preflight before inserting large text', async () => {
    vi.useFakeTimers()
    const editor = appendContentEditable()
    const execCommand = installExecCommandMock(() => true)
    const text = 'x'.repeat(TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES + 10)

    insertText(text, { kind: 'contentEditable', element: editor })

    expect(execCommand).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(execCommand).toHaveBeenCalled()
  })

  it('cancels chunked contenteditable dictation when the target disconnects', async () => {
    vi.useFakeTimers()
    const editor = appendContentEditable()
    const execCommand = installExecCommandMock(() => {
      editor.remove()
      return true
    })
    const text = 'x'.repeat(TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES + 1)

    insertText(text, { kind: 'contentEditable', element: editor })
    await vi.runAllTimersAsync()

    expect(execCommand).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized multibyte contenteditable dictation before inserting', async () => {
    vi.useFakeTimers()
    const editor = appendContentEditable()
    const beforeInputEvents: InputEvent[] = []
    editor.addEventListener('beforeinput', (event) => beforeInputEvents.push(event as InputEvent))
    const execCommand = installExecCommandMock(() => true)
    const text = '😀'.repeat(Math.floor(TEXT_CONTROL_PASTE_MAX_BYTES / 4) + 1)

    insertText(text, { kind: 'contentEditable', element: editor })
    await vi.runAllTimersAsync()

    expect(execCommand).not.toHaveBeenCalled()
    expect(beforeInputEvents).toHaveLength(0)
    expect(editor.textContent).toBe('')
  })
})
