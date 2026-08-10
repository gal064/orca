// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DIGIT_INDEX_SHORTCUT_COUNT } from '../../../../shared/keybindings'
import { getVisibleWorktreeIds, setVisibleWorktreeIds } from './visible-worktrees'
import { useWorkspaceShortcutIndex } from './use-workspace-shortcut-index'

let container: HTMLDivElement
let root: Root

function Probe({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const index = useWorkspaceShortcutIndex(worktreeId)
  return <span data-testid="index">{index === null ? 'none' : String(index)}</span>
}

function renderProbe(worktreeId: string): void {
  act(() => {
    root.render(<Probe worktreeId={worktreeId} />)
  })
}

function readIndex(): string {
  return container.querySelector('[data-testid="index"]')?.textContent ?? ''
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setVisibleWorktreeIds(null)
})

describe('useWorkspaceShortcutIndex', () => {
  it('reports the published sidebar position', () => {
    setVisibleWorktreeIds(['a', 'b', 'c'])
    renderProbe('c')
    expect(readIndex()).toBe('2')
  })

  it('re-renders when the published order changes', () => {
    setVisibleWorktreeIds(['a', 'b'])
    renderProbe('b')
    expect(readIndex()).toBe('1')

    act(() => setVisibleWorktreeIds(['b', 'a']))
    expect(readIndex()).toBe('0')
  })

  it('reports no position past the addressable 1-9 range', () => {
    const ids = Array.from({ length: DIGIT_INDEX_SHORTCUT_COUNT + 2 }, (_, i) => `w${i}`)
    setVisibleWorktreeIds(ids)

    renderProbe(ids[DIGIT_INDEX_SHORTCUT_COUNT - 1])
    expect(readIndex()).toBe(String(DIGIT_INDEX_SHORTCUT_COUNT - 1))

    renderProbe(ids[DIGIT_INDEX_SHORTCUT_COUNT])
    expect(readIndex()).toBe('none')
  })

  it('reports no position while the sidebar is unmounted', () => {
    setVisibleWorktreeIds(null)
    renderProbe('a')
    expect(readIndex()).toBe('none')
  })

  it('reports no position for a workspace absent from the published order', () => {
    setVisibleWorktreeIds(['a', 'b'])
    renderProbe('missing')
    expect(readIndex()).toBe('none')
  })

  // The point of the whole feature: a badge showing N must activate the same
  // workspace Cmd/Ctrl+N does. Both must read one published array.
  it('agrees with the order the Cmd+1-9 handler resolves against', () => {
    const ids = ['first', 'second', 'third']
    setVisibleWorktreeIds(ids)

    for (const [position, id] of ids.entries()) {
      renderProbe(id)
      const badgeDigit = Number(readIndex()) + 1
      // getVisibleWorktreeIds() is exactly what useIpcEvents indexes on a digit chord.
      expect(getVisibleWorktreeIds()[badgeDigit - 1]).toBe(id)
      expect(badgeDigit).toBe(position + 1)
    }
  })
})
