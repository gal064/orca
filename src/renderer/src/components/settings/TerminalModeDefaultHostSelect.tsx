import { translate } from '@/i18n/i18n'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/types'
import { useTerminalModeHostOptions } from '@/components/vertical-tabs/use-terminal-mode-host-options'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/**
 * Host a new vertical tab is pinned to when there is nothing to inherit from
 * (docs/terminal-mode-spec.md §2). Only offered while terminal mode is on: it is
 * meaningless in classic mode, and the list costs a registry build.
 */
export function TerminalModeDefaultHostSelect({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const hosts = useTerminalModeHostOptions()
  // Why fall back rather than show a blank trigger: a default host can be unpaired,
  // removed, or answer without the terminal-mode capability after it was chosen, and
  // `resolveNewVerticalTabHostId` falls back to local in all three cases — the picker
  // has to say the same thing, or it names a host that will not be used.
  const selected = hosts.some(
    (host) => host.id === settings.terminalModeDefaultHost && host.supported
  )
    ? settings.terminalModeDefaultHost
    : LOCAL_EXECUTION_HOST_ID

  return (
    <div className="flex items-center justify-between gap-4 pl-1">
      <Label className="text-xs font-normal text-muted-foreground">
        {translate(
          'auto.components.settings.ExperimentalPane.terminalMode.defaultHost',
          'Default host for new terminal tabs'
        )}
      </Label>
      <Select
        value={selected}
        onValueChange={(value) =>
          updateSettings({
            terminalModeDefaultHost: value as GlobalSettings['terminalModeDefaultHost']
          })
        }
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-52 text-xs"
          data-testid="terminal-mode-default-host"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hosts.map((host) => (
            <SelectItem key={host.id} value={host.id} disabled={!host.supported}>
              {host.supported
                ? host.label
                : translate(
                    'auto.components.settings.ExperimentalPane.terminalMode.hostNeedsUpdate',
                    '{{label}} — server update needed',
                    { label: host.label }
                  )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
