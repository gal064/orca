import { describe, expect, it } from 'vitest'
import type { TerminalModePanelScope } from '@/store/slices/terminal-mode-panels'
import {
  terminalModeAbsoluteWatchPath,
  terminalModeFileScopeArgs
} from './terminal-mode-file-scope'

function stateWith(scope: TerminalModePanelScope | null) {
  return { terminalModePanelScope: scope } as never
}

const RELATIVE: TerminalModePanelScope = {
  workspaceKey: 'folder:vtab',
  root: '/srv/work/sub',
  workspaceRoot: '/srv/work',
  repoRoot: null,
  addressing: 'relative',
  clampedToWorkspaceRoot: false
}
const ABSOLUTE: TerminalModePanelScope = { ...RELATIVE, root: '/tmp/other', addressing: 'absolute' }

describe('terminalModeFileScopeArgs', () => {
  it('rebases every call site on the workspace root, not the shown directory', () => {
    // This is what lets the explorer sit in a subdirectory of a remote vertical tab
    // while its mutations still address the host through the workspace selector.
    expect(terminalModeFileScopeArgs('folder:vtab', stateWith(RELATIVE))).toEqual({
      worktreePath: '/srv/work'
    })
  })

  it('adds the gated absolute flag only when the scope escaped the workspace root', () => {
    expect(terminalModeFileScopeArgs('folder:vtab', stateWith(ABSOLUTE))).toEqual({
      worktreePath: '/srv/work',
      absolutePathScope: true
    })
  })

  it('returns nothing in classic mode and for another workspace', () => {
    expect(terminalModeFileScopeArgs('folder:vtab', stateWith(null))).toEqual({})
    expect(terminalModeFileScopeArgs('folder:other', stateWith(RELATIVE))).toEqual({})
    expect(terminalModeFileScopeArgs(null, stateWith(RELATIVE))).toEqual({})
  })
})

describe('terminalModeAbsoluteWatchPath', () => {
  it('watches the pwd only once the host can be addressed absolutely', () => {
    expect(terminalModeAbsoluteWatchPath('folder:vtab', '/tmp/other', stateWith(ABSOLUTE))).toBe(
      '/tmp/other'
    )
  })

  it('leaves the selector-addressed watch alone inside the workspace root', () => {
    // files.watch without the param watches the workspace root, which already
    // contains this directory — the relative contract every host answers.
    expect(
      terminalModeAbsoluteWatchPath('folder:vtab', '/srv/work/sub', stateWith(RELATIVE))
    ).toBeUndefined()
  })

  it('sends nothing in classic mode or with no path to watch', () => {
    expect(terminalModeAbsoluteWatchPath('folder:vtab', '/tmp', stateWith(null))).toBeUndefined()
    expect(terminalModeAbsoluteWatchPath('folder:vtab', null, stateWith(ABSOLUTE))).toBeUndefined()
  })
})
