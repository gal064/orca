import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBashOsc7EmitterBlock, getZshOsc7EmitterBlock } from './shell-osc7-integration'
import {
  getBashShellReadyRcfileContent,
  getZshShellReadyRcfileContent
} from './providers/local-pty-shell-ready'
import {
  getDaemonBashShellReadyRcfileContent,
  getDaemonZshShellReadyRcfileContent
} from './daemon/shell-ready'
import { getRelayShellLaunchConfig } from '../relay/pty-shell-launch'

const hasShell = (shell: string): boolean =>
  process.platform !== 'win32' && spawnSync(shell, ['--version']).status === 0

const itWithBash = hasShell('bash') ? it : it.skip
// zsh is absent on many Linux dev boxes; the content assertions still run there.
const itWithZsh = hasShell('zsh') ? it : it.skip

const OSC7_PREFIX = '\x1b]7;'

function runShellScript(shell: string, script: string): string {
  const home = mkdtempSync(join(tmpdir(), 'orca-osc7-home-'))
  try {
    const result = spawnSync(shell, ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, HOSTNAME: 'testhost', ZDOTDIR: home },
      timeout: 10_000
    })
    expect(result.error).toBeUndefined()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    return result.stdout
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/** A directory whose name needs percent-encoding in a file:// URI. */
function makeAwkwardDir(): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'orca-osc7-'))
  const dir = join(root, 'a b#c%d')
  spawnSync('mkdir', ['-p', dir])
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function expectedOsc7Uri(dir: string): string {
  const encoded = dir
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${OSC7_PREFIX}file://testhost${encoded}\x07`
}

describe('OSC 7 emitter blocks', () => {
  it('emits an OSC 7 file URI from both shells', () => {
    for (const block of [getBashOsc7EmitterBlock(), getZshOsc7EmitterBlock()]) {
      expect(block).toContain('__orca_osc7_emit()')
      expect(block).toContain('printf "\\033]7;file://%s%s\\007"')
    }
  })

  it('skips shells that already report cwd, and Windows-flavored POSIX shells', () => {
    for (const block of [getBashOsc7EmitterBlock(), getZshOsc7EmitterBlock()]) {
      // Matching `*osc7*` also matches Orca's own hook, so re-sourcing cannot double-register.
      expect(block).toContain('*osc7*|*OSC7*|*__vte_prompt_command*')
      expect(block).toContain('off*|*" "msys*|*" "cygwin*|*" "win32*|*" wsl"')
      // The field kill switch: this ships to hosts that cannot be rebuilt quickly.
      expect(block).toContain('${ORCA_DISABLE_OSC7:+off}')
    }
  })

  it('registers the zsh hook after the OSC 133 precmd so $? survives', () => {
    expect(getZshOsc7EmitterBlock()).toContain(
      'precmd_functions=(${precmd_functions[@]} __orca_osc7_emit)'
    )
  })
})

