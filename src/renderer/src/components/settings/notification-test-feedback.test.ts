import { describe, expect, it } from 'vitest'
import { resolveNotificationTestFeedback } from './notification-test-feedback'

describe('resolveNotificationTestFeedback', () => {
  it('confirms a delivered test', () => {
    expect(resolveNotificationTestFeedback('delivered', { hasPermissionCard: true })).toEqual({
      tone: 'muted',
      message: 'Sent'
    })
  })

  it('points a blocked test at the banner that explains it', () => {
    expect(resolveNotificationTestFeedback('not-displayed', { hasPermissionCard: true })).toEqual({
      tone: 'warning',
      message: 'Not delivered — see the alert above'
    })
  })

  it('says what happened when there is no banner to point at', () => {
    expect(resolveNotificationTestFeedback('not-displayed', { hasPermissionCard: false })).toEqual({
      tone: 'warning',
      message: 'Not delivered — your system blocked it'
    })
  })

  it('reports a test that never went out', () => {
    expect(resolveNotificationTestFeedback('not-sent', { hasPermissionCard: false })).toEqual({
      tone: 'warning',
      message: 'Not sent'
    })
  })
})
