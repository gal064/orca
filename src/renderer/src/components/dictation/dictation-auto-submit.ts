import {
  insertText,
  insertTextAndSubmit,
  type DictationInsertionTarget
} from './dictation-insertion-target'

export function deliverFinalDictationSegment(
  text: string,
  target: DictationInsertionTarget,
  autoSubmit: boolean
): void {
  if (!autoSubmit) {
    insertText(text, target)
  }
}

export async function submitCompletedDictation(args: {
  autoSubmit: boolean
  sessionErrored: boolean
  target: DictationInsertionTarget | null
  text: string
}): Promise<void> {
  if (!args.sessionErrored && args.autoSubmit && args.target && args.text) {
    await insertTextAndSubmit(args.text, args.target)
  }
}
