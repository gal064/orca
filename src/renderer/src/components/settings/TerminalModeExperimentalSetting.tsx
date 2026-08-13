import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { isTerminalModeSupportedPlatform } from '@/lib/terminal-mode'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getExperimentalSearchEntry } from './experimental-search'

type TerminalModeExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function TerminalModeExperimentalSetting({
  settings,
  updateSettings
}: TerminalModeExperimentalSettingProps): React.JSX.Element | null {
  // Windows never runs terminal mode, so it never offers the toggle either.
  if (!isTerminalModeSupportedPlatform()) {
    return null
  }

  const entry = getExperimentalSearchEntry().terminalMode
  const enabled = settings.experimentalTerminalMode === true

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-terminal-mode"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.ExperimentalPane.terminalMode.title',
              'Terminal mode'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.terminalMode.copy',
              'Replaces the left sidebar with vertical terminal tabs. Under construction — the tab list is a placeholder until terminal tabs ship. Turning this off restores the worktree sidebar unchanged.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.ExperimentalPane.terminalMode.toggleLabel',
            'Toggle terminal mode'
          )}
          onChange={() => updateSettings({ experimentalTerminalMode: !enabled })}
        />
      </div>
    </SearchableSetting>
  )
}
