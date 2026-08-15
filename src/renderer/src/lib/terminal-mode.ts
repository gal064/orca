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
  platform?: NodeJS.Platform
): boolean {
  // Why not a default parameter: this runs on every store write through the
  // close-path guards and the main-pane selector, and resolving the platform is a
  // contextBridge round trip. Classic users must not pay it.
  return (
    settings?.experimentalTerminalMode === true &&
    isTerminalModeSupportedPlatform(platform ?? getRendererAppPlatform())
  )
}
