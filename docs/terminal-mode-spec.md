# Terminal Mode — Spec

Status: **planned, not started**. Interviewed and decided 2026-08-13.

## 1. Goal

Make Orca behave like a terminal-first app (cmux/ghostty-style) instead of a
workspace/worktree orchestrator:

- The left sidebar becomes a list of **vertical tabs (vtabs)** — plain named
  containers, not workspaces, projects, or worktrees.
- Each vtab holds **horizontal tabs (htabs)** — terminals (plus editor/diff
  tabs opened from the panels).
- The **file explorer and git panel follow the focused terminal's pwd**, not a
  workspace path. `cd` is the navigation model. No worktree creation, no
  project setup, no branch semantics in the UI.
- Agent features (status, attention, notifications) survive, re-scoped to the
  terminal/pwd an agent runs in.

Constraint that shapes everything: **this fork merges upstream stable tags
regularly** (see `update-from-upstream` skill). The implementation must stay
low-divergence — additive files, few and small touch points in upstream code.

## 2. Decisions (from interview)

| Topic | Decision |
|---|---|
| Mode shape | Experimental settings toggle (existing `experimental*` flag pattern). Classic mode stays fully intact and testable for upstream-merge safety. |
| Where pwd lives | Per terminal (htab). Vtabs are just named groupings. |
| Panel binding | Explorer + git panel follow the **focused terminal's** pwd in the active vtab. |
| Explorer root | Literal pwd, always. Re-roots as you `cd`. |
| Git panel scope | Nearest enclosing repo of pwd. Quiet empty state ("not a git repo") when pwd is outside any repo. |
| Pwd tracking | OSC 7 with **Orca-injected shell integration** (bash/zsh/fish, ghostty-style) + OS-level fallback polling (`/proc/<pid>/cwd` Linux, libproc/lsof macOS). Injection happens wherever the pty is owned: local, SSH, and orca-serve hosts. |
| Hosts | **Per-vtab host.** Each vtab is pinned to a host (local / SSH / remote) at creation. New-vtab UI has a host picker; a settings-configurable **default host** is used otherwise. |
| New vtab | Instant (no dialog). Inherits host + pwd from the focused terminal (ghostty-style); falls back to default host + `~` when nothing is focused. |
| New htab | Inherits pwd from the focused tab in the same vtab. |
| Naming | Auto-title = basename of focused terminal's pwd. Manual rename (double-click) pins the name permanently. |
| Agents | Keep agent features; an agent pane is an htab running in its launch pwd. Status dots/badges roll up to the vtab. |
| Sidebar contents | Vtab list + agent status indicators + notifications entry. Nothing else. |
| Persistence | Layout (vtabs, names, htabs, last pwd per terminal) always restored. **Remote (orca serve) reattach to live sessions: MUST.** SSH/local reattach: best effort; local shells restart in last-known pwd. |
| Migration | None. Terminal mode starts empty. Classic data untouched; switching back loses nothing. |
| Closing | Cmd+W on the last htab closes the vtab. Closing anything with a running agent asks for confirmation. |
| Windows | Terminal mode explicitly unsupported — the toggle is hidden on Windows. Classic mode on Windows must keep working. |
| Delivery | Big bang: one branch delivering the full model; user switches daily use when done. |

### Keyboard shortcuts (macOS / Linux)

| Action | macOS | Linux |
|---|---|---|
| New vtab | Cmd+N | Ctrl+N |
| New htab (inherit pwd) | Cmd+T | Ctrl+T |
| Switch vtab 1–9 | Cmd+1..9 | Ctrl+1..9 |
| Switch htab 1–9 | Ctrl+1..9 | Alt+1..9 † |
| Close htab | Cmd+W | Ctrl+W |
| Close vtab | Cmd+Shift+W | Ctrl+Shift+W |

† Open detail: the user's spec (Cmd+1-9 vtab / Ctrl+1-9 htab) is Mac-clean but
collides on Linux where Cmd maps to Ctrl. Proposed Linux resolution is
Alt+1..9 for htabs; confirm during implementation. Never hardcode `metaKey`
(see AGENTS.md cross-platform rules).

### Out of scope (unchanged, classic-only)

- Kanban drawer, dashboard, sidebar filters.
- PR creation / hosted review / ChecksPanel.
- Worktree/project creation UI, branch management, workspace cleanup flows.
- Mobile pairing and Orca CLI worktree/project commands get **no terminal-mode
  work**. Note: because vtabs reuse workspace keys (§3), some of this may work
  incidentally; that's a bonus, not a requirement.
