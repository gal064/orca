import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/types'
import {
  collectVerticalTabNamePersists,
  isVerticalTabAutoNamed,
  resolveVerticalTabDisplayName
} from './terminal-mode-auto-title'

function tab(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'vtab-1',
    projectGroupId: 'group-terminal',
    name: 'home',
    folderPath: '/home/user',
    comment: '',
    linkedTask: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('resolveVerticalTabDisplayName', () => {
  it('uses the basename of the pwd while auto-named', () => {
    expect(resolveVerticalTabDisplayName(tab(), '/home/user/dev/orca')).toBe('orca')
  })

  it('keeps the stored name once the tab was renamed manually', () => {
    expect(
      resolveVerticalTabDisplayName(tab({ name: 'build', terminalModeAutoName: false }), '/tmp')
    ).toBe('build')
  })

  it('keeps the stored name when no pwd is known yet', () => {
    expect(resolveVerticalTabDisplayName(tab(), null)).toBe('home')
    expect(resolveVerticalTabDisplayName(tab(), '   ')).toBe('home')
  })

  it('treats an explicit true and an absent flag the same', () => {
    expect(isVerticalTabAutoNamed(tab())).toBe(true)
    expect(isVerticalTabAutoNamed(tab({ terminalModeAutoName: true }))).toBe(true)
    expect(isVerticalTabAutoNamed(tab({ terminalModeAutoName: false }))).toBe(false)
  })
})

describe('collectVerticalTabNamePersists', () => {
  it('reports only tabs whose stored name drifted from the auto title', () => {
    const tabs = [
      tab({ id: 'a', name: 'orca' }),
      tab({ id: 'b', name: 'old' }),
      tab({ id: 'c', name: 'pinned', terminalModeAutoName: false })
    ]
    expect(
      collectVerticalTabNamePersists(tabs, {
        a: '/dev/orca',
        b: '/dev/other',
        c: '/dev/whatever'
      })
    ).toEqual([{ id: 'b', name: 'other' }])
  })

  it('reports nothing when no pwd is known', () => {
    expect(collectVerticalTabNamePersists([tab()], {})).toEqual([])
  })
})
