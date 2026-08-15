import { translate } from '@/i18n/i18n'
import type { NotificationTestOutcome } from './notification-settings-copy'

export type NotificationTestFeedback = {
  tone: 'muted' | 'warning'
  message: string
}

/**
 * Inline result for the "Send Test Notification" button. It exists because the
 * darwin path suppresses its toasts whenever the permission card is on screen
 * (the card is the delivery state), which left a blocked click with no feedback
 * at all: the card already said "blocked" and nothing else changed.
 */
export function resolveNotificationTestFeedback(
  outcome: NotificationTestOutcome,
  options: { hasPermissionCard: boolean }
): NotificationTestFeedback {
  switch (outcome) {
    case 'delivered':
      return {
        tone: 'muted',
        message: translate('auto.components.settings.notificationTestFeedback.sent', 'Sent')
      }
    case 'not-displayed':
      return {
        tone: 'warning',
        message: options.hasPermissionCard
          ? translate(
              'auto.components.settings.notificationTestFeedback.blockedWithCard',
              'Not delivered — see the alert above'
            )
          : translate(
              'auto.components.settings.notificationTestFeedback.blocked',
              'Not delivered — your system blocked it'
            )
      }
    case 'not-sent':
      return {
        tone: 'warning',
        message: translate('auto.components.settings.notificationTestFeedback.notSent', 'Not sent')
      }
  }
}

/** Long enough to read, short enough that a stale result never explains a new click. */
export const NOTIFICATION_TEST_FEEDBACK_TIMEOUT_MS = 6000
