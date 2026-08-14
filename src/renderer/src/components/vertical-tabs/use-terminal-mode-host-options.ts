import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { selectTerminalModeHostOptions } from '@/lib/terminal-mode-host-options'
import type { TerminalModeHostOption } from '@/lib/terminal-mode-hosts'

/**
 * React binding for the host picker surfaces. Subscribes to the six slices the
 * execution-host registry reads rather than the whole store, so a cwd fact or a
 * terminal write does not rebuild the host list.
 */
export function useTerminalModeHostOptions(): TerminalModeHostOption[] {
  const repos = useAppStore((s) => s.repos)
  const settings = useAppStore((s) => s.settings)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  return useMemo(
    () =>
      selectTerminalModeHostOptions({
        repos,
        settings,
        sshTargetLabels,
        sshConnectionStates,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId
      }),
    [
      repos,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId,
      settings,
      sshConnectionStates,
      sshTargetLabels
    ]
  )
}
