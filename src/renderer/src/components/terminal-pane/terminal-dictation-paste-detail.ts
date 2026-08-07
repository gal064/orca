import type { PasteTerminalTextDetail } from '@/constants/terminal'

export function resolveTerminalDictationPasteDetail(
  detail: string | Partial<PasteTerminalTextDetail> | undefined,
  tabId: string
): PasteTerminalTextDetail | null {
  const text = typeof detail === 'string' ? detail : detail?.text
  if (!text || (typeof detail === 'object' && detail.tabId && detail.tabId !== tabId)) {
    return null
  }
  return {
    tabId,
    text,
    ...(typeof detail === 'object' && typeof detail.paneId === 'number'
      ? { paneId: detail.paneId }
      : {}),
    ...(typeof detail === 'object' && detail.submitAfterPaste === true
      ? { submitAfterPaste: true }
      : {})
  }
}