describe('OSC 7 wiring in the generated rcfiles', () => {
  it('registers inside the local bash prompt window', () => {
    const rcfile = getBashShellReadyRcfileContent()
    expect(rcfile).toContain('__orca_osc7_emit()')
    // Why before prompt_done: it closes the window that keeps the DEBUG trap from
    // reading Orca's own prompt hooks as a foreground command.
    expect(rcfile.indexOf('__orca_append_prompt_command "__orca_osc7_emit"')).toBeLessThan(
      rcfile.indexOf('__orca_append_prompt_command "__orca_osc133_prompt_done"')
    )
  })

  it('registers inside the daemon bash prompt window', () => {
    const rcfile = getDaemonBashShellReadyRcfileContent()
    expect(rcfile).toContain('__orca_osc7_emit()')
    expect(rcfile).toContain('${__orca_osc7_prompt_entry:-}__orca_osc133_epilogue')
  })

  it('registers in both zsh rcfiles', () => {
    for (const rcfile of [getZshShellReadyRcfileContent(), getDaemonZshShellReadyRcfileContent()]) {
      expect(rcfile).toContain('__orca_osc7_emit()')
      expect(rcfile.indexOf('precmd_functions=(__orca_osc133_precmd')).toBeLessThan(
        rcfile.indexOf('precmd_functions=(${precmd_functions[@]} __orca_osc7_emit)')
      )
    }
  })

  it('registers in the relay wrappers SSH hosts run', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-relay-wrappers-'))
    try {
      getRelayShellLaunchConfig('/bin/bash', { HOME: root, ORCA_REMOTE_CLI_BIN_DIR: '/opt/bin' })
      getRelayShellLaunchConfig('/bin/zsh', { HOME: root, ORCA_REMOTE_CLI_BIN_DIR: '/opt/bin' })
      const wrappers = join(root, '.orca-relay', 'shell-ready')
      const bashRc = readFileSync(join(wrappers, 'bash', 'rcfile'), 'utf8')
      const zshRc = readFileSync(join(wrappers, 'zsh', '.zshrc'), 'utf8')

      expect(bashRc.indexOf('__orca_append_prompt_command "__orca_osc7_emit"')).toBeLessThan(
        bashRc.indexOf('__orca_append_prompt_command "__orca_osc133_prompt_done"')
      )
      expect(zshRc).toContain('precmd_functions=(${precmd_functions[@]} __orca_osc7_emit)')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe.each([
  ['bash', getBashOsc7EmitterBlock],
  ['zsh', getZshOsc7EmitterBlock]
] as const)('%s OSC 7 emitter behavior', (shell, getBlock) => {
  const itWithShell = shell === 'bash' ? itWithBash : itWithZsh

  itWithShell('percent-encodes the cwd byte-wise', () => {
    const { dir, cleanup } = makeAwkwardDir()
    try {
      const output = runShellScript(shell, `${getBlock()}\ncd '${dir}'\n__orca_osc7_emit\n`)
      expect(output).toBe(expectedOsc7Uri(dir))
      // The path survives the round-trip a host-side OSC 7 parser performs.
      const uri = output.slice(OSC7_PREFIX.length, -1)
      expect(decodeURIComponent(new URL(uri).pathname)).toBe(dir)
    } finally {
      cleanup()
    }
  })

  itWithShell('registers exactly one hook and stays idempotent when re-sourced', () => {
    const probe =
      shell === 'bash'
        ? 'printf "%s\\n" "${__orca_osc7_prompt_entry:-none}"'
        : 'print -r -- "${precmd_functions[*]:-none}"'
    // The bash block only computes a fragment, so the test has to install it the
    // way the rcfiles do — otherwise the re-source guard is never exercised.
    const install =
      shell === 'bash' ? 'PROMPT_COMMAND="${__orca_osc7_prompt_entry}$PROMPT_COMMAND"' : ':'
    const output = runShellScript(
      shell,
      `${getBlock()}\n${probe}\n${install}\n${getBlock()}\n${probe}\n`
    )
    const lines = output.trim().split('\n')
    if (shell === 'bash') {
      // Second source sees its own hook in PROMPT_COMMAND and registers nothing.
      expect(lines).toEqual(['__orca_osc7_emit;', 'none'])
    } else {
      expect(lines).toEqual(['__orca_osc7_emit', '__orca_osc7_emit'])
    }
  })

  itWithShell('does not double-emit when the shell already reports cwd', () => {
    const preinstall =
      shell === 'bash'
        ? 'PROMPT_COMMAND="__vte_prompt_command"'
        : 'precmd_functions=(__vte_osc7_hook)'
    const probe =
      shell === 'bash'
        ? 'printf "%s\\n" "${__orca_osc7_prompt_entry:-none}"'
        : 'print -r -- "${precmd_functions[*]:-none}"'
    const output = runShellScript(shell, `${preinstall}\n${getBlock()}\n${probe}\n`)
    // 'none' is the bash probe's default for an empty prompt entry: nothing registered.
    expect(output.trim()).toBe(shell === 'bash' ? 'none' : '__vte_osc7_hook')
  })

  itWithShell('stays out of MSYS/Cygwin/WSL shells and honors the kill switch', () => {
    const probe =
      shell === 'bash'
        ? 'printf "%s\\n" "${__orca_osc7_prompt_entry:-none}"'
        : 'print -r -- "${precmd_functions[*]:-none}"'
    for (const prelude of [
      'OSTYPE=msys',
      'OSTYPE=cygwin',
      'WSL_DISTRO_NAME=Ubuntu',
      'ORCA_DISABLE_OSC7=1'
    ]) {
      const output = runShellScript(shell, `${prelude}\n${getBlock()}\n${probe}\n`)
      expect(output.trim(), prelude).toBe('none')
    }
  })
})
