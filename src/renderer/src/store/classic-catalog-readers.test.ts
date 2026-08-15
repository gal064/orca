/**
 * TRIPWIRE — do not delete, do not weaken. Read this before adding a name below.
 *
 * Terminal-mode vertical tabs are folder workspaces under a reserved project group,
 * stored in the SAME `projectGroups` / `folderWorkspaces` state classic UI reads (they
 * have to be: the tab system, session persistence and execution-host resolution all
 * key off a folder workspace and its group). So any code that ENUMERATES those arrays
 * renders vertical tabs unless it goes through `store/classic-workspace-catalog.ts`.
 *
 * Fixture-based tests cannot protect that: they pass a catalog in, so they still pass
 * when a consumer is reverted to a raw store read. This test protects it structurally —
 * it freezes the set of files allowed to touch the raw arrays. This repo merges upstream
 * release tags regularly, and an upstream change that adds an enumeration is otherwise a
 * silent leak.
 *
 * If this test fails, a file started reading the raw catalog. Decide which it is:
 *   - It ENUMERATES for display or selection → route it through `selectClassicProjectGroups` /
 *     `selectClassicFolderWorkspaces` (or the `use*` hooks). Do not add it below.
 *   - It looks up ONE workspace by id, resolves an execution host, or garbage-collects
 *     keyed state → that must see vertical tabs. Add it below WITH a reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = join(__dirname, '..')
const RAW_CATALOG_READ = /\b(?:s|state|current|snapshot)\.(?:projectGroups|folderWorkspaces)\b/

/**
 * Files allowed to read the raw catalog, and why. Everything here either resolves a
 * single workspace/host by id or maintains state keyed by workspace — all of which must
 * include vertical tabs — or is the choke point itself.
 */
