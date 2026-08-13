import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getTerminalModeExperimentalSearchEntry = createLocalizedCatalog(
  (): SettingsSearchEntry => ({
    title: translate(
      'auto.components.settings.experimental.search.terminalMode.title',
      'Terminal mode'
    ),
    description: translate(
      'auto.components.settings.experimental.search.terminalMode.description',
      'Terminal-first left sidebar: vertical terminal tabs instead of the worktree list.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.9bb3bd5098',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalMode.terminalMode',
        'terminal mode'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalMode.tabs',
        'tabs'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalMode.verticalTabs',
        'vertical tabs'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.fe5688b761',
        'sidebar'
      )
    ],
    targetSectionId: 'experimental-terminal-mode'
  })
)
