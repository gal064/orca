import type {
  TerminalStartupCwdFallbackKind,
  TerminalStartupCwdFallbackNotice,
  TerminalStartupCwdRejection
} from '../../../../shared/terminal-startup-cwd'

// Why the notices omit the rejected path: saved cwds can contain private repo/user
// names, and the terminal itself already shows where it opened.
const NOTICES: Record<
  TerminalStartupCwdFallbackKind,
  Record<TerminalStartupCwdRejection, string>
> = {
  worktree: {
    missing:
      'Orca opened this terminal at the workspace root because its saved start folder no longer exists.',
    inaccessible:
      'Orca opened this terminal at the workspace root because its saved start folder is not accessible.'
  },
  home: {
    missing:
      'Orca opened this terminal in your home directory because this tab\u2019s start folder no longer exists.',
    inaccessible:
      'Orca opened this terminal in your home directory because this tab\u2019s start folder is not accessible.'
  }
}

/** Terminal output, so plain framing and CRLFs rather than an i18n string. */
export function getStartupCwdFallbackNotice(fallback: TerminalStartupCwdFallbackNotice): string {
  return `\r\n[${NOTICES[fallback.kind][fallback.reason]}]\r\n`
}
