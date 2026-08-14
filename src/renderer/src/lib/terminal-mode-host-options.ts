// Why here and not under `store/`: the vertical-tabs slice needs this selector, and
// importing it from a module that pulls in `store/index` closes an import cycle that
// leaves the store undefined at construction time. The React binding lives in
// components/vertical-tabs/use-terminal-mode-host-options.ts.
import type { AppState } from '@/store/types'
import { buildExecutionHostRegistry } from '../../../shared/execution-host-registry'
import { getHostDisplayLabelOverrides } from '../../../shared/host-setting-overrides'
import { buildTerminalModeHostOptions, type TerminalModeHostOption } from './terminal-mode-hosts'

type TerminalModeHostState = Pick<
  AppState,
  | 'repos'
  | 'settings'
  | 'sshTargetLabels'
  | 'sshConnectionStates'
  | 'runtimeEnvironments'
  | 'runtimeStatusByEnvironmentId'
>

/**
 * Hosts offered by the "+" dropdown and the default-host setting.
 *
 * `configured-only` on purpose: the classic sidebar also lists hosts merely
 * *referenced* by a project so its rows never disappear, but a vertical tab is
 * created from nothing — offering a host the user has not configured would produce
 * a tab whose terminals cannot spawn.
 */
export function selectTerminalModeHostOptions(
  state: TerminalModeHostState
): TerminalModeHostOption[] {
  return buildTerminalModeHostOptions(
    buildExecutionHostRegistry({
      repos: state.repos,
      settings: state.settings,
      hostSource: 'configured-only',
      sshTargetLabels: state.sshTargetLabels,
      sshConnectionStates: state.sshConnectionStates,
      runtimeEnvironments: state.runtimeEnvironments,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId,
      hostLabelOverrides: getHostDisplayLabelOverrides(state.settings)
    })
  )
}