const ALLOWED: Record<string, string> = {
  'store/classic-workspace-catalog.ts': 'the choke point',
  'store/terminal-mode-workspace-keys.ts':
    'half of the choke point, split out so store slices can read it without pulling the hooks (and the store) into their init',
  'store/slices/vertical-tabs.ts': 'owns vertical tabs',
  'components/vertical-tabs/use-vertical-tabs.ts': 'renders vertical tabs',
  'components/vertical-tabs/index.tsx': 'renders vertical tabs, incl. their host badge',
  'components/vertical-tabs/use-terminal-mode-panel-scope.ts':
    'resolves the active vertical tab start directory — vtabs only',
  'components/vertical-tabs/use-terminal-mode-auto-title.ts':
    'auto-titles vertical tabs from their own pwd — vtabs only',
  'components/right-sidebar/use-terminal-mode-panels.ts':
    'resolves the scoped vertical tab by id — vtabs only',
  'lib/terminal-mode-shortcuts.ts': 'resolves the active vertical tab',

  'store/slices/repos.ts': 'owns the catalog; create/update/delete must see every row',
  'store/slices/worktrees.ts': 'workspace activation resolves any workspace by id',
  'store/slices/tabs.ts': 'per-workspace tab state, keyed by workspace',
  'store/slices/terminals.ts': 'per-workspace terminal state, keyed by workspace',
  'store/slices/terminal-cwd.ts': 'resolves one workspace start directory by id — vtabs only',
  'store/slices/browser.ts': 'garbage-collects browser state by workspace key',
  'store/slices/editor.ts': 'garbage-collects editor state by workspace key',
  'store/slices/worktree-nav-history.ts': 'prunes navigation history by workspace key',

  'lib/folder-workspace-connection.ts': 'execution-host resolution for one workspace',
  'lib/folder-workspace-runtime-owner.ts': 'execution-host resolution for one workspace',
  'lib/resolved-worktree-execution-host.ts': 'execution-host resolution for one workspace',
  'lib/connection-owner-resolution.ts': 'execution-host resolution for one workspace',
  'lib/runtime-session-mirror-owners.ts': 'session mirroring keyed by workspace',
  'lib/workspace-session-host-persistence.ts': 'session partitioning keyed by workspace',
  'lib/worktree-activation.ts': 'activates one workspace by id',
  'lib/editor-file-operation-owner.ts': 'resolves the owner of one file path',
  'lib/ai-vault-resume-target.ts': 'resolves one resume target by id',
  'lib/ai-vault-resume-command.ts': 'resolves one resume target by id',
  'lib/codex-pane-selection-lane.ts': 'resolves one pane by id',
  'lib/hook-command-delayed-delivery.ts': 'resolves one workspace by id',
  'lib/agent-background-session-test-state.ts': 'test-only state builder',

  'hooks/direct-ssh-host-hydration-scope.ts': 'host hydration scoping',
  'hooks/remote-workspace-snapshot-apply.ts': 'remote snapshot apply, keyed by workspace',
  'hooks/remote-workspace-target-sync.ts': 'remote target sync, keyed by workspace',
  'hooks/useEditorExternalWatch.ts': 'watches the active workspace',

  'components/Terminal.tsx': 'mounts a terminal surface per workspace — must include vtabs',
  'components/quick-open-file-list.ts': 'routes a file operation for one workspace',
  'components/right-sidebar/AiVaultPanel.tsx': 'resolves one workspace by id',
  'components/right-sidebar/ai-vault-original-pane-actions.ts': 'feeds the catalog to the filter',
  'components/right-sidebar/ai-vault-session-launch-actions.ts': 'resolves one target by id',
  'components/right-sidebar/ai-vault-session-log-open.ts': 'resolves one target by id',
  'components/right-sidebar/FolderWorkspacePrChecksPanel.tsx': 'the active workspace only',
  'components/right-sidebar/FolderWorkspaceWorktreesPanel.tsx': 'the active workspace only',
  'components/right-sidebar/useFileExplorerWatch.ts': 'watches the active workspace',
  'components/sidebar/use-worktree-meta-workspace.ts': 'resolves the dialog target by id',
  'components/sidebar/worktree-list-review-cache-inputs.ts':
    'presence-only gate for a cache subscription; a vtab costs extra re-renders, renders nothing',
  'components/tab-bar/tab-create-entry-local-path.ts': 'resolves one workspace by id',
  'components/terminal-pane/codex-detached-pane-restart.ts': 'resolves one pane by id',
  'components/terminal-pane/pty-connection.ts': 'resolves one workspace by id',
  'components/native-chat/native-chat-skill-discovery-context.ts': 'resolves one workspace by id',
  'components/editor/rich-markdown-image-insert.ts': 'resolves one workspace by id',
  'components/editor/useRichMarkdownSuperscriptLinkSetup.ts': 'resolves one workspace by id',
  'components/dashboard/dashboard-snapshot-workspaces.ts': 'calls the choke point itself',
  'components/dashboard/dashboard-card-terminal-input.ts': 'resolves one card by id',
  'components/dashboard/dashboard-worktree-launch-options.ts': 'resolves one card by id',
  'components/dashboard/useAgentBucketCounts.ts': 'feeds the catalog to the snapshot builder',
  'components/dashboard/useLiveDashboardSnapshot.ts': 'feeds the catalog to the snapshot builder',
  'components/dashboard/useDashboardPopoutBridge.ts': 'identity compare for republish',
  'components/dashboard/useRetainedAgents.ts': 'calls the choke point for the snapshot',
  'components/dashboard-popout/AgentMapProjectContextMenu.tsx': 'resolves the clicked row by id',
  'components/dashboard-popout/AgentMapWorkspaceContextMenu.tsx': 'resolves the clicked row by id',
  'runtime/sync-runtime-graph.ts': 'publishes per-workspace graph state, keyed by workspace',
  'lib/ai-vault-tab-title-sync-inputs.ts': 'identity compare only, never enumerates'
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('raw workspace-catalog readers are frozen', () => {
  it('no new renderer file reads projectGroups/folderWorkspaces off the store', () => {
    const offenders = collectSourceFiles(RENDERER_ROOT)
      .filter((file) => RAW_CATALOG_READ.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(RENDERER_ROOT, file).split(sep).join('/'))
      .filter((file) => !(file in ALLOWED))
      .sort()

    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entries', () => {
    const readers = new Set(
      collectSourceFiles(RENDERER_ROOT)
        .filter((file) => RAW_CATALOG_READ.test(readFileSync(file, 'utf-8')))
        .map((file) => relative(RENDERER_ROOT, file).split(sep).join('/'))
    )

    expect(Object.keys(ALLOWED).filter((file) => !readers.has(file))).toEqual([])
  })
})
