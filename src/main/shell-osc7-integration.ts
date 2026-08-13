// OSC 7 (shell-reported cwd) emitters injected into Orca's bash/zsh wrapper
// rcfiles. Orca already parses OSC 7 everywhere a PTY's bytes transit main
// (osc7-uri-extraction.ts); this is the missing producer, and it is what lets
// terminal mode follow `cd`. The local, daemon (remote host) and relay (SSH)
// wrappers share this text so every host reports cwd identically.
//
// Fish gets no wrapper: it emits OSC 7 natively (terminal-mode-design.md,
// resolved question 1), and the process-cwd fallback covers silent shells.

/** Path bytes that never need percent-encoding in a file:// URI. */
const OSC7_UNRESERVED_PATH_CLASS = '[^a-zA-Z0-9/:_.~-]'

/** PROMPT_COMMAND text that already reports cwd. Skipping it saves ~60 bytes a
 *  prompt — a doubled report is harmless (main dedupes on the value), so this
 *  list does not have to be exhaustive. What it must catch is Orca's own `osc7`
 *  hook, which is what makes a re-sourced rcfile idempotent. */
const BASH_OSC7_EXISTING_EMITTER_PATTERNS = "*osc7*|*OSC7*|*__vte_prompt_command*|*']7;'*"

/** Same idea for zsh, which matches hook *names* rather than command text —
 *  an inline escape sequence can never appear there. */
const ZSH_OSC7_EXISTING_EMITTER_PATTERNS = '*osc7*|*OSC7*|*__vte_prompt_command*'

// Why skipped on MSYS/Cygwin/WSL: those shells report POSIX paths that Orca's
// host resolves under a Windows path flavor, where a non-local authority parses
// as a UNC share and a Linux path is only translatable when the host already
// knows the WSL distro. Terminal mode is unsupported on Windows anyway.
// `ORCA_DISABLE_OSC7` is the field kill switch: this ships to every shell, on
// hosts Orca cannot re-deploy quickly, so it must be disableable without a build.
const OSC7_SKIP_CASE_SUBJECT = '"${ORCA_DISABLE_OSC7:+off} ${OSTYPE:-}${WSL_DISTRO_NAME:+ wsl}"'
const OSC7_SKIP_PATTERNS = 'off*|*" "msys*|*" "cygwin*|*" "win32*|*" wsl"'

/** The encoder body, identical in both shells: percent-encode `$PWD` byte-wise
 *  (a UTF-8 path must survive the file:// round-trip) and print the URI. */
function getOsc7EncoderBody(hostVariable: string): string {
  return `  # Why the guard: an unset or relative $PWD would emit a URI with no path,
  # which Orca's two OSC 7 parsers disagree about.
  [[ "$PWD" == /* ]] || return 0
  local LC_ALL=C
  local __orca_rest="$PWD" __orca_safe="" __orca_hex="" __orca_out=""
  while [[ -n "$__orca_rest" ]]; do
    __orca_safe="\${__orca_rest%%${OSC7_UNRESERVED_PATH_CLASS}*}"
    if [[ -n "$__orca_safe" ]]; then
      __orca_out="$__orca_out$__orca_safe"
      __orca_rest="\${__orca_rest#"$__orca_safe"}"
      continue
    fi
    printf -v __orca_hex '%%%02X' "'$__orca_rest"
    __orca_out="$__orca_out$__orca_hex"
    __orca_rest="\${__orca_rest#?}"
  done
  printf "\\033]7;file://%s%s\\007" "\${${hostVariable}:-}" "$__orca_out"`
}

/**
 * Defines `__orca_osc7_emit` and sets `__orca_osc7_prompt_entry` to the
 * PROMPT_COMMAND fragment for it — empty when a foreign emitter is already
 * installed. Splice that fragment in with one of the two registration forms
 * below; the wrappers structure their PROMPT_COMMAND differently, but both must
 * place the emit inside the prompt window (after the OSC 133 precmd, before the
 * hook that reopens the DEBUG trap) or bash reports Orca's own prompt helper as
 * a foreground command and emits a spurious OSC 133 C/D pair.
 */
export function getBashOsc7EmitterBlock(): string {
  return `# Why: OSC 7 reports the shell's cwd on every prompt so Orca can follow \`cd\`.
# Percent-encoding runs byte-wise (LC_ALL=C) so non-ASCII paths survive the
# file:// round-trip; printf -v keeps it subshell-free on the prompt path.
__orca_osc7_emit() {
${getOsc7EncoderBody('HOSTNAME')}
}
__orca_osc7_prompt_entry=""
case ${OSC7_SKIP_CASE_SUBJECT} in
  ${OSC7_SKIP_PATTERNS}) ;;
  *)
    case "\${PROMPT_COMMAND:-}" in
      ${BASH_OSC7_EXISTING_EMITTER_PATTERNS}) ;;
      *) __orca_osc7_prompt_entry="__orca_osc7_emit;" ;;
    esac
    ;;
esac
`
}

/**
 * Registration for wrappers that build PROMPT_COMMAND through the
 * `__orca_append_prompt_command` helper (local + relay). Emit it after the
 * shell-ready marker append and before the prompt-done append.
 */
export function getBashOsc7PromptCommandRegistration(): string {
  return `if [[ -n "\${__orca_osc7_prompt_entry:-}" ]]; then
  __orca_append_prompt_command "__orca_osc7_emit"
fi
unset __orca_osc7_prompt_entry
`
}

/**
 * Registration for the daemon wrapper, which assigns PROMPT_COMMAND in one
 * expression: interpolate this immediately before its closing epilogue entry.
 */
export const BASH_OSC7_PROMPT_COMMAND_ENTRY = '${__orca_osc7_prompt_entry:-}'

/**
 * Defines and registers `__orca_osc7_emit` on `precmd_functions`. Appended, not
 * prepended: Orca's OSC 133 precmd hook must keep seeing the command's `$?`.
 */
export function getZshOsc7EmitterBlock(): string {
  return `# Why: OSC 7 reports the shell's cwd on every prompt so Orca can follow \`cd\`.
# no_multibyte + LC_ALL=C make the percent-encoding byte-wise, so non-ASCII
# paths survive the file:// round-trip.
__orca_osc7_emit() {
  emulate -L zsh
  setopt localoptions no_multibyte
${getOsc7EncoderBody('HOST')}
}
# Why the probe: zsh gained \`printf -v\` in 5.1, and an SSH/remote host can run
# an older one — without it the encoder would print an option error at every
# prompt whose path needs escaping. Silence beats corrupting the stream.
if printf -v __orca_osc7_probe '%s' probe 2>/dev/null; then
  # Why the hook scan: skip shells that already report cwd, and — because our own
  # hook name matches it — make a re-sourced rcfile idempotent.
  case ${OSC7_SKIP_CASE_SUBJECT} in
    ${OSC7_SKIP_PATTERNS}) ;;
    *)
      case "\${precmd_functions[*]:-} \${chpwd_functions[*]:-}" in
        ${ZSH_OSC7_EXISTING_EMITTER_PATTERNS}) ;;
        *) precmd_functions=(\${precmd_functions[@]} __orca_osc7_emit) ;;
      esac
      ;;
  esac
fi
unset __orca_osc7_probe
`
}