- Ports panel **stays available**: its scan is global and its "this workspace"
  grouping maps naturally to the active vtab (`PortsPanel.tsx` groups by
  `port.owner.worktreeId === activeWorktreeId`).

## 3. Architecture — the low-divergence strategy

Key insight from code exploration: Orca already has the two primitives this
feature needs, and both are upstream code we can lean on instead of fork:

1. **`FolderWorkspace`** (`src/shared/types.ts` ~L331: `id`,
   `projectGroupId`, `name`, `folderPath`, `executionHostId?`, …) — a
   workspace that is nothing but a named path, no git worktree, already
   host-aware and remote-routable. Workspace keys are already a
   discriminated union (`worktree:${id}` | `folder:${id}`).
2. **OSC 7 cwd tracking already runs in main** —
   `src/main/daemon/osc7-uri-extraction.ts`, `terminal-osc-cwd-title-scanner.ts`;
   `orca-runtime.ts` keeps `terminalCwdByPtyId` and emits `{ cwd, cwdChanged }`
   on pty data. Remote hosts even ship cwd on the wire already
   (`TerminalStreamOpcode.Metadata`); the renderer just never consumes it.

### 3.1 A vtab is a `FolderWorkspace` under the hood

Each vertical tab is backed by a `FolderWorkspace` whose `path` is only the
*starting* directory (immaterial after launch) and whose workspace key
(`folder:${id}`) becomes the vtab id. This means the following upstream
machinery is **reused with zero or near-zero changes**:

- htab state: `store/slices/tabs.ts` (`unifiedTabsByWorktree`,
  `layoutByWorktree`, … all `Record<workspaceKey, …>`)
- terminal creation/splits: `store/slices/terminals.ts`, `lib/pane-manager/*`,
  `components/tab-group/*`
- session persistence + **remote reattach**: `workspaceSession` /
  `workspaceSessionsByHostId` in `PersistedState` — already partitioned per
  `ExecutionHostId`, which is exactly the per-vtab-host model
- notification routing, agent-status keying, per-device tab selection — all
  keyed by workspace key today

What we deliberately do NOT do: introduce a new workspace scope kind or a
parallel tab-state system. Both would fork the ~572 renderer files that touch
`worktreeId`.

### 3.2 New code (additive, no upstream conflicts)

New directories/files, roughly:

- `src/renderer/src/components/vertical-tabs/` — the terminal-mode sidebar:
  vtab list, agent-status dots, notifications entry, new-vtab button with host
  picker, inline rename. It renders none of `WorktreeList.tsx` (6.8k lines);
  that file's only edit is the two-line hidden-group filter on its store reads
  (§3.3 item 1b), which keeps every classic consumer inside it blind to vtabs.
- `src/renderer/src/store/slices/terminal-cwd.ts` — ptyId → cwd map fed by a
  new `{ kind: 'cwd' }` fact on the existing `pty:sideEffect` channel (local)
  and by decoding the already-sent `Metadata` stream frames (remote); derives
  `activePwdByVtab` = last-known cwd of the most-recently-focused *terminal*
  htab (sticky when an editor/diff htab is focused). Debounce panel
  re-rooting ~300 ms. OS-level fallback: the existing `pty:getCwd` pull API,
  polled like the checks panel already does.
- OSC 7 emitters added to the existing shell-integration rcfiles
  (`src/main/providers/local-pty-shell-ready.ts` + the daemon mirror
  `src/main/daemon/shell-ready.ts`, which is what SSH/remote hosts run —
  bash/zsh wrappers already exist; fish likely emits OSC 7 natively).
- `src/main/git/repo-root-for-path.ts` — pwd → nearest repo root
  (`git rev-parse --show-toplevel` through the existing runner/provider
  dispatch), cached per (host, directory), honoring `GitCapabilityCache`
  conventions.
- Settings: `experimentalTerminalMode` flag + `terminalModeDefaultHost` in
  `GlobalSettings`, one `*ExperimentalSetting.tsx` pane component (existing
  pattern, `ExperimentalPane.tsx`).

### 3.3 Touch points in upstream files (keep this list short and documented)

Every upstream-file edit must be a small, clearly-marked branch. Expected set:

1. `components/sidebar/index.tsx` — one conditional: terminal mode renders
   `<VerticalTabsSidebar/>` instead of the classic list; the classic
   project-drop affordance is gated off the same flag. **(Phase 0, done.)**
