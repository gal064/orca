import type { GlobalSettings } from '../../../../shared/types'

/** Whether either sidebar may show the Agents row. Its own file so terminal
 *  mode can share the policy without importing the classic nav component. */
export function shouldShowAgentsButton(
  settings: Pick<GlobalSettings, 'experimentalActivity'> | null | undefined
): boolean {
  return settings?.experimentalActivity === true
}
