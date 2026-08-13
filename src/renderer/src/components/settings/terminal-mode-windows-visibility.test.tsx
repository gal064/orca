// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'

// Why: exercise the real predicate against a faked renderer platform, so the row
// and the search index are proven to move together.
async function loadSettingsSurfaceForPlatform(platform: NodeJS.Platform) {
  vi.resetModules()
  vi.doMock('@/lib/renderer-app-platform', () => ({
    getRendererAppPlatform: () => platform
  }))
  vi.doMock('../../store', () => ({
    useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
      selector({ settingsSearchQuery: '' })
  }))
  const [{ getExperimentalPaneSearchEntries }, { TerminalModeExperimentalSetting }] =
    await Promise.all([
      import('./experimental-search'),
      import('./TerminalModeExperimentalSetting')
    ])
  return {
    searchEntryTitles: getExperimentalPaneSearchEntries().map((entry) => entry.title),
    markup: renderToStaticMarkup(
      <TerminalModeExperimentalSetting
        settings={getDefaultSettings('/tmp')}
        updateSettings={vi.fn()}
      />
    )
  }
}

afterEach(() => {
  vi.doUnmock('@/lib/renderer-app-platform')
  vi.doUnmock('../../store')
  vi.resetModules()
})

describe('terminal mode settings visibility', () => {
  it('renders the row and indexes it for search on Linux', async () => {
    const { markup, searchEntryTitles } = await loadSettingsSurfaceForPlatform('linux')

    expect(markup).toContain('Terminal mode')
    expect(searchEntryTitles).toContain('Terminal mode')
  })

  it('renders the row and indexes it for search on macOS', async () => {
    const { markup, searchEntryTitles } = await loadSettingsSurfaceForPlatform('darwin')

    expect(markup).toContain('Terminal mode')
    expect(searchEntryTitles).toContain('Terminal mode')
  })

  it('hides the row and drops the search entry on Windows', async () => {
    const { markup, searchEntryTitles } = await loadSettingsSurfaceForPlatform('win32')

    expect(markup).toBe('')
    expect(searchEntryTitles).not.toContain('Terminal mode')
  })
})