1b. **Hidden-group isolation (Phase 1, done).** The hidden group must stay invisible
   in *both* modes (its data outlives the flag), and it cannot be split out of
   `state.projectGroups` / `state.folderWorkspaces` at ingress — the tab system,
   session persistence and execution-host resolution all read a folder workspace's
   group. So classic UI reads the catalog through **one choke point**:
   `src/renderer/src/store/classic-workspace-catalog.ts`
   (`selectClassicProjectGroups`, `selectClassicFolderWorkspaces`,
   `selectTerminalModeWorkspaceKeys`, plus `use*` hooks). Results are cached per
   source array, so identity is preserved and a user with no vertical tabs pays
   nothing. Every classic consumer is a one-line swap of its store read:
   - `components/sidebar/WorktreeList.tsx` — rows, drag buckets, the project-header
     "Move to group" submenu, the `hasProjectGroups` gate, path-status prefetch.
   - `components/sidebar/rendered-sidebar-worktree-order.ts` — the Cmd+1-9 replay.
     (`worktree-list-host-filtering.ts` itself is back to upstream: both callers now
     hand it the classic catalog.)
   - `components/sidebar/WorktreeCard.tsx`,
     `components/sidebar/WorktreeCardDisplayMenuSection.tsx`,
     `components/sidebar/WorktreeContextMenu.tsx`.
   - `components/WorktreeJumpPalette.tsx` (Cmd+J group rows *and* their ordering base).
   - `hooks/useComposerState.ts` (new-workspace target combobox and its draft resolve).
   - `components/dashboard/dashboard-snapshot-workspaces.ts` and
     `components/dashboard/useRetainedAgents.ts`.
   - `components/right-sidebar/ai-vault-original-pane.ts` and
     `ai-vault-session-resume.ts` — agents in terminal mode are Phase 5, so a vtab is
     not a jump/resume target today.
   - `components/TaskPage.tsx`, `components/LinearItemDrawer.tsx`,
     `components/LinearIssueWorkspace.tsx`, `lib/linear-issue-workspace-open.ts` —
     linked-item attachment merges.
   Host side (published to the CLI and to paired/remote clients, which may be older
   than terminal mode and have no filter of their own):
   - `main/runtime/orca-runtime.ts` — `listProjectGroups`, `listFolderWorkspaces`,
     `getWorktreePs`, `listAllMobileSessionTabs` and `listTerminals`. These reach
     `orca worktree ps` / `orca terminal ls`, paired mobile and remote clients, and the
     workspace keys they emit are also accepted selectors for rename/delete.
     **(Phase 4, done.)** The two catalog lists are now capability-gated pass-throughs:
     `listProjectGroups`/`listFolderWorkspaces` take `{ includeTerminalMode }`, and the
     RPC handlers set it from `clientOwnsTerminalModeCatalog(ctx)`
     (`main/runtime/rpc/methods/terminal-mode-catalog-gate.ts`) — the CLIENT's
     `terminal-mode.catalog.v1` token, never a host one, and never for mobile. The CLI,
     paired mobile and every build older than terminal mode keep the filtered catalog.
     The other three stay filtered. Still unfiltered and deferred (all low-traffic, keyed
     by workspace): cross-workspace file-owner resolution, `worktree.lineageList`,
     notification fan-out.
   - `lib/runtime-workspace-file-route.ts` and `lib/folder-workspace-connection.ts` —
     a vtab roots at `$HOME`, so an unfiltered read makes it the longest-match file
     owner for everything under home, and the renderer's own repo heuristic would
     resolve its host from every repo on the machine.
   - `main/ipc/filesystem-auth.ts`,
     `main/project-groups/folder-workspace-path-status.ts`, `main/persistence.ts`
     (`backfillFolderScopeConnectionIds`) — see the host-resolution note below.
   **Tripwires:** `src/renderer/src/store/terminal-mode-isolation.test.ts` and
   `src/main/runtime/terminal-mode-host-isolation.test.ts` assert the invariant
   against the real production functions of every surface above. They exist so an
   upstream tag merge that adds a new enumeration fails a test instead of leaking
   silently.
2. **Panels follow pwd (Phase 3, done).** `components/right-sidebar/FileExplorer.tsx`
   — one substitution (`useTerminalModePanelRoot(activeWorktreeId) ?? activeWorktree.path`)
   plus one `<TerminalModeExplorerClampNotice/>` line under the toolbar. Its two
   remote read sites (`file-explorer-directory-listing.ts`,
   `useFileExplorerTree.ts` `statPath`) each gain one spread,
   `terminalModeAbsolutePathScopeArgs(worktreeId)`, so a remote vertical tab is
   addressed by absolute host path rather than by a relative path computed
   against the wrong root.
