import { describe, expect, it } from 'vitest'
import { resolveTerminalDictationPasteDetail } from './terminal-dictation-paste-detail'

describe('terminal dictation paste detail', () => {
  it('preserves the submission flag for the targeted pane', () => {
    expect(
      resolveTerminalDictationPasteDetail(
        { tabId: 'tab-1', paneId: 2, text: 'test one two', submitAfterPaste: true },
        'tab-1'
      )
    ).toEqual({ tabId: 'tab-1', paneId: 2, text: 'test one two', submitAfterPaste: true })
  })

  it('rejects dictation intended for another tab', () => {
    expect(
      resolveTerminalDictationPasteDetail({ tabId: 'tab-2', text: 'test one two' }, 'tab-1')
    ).toBeNull()
  })
})
