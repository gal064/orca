import type { GlobalSettings } from '../../../shared/types'
import { getRendererAppPlatform } from './renderer-app-platform'

/** Windows is out of scope for terminal mode, so the flag can never activate there
 *  (docs/terminal-mode-spec.md §2) — the settings row is hidden for the same reason. */
export function isTerminalModeSupportedPlatform(
  platform: NodeJS.Platform = getRendererAppPlatform()
): boolean {
  return platform !== 'win32'
}

export function isTerminalMode(
  settings: Pick<GlobalSettings, 'experimentalTerminalMode'> | null | undefined,
  platform: NodeJS.Platform = getRendererAppPlatform()
): boolean {
  return settings?.experimentalTerminalMode === true && isTerminalModeSupportedPlatform(platform)
}