3. **Git panel follows the pwd's repo (Phase 3, done).**
   `components/right-sidebar/SourceControl.tsx` — instead of threading a second
   path through ~150 call sites, terminal mode substitutes the *workspace pair*
   the panel already reads: `useTerminalModeGitWorkspace(activeWorktreeId)`
   returns a `Worktree`/`Repo` rooted at the repository enclosing the pwd, with
   the vertical tab's own workspace key. Three edits: the two identity reads and
   one branch in the existing `!activeWorktree` early return that renders
   `<TerminalModeSourceControlEmptyState/>`. The same substitution lands in
   `components/right-sidebar/useGitStatusPolling.ts` (it derives its own path)
   and one `isFolder` branch in `components/right-sidebar/index.tsx` so the
   activity bar stops hiding the git tabs for a vertical tab.
3aa. `components/right-sidebar/SourceControl.tsx` also gains one predicate in its
   per-worktree prune effect so a vertical tab's commit draft survives a
   background worktree refresh (a vtab key is never in the classic worktree map).
3b. **Watchers follow the panels (Phase 3, done).**
   `hooks/useEditorExternalWatch.ts` — the target list for a terminal-mode
   workspace comes from `selectTerminalModeWatchRoots` (the explorer's pwd plus
   the repo root when they differ) instead of the workspace's start folder. Its
   snapshot cache gains `terminalModePanelScope`, which is what makes a `cd`
   dispose the old subscription and install the new one.
3c. **Filesystem boundary (Phase 3, done).** New
   `main/ipc/terminal-mode-path-scope.ts` holds at most one declared directory —
   the one the active vertical tab's panels show — plus the repository main
   itself resolves from it. `main/ipc/filesystem-auth.ts` gains two lines: the
   scope roots join `getAllowedRoots`, and `resolveRegisteredWorktreePath`
   accepts the terminal-mode repo root (the `git:*` handlers' exact-registration
   door, which no pwd-derived repository can otherwise pass). Both are empty in
   classic mode and re-validated on every read, so the flag going off or the tab
   closing revokes them without the renderer's cooperation.
3d. **Repo-root lookup + absolute-path scope (Phase 3, done).** New
   `main/git/repo-root-for-path.ts` (async, WSL-aware, TTL-cached per host +
   directory). Reached through `git:repoRootForPath` (`main/ipc/filesystem.ts`,
   SSH via the existing `IGitProvider.isGitRepoAsync` — no contract or relay
   change) and a new `git.repoRootForPath` RPC (`rpc/methods/git.ts`,
   `orca-runtime-git.ts`), which an old host answers with `method_not_found` and
   the client degrades on. `files.readDir` and `files.stat` gain an optional
   `absolutePath`, gated on `terminal-mode.absolute-path-scope.v1`
   (`src/shared/protocol-version.ts` — defined and checked, deliberately *not*
   advertised until a host can serve outside-root paths, so Phase 3 always clamps
   remote tabs), asserted client-side before every send and refused host-side for
   mobile clients, non-vertical-tab workspaces and SSH-backed workspaces. `store/slices/terminal-cwd.ts` also gains the
   last-terminal-tab fallback the sticky-pwd rule needs once a diff tab can be
   focused.
3e. **Per-vtab hosts + remote reattach (Phase 4, done).** New host-side surface:
   `main/runtime/terminal-mode-host-path-scope.ts` (the RPC twin of 3c — a
   corroborated, read-only, per-vertical-tab grant an `orca serve` host declares for
   itself) reached through new `main/runtime/rpc/methods/terminal-mode.ts`
   (`terminalMode.ensureContext`, `terminalMode.setPathScope`), announced by
   `terminal-mode.vertical-tabs.v1`. `orca-runtime-files.ts` — one branch in
   `resolveAbsoluteScopePath` consults that grant before the ordinary allow-list;
   `watchFileExplorer` gains an optional `absolutePath`, matched by one optional param
   on `files.watch` (`rpc/methods/files.ts`, `file-watch-stream-lifecycle.ts`).
   `orca-runtime.ts` — `ensureTerminalModeContext`/`setTerminalModePathScope`,
   the catalog gate above, one `clearTerminalModeHostPathScope` line in
   `deleteFolderWorkspace`, and `ORCA_E2E_DISABLE_TERMINAL_MODE_CAPABILITIES` in
   `getStatus` so a real host can stand in for one that predates terminal mode.
   `main/ipc/terminal-mode-group.ts` — the ensure is now per host
   (`ensureTerminalModeGroup(store, connectionId)`) and `terminalMode:ensureContext`
   resolves an SSH target's home through `resolveRemoteHomePath`
   (`main/ipc/repos.ts`, now exported). Client side: the three desktop
   `clientCapabilities` arrays in `shared/remote-runtime-*.ts` advertise
   `terminal-mode.catalog.v1`; `runtime/remote-runtime-terminal-multiplexer.ts` decodes
   the `cwd` the host has always put on `SnapshotStart`, so a reattached remote pane
   knows its directory before the next prompt; `runtime/runtime-file-client.ts`
   `subscribeRuntimeFileChanges` takes an optional absolute watch path; and the
   explorer's remaining mutation/read/watch call sites each gain one
   `...terminalModeFileScopeArgs(worktreeId)` spread
   (`right-sidebar/useFileExplorerInlineInput.ts`, `useFileDeletion.ts`,
   `useFileDuplicate.ts`, `useFileExplorerDragDrop.ts`, `useFileExplorerImport.ts`,
   `useFileSearchRunner.ts`, `FileExplorer.tsx`, `useFileExplorerWatch.ts`,
   `lib/rename-file.ts`, `hooks/useEditorExternalWatch.ts`) so a remote tab addresses
   the host by its *workspace* root while the panels show the pwd.
3f. **Host picker + default host (Phase 4, done).** New
   `renderer/src/lib/terminal-mode-hosts.ts` (pure: host options from the shared
   execution-host registry, `resolveNewVerticalTabHostId` = requested > inherited >
   setting > local, host→transport route), `renderer/src/store/terminal-mode-host-options.ts`
   (selector + `useTerminalModeHostOptions`), `renderer/src/store/terminal-mode-host-context.ts`
   (ensure-the-group-on-the-owning-host routing), `vertical-tabs/NewVerticalTabButton.tsx`
   (the "+" split button) and `settings/TerminalModeDefaultHostSelect.tsx`. Upstream
   edits: one row in `settings/TerminalModeExperimentalSetting.tsx`, one badge in
   `vertical-tabs/VerticalTabRow.tsx`.
4. `src/shared/types.ts` — additive fields on `GlobalSettings`
   (`experimentalTerminalMode`, `terminalModeDefaultHost`) and on
   `FolderWorkspace` (`terminalModeAutoName?`); additive fact variant
   `{ kind: 'cwd'; cwd }` in `src/shared/terminal-side-effect-facts.ts`
   **(Phase 2, done)**.
5. **Pwd on the wire (Phase 2, done).** `main/runtime/orca-runtime.ts` — one
   branch in `recordOsc7MetadataForPty` emits the cwd fact (every OSC 7 call
   site, live and snapshot-seed, flows through it) and
   `getTerminalSideEffectSnapshot` appends the tracked cwd so a late subscriber
   catches up. `renderer/src/runtime/remote-runtime-terminal-multiplexer.ts` —
   one `TerminalStreamOpcode.Metadata` branch in `handleBinary`, decode-only,
   delivered through the stream's own `onCwd` callback, which
   `components/terminal-pane/remote-runtime-pty-transport.ts` answers (the only
   place that knows the stream's PTY id). Nothing new is sent in either
   direction (wire-compat Rule 1).
   `components/terminal-pane/terminal-side-effect-facts-handler.ts` — a
   module-level cwd observer registry beside the per-PTY consumer registry (a
   parked terminal's directory still matters), a per-PTY sequence guard so an
   in-flight replay snapshot cannot regress a newer `cd`, a cwd-only skip in the
   handoff buffer, and the `cwd` case in its fact switch.
   `components/terminal-pane/remote-runtime-pty-transport.ts` — answers `onCwd`
   (terminal-mode gated) and clears the entry when the remote terminal ends.
   `store/slices/terminals.ts` — the new-horizontal-tab action
   (`openNewTerminalTabInActiveWorkspace`) passes the focused tab's pwd as
   `startupCwd`; `createTab` itself is untouched, so agent launches, quick
   commands, background terminals and pane detach keep their own directories.
   `store/index.ts` and `store/types.ts` — slice registration.
6. **Shell integration (Phase 2, done).** New `src/main/shell-osc7-integration.ts`
   holds the bash/zsh OSC 7 emitter text plus both registration forms. **Three**
   wrappers interpolate it — `providers/local-pty-shell-ready.ts` (local),
   `daemon/shell-ready.ts` (remote `orca serve` hosts) and
   `relay/pty-shell-launch.ts` (SSH hosts; the design doc named only the first
   two). Each also gains `*__orca_osc7_emit*` in its OSC 133 preexec skip list.
   Bash registers inside the prompt window, before the hook that reopens the
   DEBUG trap; zsh appends to `precmd_functions` after the OSC 133 hook so `$?`
   survives. No fish wrapper (resolved question 1). This is **not** flag-gated:
   the rcfiles are shared by every PTY, so classic mode also starts reporting
   cwd — see the Phase 2 notes in `terminal-mode-design.md`. `ORCA_DISABLE_OSC7`
   in a PTY's environment turns the emitter off on any host without a rebuild.
7. **Shortcuts (Phase 1, done).** `src/shared/keybindings.ts` — only change is
   the `workspace.delete` default, previously empty, now `Mod+Shift+W` on macOS
   and Linux only (resolved question 4; Windows cannot enable terminal mode, so
   it keeps no default). This is the one flag-independent behavior change: with
   the flag off the chord runs the classic delete, and the shortcut entry point
   passes `forceConfirm` so it can never inherit `skipDeleteWorktreeConfirm`.
   No new action ids.
   The six reused actions are intercepted in main and delivered as IPC, so the
   mode branches live in `hooks/useIpcEvents.ts` (`workspace.create`,
   `workspace.delete`, `workspace.selectByIndex`, plus board/tasks gating) and
   `App.tsx` (board/tasks gating only). Each branch is a one-line call into
   `lib/terminal-mode-shortcuts.ts`. `tab.newTerminal`, `tab.close` and
   `tab.selectByIndex` need no change — they are already workspace-keyed.
8. Settings registration (Phase 0, done): `src/shared/constants.ts`
   (`getDefaultSettings` — *not* `persistence.ts`, which only migrates),
   `components/settings/ExperimentalPane.tsx` (one row) and
   `components/settings/experimental-search.ts` (one platform-gated entry).
9. `src/renderer/src/i18n/locales/en.json` — new keys land here via
   `pnpm run sync:localization-catalog`. Highest-churn file in the repo, so
   expect a conflict on every upstream tag merge; resolve by keeping both
   sides' keys.
10. **`terminalModeAutoName` plumbing (Phase 1, done).** One optional boolean
   threaded through every layer that whitelists folder-workspace update
   fields: `shared/types.ts`, `shared/folder-workspaces.ts`
   (`normalizeFolderWorkspaces`, else the flag is dropped on reload),
   `main/persistence.ts`, `main/ipc/repos.ts` (zod), `main/runtime/rpc/methods/
   folder-workspace.ts` (zod), `main/runtime/orca-runtime.ts`,
   `preload/api-types.ts`, `store/slices/repos.ts`. Additive optional field —
   wire-safe per `docs/reference/remote-wire-compatibility.md` Rule 1.
10b. **Reserved group name (Phase 1, done).** `Store.createProjectGroup` /
   `updateProjectGroup` in `main/persistence.ts` reject `__terminal-mode__`
   (`assertProjectGroupNameNotReserved`), with an `allowReservedName` opt-in used only
   by the ensure path. At the store rather than the IPC/RPC edges because nested-repo
   import and the folder-scan migration mint groups from directory names and call it
   directly.
11. **PTY disposal on folder-workspace delete (Phase 1, done — resolved
   question 6).** New `main/runtime/folder-workspace-terminal-teardown.ts`
   does the sweep; `orca-runtime.ts` gains a
   `teardownFolderWorkspaceTerminals` method called from its own
   `deleteFolderWorkspace`, and `main/ipc/repos.ts` awaits the same method
   through an injected handle (the `setRepoRemoteClientNotifier` precedent),
   wired in `main/window/attach-main-window-services.ts`. The same sweep runs on
   the project-group delete cascade (`projectGroups:delete` IPC +
   `OrcaRuntimeService.deleteProjectGroup`), and the renderer's
   `deleteProjectGroup` now calls `purgeWorktreeTerminalState` like its
   single-workspace sibling. This also fixes the pre-existing leak for classic
   folder workspaces. Host resolution reuses the runtime's own
   `resolveFolderWorkspaceConnectionId` — the same resolver the pty *spawn* path
   uses — so the sweep always reaches the provider that owns the ptys.
12. **Terminal-mode IPC (Phase 1, done).** New `main/ipc/terminal-mode-group.ts`
   (`terminalMode:ensureLocalContext` → hidden group + host home dir), plus one
   namespace each in `preload/index.ts` and `preload/api-types.ts`, and one
   registration line in `main/window/attach-main-window-services.ts`.
   The hidden group has `parentPath: null` — a vtab owns its own start directory,
   and a fabricated folder root would feed the authorized-filesystem scope, the
   connection-id migration and the path-status probe a directory the user never
   opened. `shared/folder-workspaces.ts` (`normalizeFolderWorkspaces`) gains one
   clause so terminal-mode workspaces survive that missing root.

13. **Phase 6 hardening (done).** Three carried-in fixes, four upstream edits:
   - `components/activity/ActivityPrototypePage.tsx` — a vertical tab has no project
     row behind its synthetic `folder-workspace:` repo id, so its threads read
     "Unknown project". `ActivityProjectLabel` and `getActivityThreadGroup` /
     `buildActivityThreadGroups` now consult
     `components/activity/activity-terminal-tab-group.ts`
     (`selectActivityTerminalTabKeys` = the hidden-group workspace keys, empty with the
     flag off; label "Terminal tabs"; group key `project:terminal-tabs`). The keys come
     from the catalog choke point, **not** from the `folder:` key shape — a classic
     folder workspace reaches this page too (as a standalone workspace) and must keep
     its own heading.
   - `App.tsx` — one null leaf, `<TerminalModeActiveTabFallbackGate />`
     (`store/terminal-mode-active-tab-fallback.ts`): with the flag off while a vertical
     tab is the active workspace, the classic sidebar filters that row out and its pane
     keeps rendering with no way to leave it. Mounted in `App`, not in the sidebar,
     because the toggle lives in the Settings view where the sidebar is unmounted.
   - `lib/folder-workspace-path-status.ts` — `formatFolderWorkspaceCreateError` now
     recovers the `folder_workspace_*` code out of Electron's
     `Error invoking remote method …` wrapper before matching it. Its `startsWith`
     never matched a main-process throw, so **classic** folder-workspace creation has
     been showing users the raw code too; this fixes both.
   - Terminal-mode-owned: `store/terminal-mode-ssh-connect.ts` connects the SSH target
     before the ensure (a disconnected one resolves `~` to the literal `~`), reusing
     `ssh/ssh-connect-in-flight.ts` + `ssh/ssh-connection-recoverability.ts` and the
     *reconnect* UI budget; `store/slices/vertical-tabs.ts` rejects an unresolved home
     directory, publishes the connect state, re-reads the focused pwd after the wait and
     counts creates in flight (`verticalTabCreatesInFlight`) so the "+" and empty-state
     controls show progress for every entry point, including `Mod+T`;
     `store/terminal-mode-host-context.ts` fences the desktop `ensureContext` leg.

14. **Two touch points the merge dry-run found missing from this list** (both landed in
   earlier phases; recorded in Phase 6):
   - `main/ipc/notifications.ts` — the click-to-navigate binding was gated on a `::` in the
     `worktreeId`, so a `folder:` key bound no handler at all. One `parseWorkspaceKey` branch
     binds it and passes a null `repoId` for a vertical tab (`notifications.test.ts` covers it).
     §6 flagged this file as a risk; it is an actual edit.
   - `components/sidebar/delete-worktree-flow.ts` — `runWorktreeDelete` takes
     `{ forceConfirm }`, because `Mod+Shift+W` (item 7) must not inherit
     `skipDeleteWorktreeConfirm`, which the user opted into for the sidebar action.

**Merge dry-run (Phase 6, against `v1.4.182`, 252 commits past the merged `v1.4.180`).**
27 files conflicted; **12** of them are files terminal mode touches, and 10 of those 12 were
already in this list (`daemon/shell-ready.ts`, `runtime/orca-runtime.ts`,
`rpc/methods/folder-workspace.ts`, `preload/api-types.ts`, `right-sidebar/FileExplorer.tsx`,
`sidebar/WorktreeCard.tsx`, `hooks/useComposerState.ts`, `i18n/locales/en.json`,
`runtime/remote-runtime-terminal-multiplexer.ts`, `shared/folder-workspaces.ts`). The other
two are item 14 above. The remaining **15** conflicts are not terminal mode's: `package.json`
and `resources/skills/release-mapping.json` are mechanical, and the rest
(`main/artifacts/*`, `main/github/client*`, `browser-pane/BrowserPane.tsx`,
`editor/EditorPanel.tsx`, `terminal-pane/TerminalPane.tsx`, `WorktreeJumpPalette*.test.tsx`,
`lib/worktree-creation-flow*`, `store/slices/worktree-helpers.ts`) belong to the
`feat/reuse-checkout-workspace` work this branch is stacked on. The merge was aborted and the
throwaway branch deleted — the divergence strategy holds.

Rule: if an implementation step wants to edit a big upstream file beyond a
branch-point, stop and find an additive seam instead.

### 3.4 Remote wire

Per `docs/reference/remote-wire-compatibility.md`: cwd events must ride an
**existing** stream/RPC shape or a new *optional* field — no new opcode without
capability negotiation. The OSC 7 scan runs host-side (the host owns ptys), so
the remote case is "forward a field the host already computes." Old client +
new host and new client + old host must both degrade to startup-cwd behavior,
not break. Shell-integration injection also runs host-side, so SSH/remote get
pwd tracking without client involvement.

## 4. Behavior details

- **Pwd follow:** active vtab's panels track the focused terminal htab. When
  focus moves between htabs, panels switch to that terminal's last-known cwd
  immediately. When a non-terminal htab (editor/diff/browser) is focused,
  panels stay on the last terminal-derived pwd (sticky).
- **No OSC 7 and fallback fails** (exotic shell, injection declined): panels
  stay at the terminal's startup cwd. Never blank; never guess.
- **Git panel empty state** doubles as the affordance explaining "cd into a
  repo to see changes here."
- **Diff/changes view:** required feature. `SourceControl` + diff htabs work
  against the pwd-derived repo, same as classic against the worktree.
- **Explorer → editor:** clicking a file opens an editor htab in the current
  vtab (existing behavior via workspace-key reuse). Explorer's "open terminal
  here" keeps working (`startupCwd` already supported).
- **Agent status:** ai-vault session scanning maps sessions to the pty/htab
  they run in → roll up to vtab for the sidebar dot (running / needs-attention,
  including the Codex attention debounce). Notification click focuses the
  originating vtab + htab.
- **Restart (local):** shells relaunch in each terminal's last-known cwd.
- **Restart/reconnect (remote):** client reattaches to live server sessions —
  vtabs, htabs, scrollback, running agents all resume. This is the hard
  requirement.
- **Rename:** double-click vtab name; a manual name sets `pinnedName` and
  stops auto-titling. Auto-title otherwise = basename of focused terminal pwd.
- **Close:** per-decision table above; confirmation dialog lists the running
  agent(s) it would kill.

## 5. Validation & rollout

Delivery is big-bang from the user's perspective (one switch-over of daily
use), but implementation is phased with per-phase verification — see
[`terminal-mode-design.md`](./terminal-mode-design.md). Done-bar before the
daily-driver switch:

1. **cua-driver CLI E2E on Linux** (primary dev platform) covering the
   daily-driver checklist below — runs throughout development.
2. **Final pass:** Mac local, then Mac client → remote Linux (omarchy)
   `orca serve` host.
3. **Remote reattach proof:** kill the client mid-session, reconnect; all
   vtabs/htabs/live sessions restore. **Proven in Phase 4**, and re-proven on the
   Phase 5 branch (`581b4e3be`) as the standing guard. Its sibling — restart the
   *host* while the client is up — was the hard blocker; **Phase 5 task 0 lands it
   and Phase 5 app QA proved it** over seven restart cycles, with the flag on and off:
   panes recover on their own, the stale id is pruned, and no vertical tab is lost.
   One defect remains on that path and is *not* a blocker for the switch-over: the
   focused workspace gains a duplicate terminal tab per host restart (pre-existing,
   reproduces in classic mode too — see the design doc's Phase 5 open list).
4. **Upstream merge dry-run:** trial-merge the latest upstream stable tag on
   the finished branch to verify the divergence strategy holds (expect
   conflicts only in the §3.3 touch-point list).

Daily-driver checklist (acceptance):

- [ ] Create/rename/reorder/close vtabs; auto-title follows pwd until pinned
- [ ] New vtab inherits host+pwd from focused terminal; default host + `~`
      otherwise; host picker works for remote
- [ ] New htab inherits pwd; all shortcuts in the table work on Mac and Linux
- [ ] Explorer re-roots on `cd` (bash, zsh, fish; local, SSH, remote)
- [ ] Git panel: repo detection walking from pwd; empty state outside repos;
      diff view opens and is correct
- [ ] Fallback polling covers a shell with integration stripped
- [ ] Agent in an htab: status dot, attention state, notification click-through
- [ ] App restart restores layout + pwds (local); reattach restores live
      sessions (remote)
- [ ] Close-with-running-agent confirmation
- [ ] Classic mode still fully works with the flag off; Windows unaffected

## 6. Risks

- **Ctrl-digit collision on Linux** (shortcut table footnote) — resolve early.
- **OSC 7 injection fragility** across shell rc-file setups; the OS fallback
  is the safety net, and remote hosts need the fallback implemented
  server-side too.
- **`FolderWorkspace` hidden assumptions:** code paths may assume a folder
  workspace's `path` is meaningful beyond startup (watchers, cleanup,
  base-dir polling). Audit `workspace-cleanup*.ts` and worktree watchers for
  `folder:` scope behavior before building on it.
- **Notification id-format parsing** (`notifications.ts` ~L510 parses `repoId`
  out of worktree ids) — verify `folder:` keys route correctly.
- **Upstream drift in touch-point files** — the §3.3 list is the merge
  contract; keep it current in this doc as implementation proceeds.
