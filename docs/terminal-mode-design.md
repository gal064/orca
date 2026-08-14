# Terminal Mode — Engineering Design

Companion to [`terminal-mode-spec.md`](./terminal-mode-spec.md) (product
decisions live there; read it first). This doc is the build plan: phased, each
phase independently verifiable, executable by an engineer new to the codebase.

**Line numbers in this doc are anchors, not gospel** — they were verified on
`gal-version` @ 2026-08-13 and will drift. Always locate the named identifier;
if an identifier is missing or looks different, stop and re-scout before
coding around it.

**Divergence rule (applies to every phase):** new behavior goes in new files;
upstream files get only small, clearly-scoped branch points. Every upstream
file you touch must be added to the "touch points" list in the spec (§3.3). If
a step seems to require restructuring a large upstream file, stop — find an
additive seam or escalate.

---

## 0. Architecture recap

- A **vertical tab (vtab)** is a `FolderWorkspace` (`src/shared/types.ts:331`
  — fields: `id`, `projectGroupId`, `name`, `folderPath`, `connectionId?`,
  `executionHostId?`, `sortOrder`, …). Its workspace key `folder:${id}`
  (`src/shared/workspace-scope.ts`, `folderWorkspaceKey`) is the id everything
  else keys on. All vtabs live under **hidden terminal-mode project groups**
  (one per host — see Phase 1) so classic mode never renders them.
- **Horizontal tabs (htabs)** are the existing per-workspace tab system —
  `unifiedTabsByWorktree`, `groupsByWorktree`, etc. in
  `src/renderer/src/store/slices/tabs.ts` — reused unchanged.
- **Pwd** is tracked per terminal (pty). Main already scans OSC 7
  (`orca-runtime.ts` `terminalCwdByPtyId`, `recordOsc7MetadataForPty`); remote
  hosts already send cwd on the wire (`TerminalStreamOpcode.Metadata = 12`).
  The renderer just doesn't consume any of it yet. We add a renderer slice
  `cwdByPtyId` and derive an **active pwd per vtab** = last-known cwd of the
  most-recently-focused terminal htab.
- **File explorer & git panel** root themselves at the active pwd (literal
  pwd; git = nearest enclosing repo) instead of `activeWorktree.path`.
- Everything is gated on `settings.experimentalTerminalMode` (boolean flag,
  existing experimental-settings pattern). Flag hidden on Windows.

---

## Phase 0 — Flag + sidebar scaffold

Goal: the toggle exists; turning it on swaps the sidebar for a (placeholder)
vertical-tabs sidebar; classic mode is untouched.

### Tasks

1. **Settings field.** Add `experimentalTerminalMode?: boolean` to
   `GlobalSettings` in `src/shared/types.ts` (near
   `experimentalCompactWorktreeCards`, ~L3137). Default `false` in
   `getDefaultSettings` — which lives in `src/shared/constants.ts`, not
   `src/main/persistence.ts`.
2. **Settings UI.** New
   `src/renderer/src/components/settings/TerminalModeExperimentalSetting.tsx`
   modeled on `AgentDashboardExperimentalSetting.tsx`. Register in
   `ExperimentalPane.tsx` and `settings/experimental-search.ts`. Hide the row
   when platform is Windows (renderer platform check, same pattern other
   platform-gated settings use).
3. **Mode predicate.** New file
   `src/renderer/src/lib/terminal-mode.ts` exporting
   `isTerminalMode(settings): boolean` (`settings?.experimentalTerminalMode
   === true && !isWindows`). Pure function — the repo convention for
   testability (cf. `shouldShowAgentDashboardButton`).
4. **Sidebar branch.** In `src/renderer/src/components/sidebar/index.tsx`,
   inside the `{sidebarOpen && (…)}` block (~L114-140), branch:
   `isTerminalMode(settings) ? <VerticalTabsSidebar/> : <existing children>`.
   Follow the in-file precedent at ~L198-208
   (`experimentalAgentDashboardPopout`). Do not touch `WorktreeList.tsx`.
5. **Scaffold.** New `src/renderer/src/components/vertical-tabs/index.tsx`
   rendering an empty list + a "+" button (non-functional). Styling per
   `docs/STYLEGUIDE.md` tokens.

### Verification

- Unit: `terminal-mode.test.ts` — predicate truth table incl. Windows.
- Manual: toggle on → placeholder sidebar; toggle off → classic sidebar
  identical to before (screenshot compare); settings search finds the flag.
- `npm` typecheck + lint clean. No behavior change with flag off is the bar.

---

## Phase 1 — Vtabs as folder workspaces (local host only)

Goal: create/switch/rename/reorder/close vtabs locally; htabs (terminals,
splits, editor tabs) work inside them via the existing tab system; layout
survives restart.

### Tasks

1. **Hidden group.** New `src/shared/terminal-mode-group.ts`:
   `TERMINAL_MODE_GROUP_NAME = '__terminal-mode__'` + predicate
   `isTerminalModeGroup(group)`. Main-side: lazy `ensureTerminalModeGroup()`
   (new file `src/main/ipc/terminal-mode-group.ts` or a small addition beside
   the folder-workspace handlers in `src/main/ipc/repos.ts`) that creates the
   group once per store. Classic sidebar must not render it: add one guard in
   the sidebar's group-row source filtering out `isTerminalModeGroup` (small
   touch point; find where `projectGroups` feed `WorktreeList` rows).
2. **Create vtab.** New store action in a new slice
   `src/renderer/src/store/slices/vertical-tabs.ts`:
   `createVerticalTab({ hostId?, startDir? })` → ensures hidden group →
   calls existing `createFolderWorkspace` (`store/slices/repos.ts:2519`,
   local branch = `window.api.folderWorkspaces.create`) with
   `{ projectGroupId: hiddenGroupId, name: basename(startDir), folderPath:
   startDir }` → activates via `setActiveFolderWorkspace(id, hostId)`
   (`store/slices/worktrees.ts:5984`). `startDir` = focused terminal's pwd
   when known (Phase 2 wires this; until then `os.homedir()` via a preload
   call or the host's home). Add optional field
   `terminalModeAutoName?: boolean` to `FolderWorkspace` (additive, default
   true for vtabs) — manual rename sets it false.
3. **Vtab list.** Selector `useVerticalTabs()`: `folderWorkspaces` whose
   `projectGroupId` is a terminal-mode group. **Implemented ordering: `createdAt`
   ascending, id as tie-break** — a tab strip appends new tabs at the end, while
   `sortOrder` defaults to `Date.now()` and is read descending by
   `getFolderWorkspaces()`. `manualOrder` stays unused until drag-reorder lands
   in Phase 5. Render in `vertical-tabs/index.tsx`: row =
   name + active highlight; click → `setActiveFolderWorkspace`. Drag-reorder
   **is deferred to Phase 5** — the classic mechanism is entangled with
   `WorktreeList`'s virtualized row model, which this phase deliberately does not
   touch beyond a two-line filter.
4. **Rename.** Inline rename on double-click. Reuse the store field
   `renamingWorktreeId` + `WorktreeTitleInlineRename.tsx` pattern (or a local
   copy in `vertical-tabs/` if the shared one is too coupled). Commit via
   `updateFolderWorkspace(id, { name, terminalModeAutoName: false })`
   (`repos.ts:2557`).
5. **Close.** Row context menu + `Cmd/Ctrl+Shift+W` →
   `deleteFolderWorkspace(id)` (`repos.ts:2656`; main side cascades session
   cleanup via `removeWorkspaceSessionOwner`, `persistence.ts:4583`). Verify
   PTY disposal happens on delete (grep the delete path for pty disposal; if
   absent, dispose the workspace's ptys explicitly). Closing the last htab
   closes the vtab: hook the tab-close path in terminal mode — when
   `unifiedTabsByWorktree[key]` would become empty, call
   `deleteFolderWorkspace`. Agent-aware confirmation lands in Phase 5; plain
   confirm dialog ("close tab and kill its processes?") for now.
6. **Main content.** No changes: the center pane already renders the active
   workspace's tab groups. Verify a fresh folder workspace auto-creates its
   first terminal tab (check `Terminal.tsx:1474-1512` lazy spawn gated on
   `workspaceSessionReady`); if classic mode requires an explicit "new
   terminal" action, `createVerticalTab` should create the first terminal
   htab itself (tab-creation helper in
   `components/terminal/terminal-tab-create.ts`).
7. **Shortcuts.** In `src/shared/keybindings.ts` there are existing actions
   `workspace.selectByIndex`, `tab.selectByIndex`, `workspace.create`,
   `workspace.rename` — reuse them (terminal mode changes what the handler
   targets, not the binding). Add only what's missing, e.g.
   `terminal.newVerticalTab` (default `mod+n`), `terminal.newHorizontalTab`
   (`mod+t`) if no equivalent exists, `terminal.closeVerticalTab`
   (`mod+shift+w`). Dispatch: the `keydown` capture table in
   `src/renderer/src/App.tsx` (~L1668-1690, uses
   `keybindingMatchesAction` / `matchKeybindingDigitIndex`), gated on
   `isTerminalMode(settings)`. **Check `mod+n`/`mod+t`/`mod+w` for collisions
   with existing bindings (`conflictGroup` field) before picking defaults.**
   Linux htab digits: proposed `alt+1..9` via `platformBindings` — flag any
   conflict found.
8. **Persistence.** Free: sessions are keyed by workspace key and written by
   `createSessionWriteSubscriber` (`App.tsx:1268`) — verify vtab keys appear
   in `workspaceSession` after creating tabs.

### Verification

- Unit (vitest, colocated `*.test.ts` like
  `repos-all-hosts-folder-workspaces.test.ts`): hidden-group ensure is
  idempotent; `useVerticalTabs` ordering; auto-name derivation; classic
  sidebar filter excludes the hidden group.
- Manual checklist: create 3 vtabs; terminals + splits in each; rename one
  (auto-name stops); reorder; close one; `mod+1..9` switches vtabs; digit
  shortcut switches htabs; restart app → layout + names restored, shells
  respawn in `folderPath`.
- Classic-mode regression: flag off → hidden group invisible, nothing else
  changed.
- cua-driver (Linux): scripted smoke — create vtabs, restart, assert layout
  restored. Add stable `data-testid`s on vtab rows for this.

---

## Phase 2 — Pwd tracking plumbing (renderer knows every terminal's cwd)

Goal: a renderer store slice holds `cwdByPtyId` for local, SSH, and remote
terminals; an `activePwdByVtab` derivation exists. No panel changes yet.

### Tasks

1. **Local push channel.** Add a fact variant
   `{ kind: 'cwd'; cwd: string }` to `TerminalSideEffectFact`
   (`src/shared/terminal-side-effect-facts.ts:15`). Emit it in
   `orca-runtime.ts` next to the title fact (`recordTerminalSideEffectFact`
   ~L10295) whenever `recordOsc7MetadataForPty` reports `cwdChanged`
   (~L10799-10818; call sites in `onPtyData` ~L10051). It rides the existing
   `pty:sideEffect` batch channel (`src/main/index.ts:2438`, preload
   `src/preload/index.ts:1187`) — additive variant, old readers ignore it.
   Include cwd in the snapshot too (`pty:sideEffectSnapshot`,
   `src/main/ipc/pty.ts:5671`) so late subscribers catch up.
2. **Remote decode.** In
   `src/renderer/src/runtime/remote-runtime-terminal-multiplexer.ts`
   (`handleBinary`, ~L714) add a branch for
   `TerminalStreamOpcode.Metadata` (=12, `src/shared/terminal-stream-protocol.ts:24`)
   — decode `{ cwd }` (`TerminalOutputMeta`,
   `src/main/runtime/rpc/terminal-output-frame-chunks.ts:10`) and feed the
   slice. The host already sends these frames
   (`src/main/runtime/rpc/methods/terminal.ts` ~L2526, ~L3144); this is
   client-side-only and wire-safe (existing opcode, no negotiation needed).
3. **Store slice.** New
   `src/renderer/src/store/slices/terminal-cwd.ts`:
   `cwdByPtyId: Record<string, string>`, action `setPtyCwd(ptyId, cwd)`.
   Renderer consumers: extend
   `components/terminal-pane/terminal-side-effect-facts-handler.ts` for the
   new fact kind; the multiplexer for remote. Derivation
   `getActivePwdForVtab(state, workspaceKey)`: resolve the focused terminal
   htab's pty via `ptyIdsByTabId` (`slices/terminals.ts:552`) +
   `activeTabIdByWorktree`; sticky = remember last terminal-derived pwd per
   workspace key when a non-terminal htab is focused; fall back to the vtab's
   `folderPath`. Debounce consumers at ~300 ms.
4. **Fallback poll.** For ptys with no cwd yet (no OSC 7 seen), poll
   `window.api.pty.getCwd(ptyId)` — exact precedent:
   `right-sidebar/use-checks-panel-terminal-worktree.ts`
   (`TERMINAL_CWD_POLL_MS = 4000`, visibility-gated interval). Note that
   helper skips remote/SSH ptys; remote is covered by Metadata frames, and
   SSH `getCwd` exists via relay RPC (`ssh-pty-provider.ts:235`) — poll SSH
   too. This poll is the OS-level fallback (provider `getCwd` reads the
   process cwd).
5. **Shell integration (OSC 7 emitters).** In
   `src/main/providers/local-pty-shell-ready.ts` the wrappers already exist:
   zsh via `ZDOTDIR` (`getZshShellReadyRcfileContent` L219), bash via
   `--rcfile` (`getBashShellReadyRcfileContent` L92), PowerShell bootstrap.
   Add an OSC 7 emitter to the bash rcfile (`PROMPT_COMMAND`) and zsh rcfile
   (`chpwd`/`precmd` hook), guarded so it doesn't double-emit if the user's
   shell already does. Fish: currently falls through with no wrapper
   (`getWrappedShellLaunchConfig` L355, fallthrough L399-405) — **first
   verify fish's default**: modern fish emits OSC 7 out of the box; if
   confirmed, leave fish alone, else add a `--init-command` wrapper. Mirror
   every rcfile change in the daemon copy
   (`src/main/daemon/shell-ready.ts`, zsh templates
   `src/main/shell-templates.ts:136`) — that copy is what SSH/remote hosts
   run, which is how remote pwd tracking works with zero client changes.

### Verification

- Unit: rcfile content tests (bash/zsh emitter present, idempotence guard);
  Metadata-frame decode test for the multiplexer branch; slice reducer +
  `getActivePwdForVtab` (focused terminal / sticky / fallback cases).
- Manual: dev-only debug row in the vtab sidebar showing `activePwd`
  (`data-testid="vtab-active-pwd"`, kept for cua-driver). `cd` around in
  bash, zsh, fish locally → value updates ≤1 s; SSH host → updates; remote
  orca-serve host → updates; shell with integration stripped
  (`env -i bash --norc`) → poll fallback updates ≤5 s.
- Wire check: old client vs new host and vice versa still render terminals
  (Metadata is a pre-existing opcode; nothing new is sent).
- cua-driver (Linux): `cd /tmp && cd ~` script asserting the testid value.

---

## Phase 3 — Panels follow pwd + repo detection

Goal: explorer roots at the literal pwd; git panel shows the nearest
enclosing repo or a quiet empty state; vtab auto-title follows pwd.

### Tasks

1. **Repo-root lookup.** New main-side helper
   `src/main/git/repo-root-for-path.ts`: given `(hostId, absolutePath)` →
   repo root or null. Local: `gitExecFileAsync` (`src/main/git/runner.ts:836`)
   running `git rev-parse --show-toplevel` (cwd = path), mirroring
   `getGitRepoRoot` (`src/main/git/repo.ts:134`) but async + host-aware. Add
   it to the `IGitProvider` contract
   (`src/main/providers/git-provider-contract.ts:21`) and dispatch like
   `git.status` does (SSH via `ssh-git-dispatch.ts`; remote via a new RPC
   method in `src/main/runtime/rpc/methods/git.ts`). Cache per
   (host, directory) with TTL; use `GitCapabilityCache`
   (`src/shared/git-capability-cache.ts`,
   `src/main/git/git-capability-state.ts`) conventions for
   unsupported-command handling. **Remote back-compat:** an old host errors
   on the unknown RPC method — catch it and degrade (treat `folderPath` as
   the root if it's a repo, else null). Expose to renderer via a new preload
   call (`window.api.git.repoRootForPath`) and RPC for remote.
2. **FileExplorer branch.** `right-sidebar/FileExplorer.tsx:114`
   (`const worktreePath = activeWorktree?.path ?? null`) → in terminal mode
   substitute the debounced `activePwd`. Local + SSH listing already accepts
   absolute paths (`window.api.fs.readDir({ dirPath, connectionId })` via
   `runtime-file-client.ts:463`). **Remote gap:** RPC `files.readDir` takes
   `{ worktree: selector, relativePath }` — when pwd is inside the vtab's
   `folderPath`, compute the relative path; when outside, add an optional
   absolute-path param to `files.readDir`/`files.stat` on the host and gate
   its use on host app version (client can read the host version from the
   connection handshake — locate it in `remote-workspace` connect state).
   Old host → clamp: explorer roots at `folderPath` and shows a subtle
   "host update needed to follow cd outside the start folder" hint. Per
   `docs/reference/remote-wire-compatibility.md` Rule 1 this is a safe
   optional-field addition, but never silently send it to hosts that ignore
   it (the result would be wrong data, not an error).
3. **SourceControl branch.** `right-sidebar/SourceControl.tsx:1211` same
   substitution, but with the pwd-derived **repo root** (task 1), not the
   raw pwd. Null root → render the empty state ("Not a git repository — cd
   into one…"). Status calls: local path takes `worktreePath` already
   (`runtime-git-client.ts:136` → `callLocalGitStatus`); remote `git.status`
   uses a worktree selector — same version-gated absolute-path extension as
   task 2, same clamp fallback.
4. **Watchers.** Explorer file-watching
   (`subscribeRuntimeFileChanges`, `runtime-file-client.ts:1034`) must
   re-subscribe when the root changes; ensure the old watcher is disposed on
   re-root (cd churn is why the 300 ms debounce matters). Same for git
   status refresh triggers.
5. **Auto-title.** Effect in the vertical-tabs slice: when
   `terminalModeAutoName !== false`, set vtab display name =
   `basename(activePwd)`. Display-only in the renderer (don't write
   `updateFolderWorkspace` on every cd — persist only on close or on a slow
   debounce, to avoid store-write churn).
6. **Explorer actions sanity.** File click → editor htab; "new terminal
   here" (`startupCwd`) — both already keyed by workspace key; verify they
   work when the explorer root is outside `folderPath` (file-open paths may
   assume worktree-relative paths — check `getFileExplorerOperationRoute`).

### Verification

- Unit: repo-root lookup (repo, nested subdir, non-repo, cache hit, host
  keying); relative-path computation incl. outside-folderPath; auto-title.
- Manual matrix — hosts (local bash/zsh/fish, SSH, remote) × locations (repo
  root, repo subdir, non-repo dir): explorer shows literal pwd contents; git
  panel shows correct changes or empty state; diff htab opens correct diff;
  vtab title tracks basename until renamed.
- Remote back-compat: new client against an old host build → clamped
  explorer + hint, no errors.
- cua-driver (Linux): E2E — in a scripted repo, `cd` to subdir → assert
  explorer listing; `touch file` → assert git panel row; `cd /tmp` → assert
  empty state.

---

## Phase 4 — Per-vtab hosts + remote reattach

Goal: vtabs pinned to hosts (local / SSH / orca-serve); default-host setting;
the MUST requirement — reconnect restores everything.

### Tasks

1. **Default host setting.** `terminalModeDefaultHost?: ExecutionHostId` in
   `GlobalSettings` + a picker in the terminal-mode settings component
   (hosts: `local`, configured SSH targets, paired remotes — enumerate the
   way the classic "open on host" UI does; see host bucketing in
   `sidebar/worktree-list-host-filtering.ts:70` and
   `getActiveRuntimeTarget`).
2. **Host picker on "+".** Split-button: click = default host (or inherit
   from focused terminal, incl. its host); dropdown = host list.
   `createVerticalTab({ hostId })` already routes:
   `createFolderWorkspace` branches local IPC vs
   `callRuntimeRpc(target, 'folderWorkspace.create', …)`
   (`repos.ts:2519`; remote method
   `src/main/runtime/rpc/methods/folder-workspace.ts:98`).
3. **Hidden group per host.** The create RPC requires the group to exist on
   the owning host. Extend `ensureTerminalModeGroup(hostId)` to create it
   remotely (find the project-group creation RPC; if none exists, add one
   narrowly or create the group lazily server-side inside
   `folderWorkspace.create` handling — prefer whichever is additive).
   **Scout this first; it's the phase's main unknown.**
4. **Fetch on connect.** Verify remote-host folder workspaces (and thus
   vtabs) load into the client on connect —
   `store/slices/repos-all-hosts-folder-workspaces.test.ts` covers the
   mechanism; extend for the hidden group.
5. **Reattach.** Existing machinery: local `createOrAttach` by prior
   `sessionId` (`slices/terminals.ts:4049`), remote `pty.attach` with
   `remoteSessionIdsByTabId[tabId]` (`terminals.ts:4069, 4259-4290`;
   sessions host-partitioned in `workspaceSessionsByHostId`,
   `types.ts:3694`). Expected to work because vtabs are workspaces — the
   task is verification + fixing whatever assumes `worktree:` keys on the
   reattach path.
6. **Pwd across reconnect.** On reattach, seed `cwdByPtyId` from the
   terminal snapshot (host snapshots already carry `cwd` —
   `rpc/methods/terminal.ts:771, 2328, …`).

### Verification

- Unit: create/update/delete routing per host for the hidden group; default
  host resolution (inherit vs setting vs local fallback).
- Manual (the MUST): against the omarchy orca-serve host — build vtabs with
  running agents + scrollback; kill the client; relaunch; everything
  reattaches (scrollback, live processes, pwd-following panels). Also: mixed
  window (local vtab + remote vtab) switching cleanly; SSH vtab end-to-end.
- Mixed-version: new client ↔ old host — vtab creation may fail gracefully
  (clear error), never a crash or silent data loss.
- cua-driver (Linux): local client ↔ `orca serve` on localhost — scripted
  kill/reconnect/assert-restore. This becomes the regression test for the
  MUST requirement.

---

## Phase 5 — Agents, notifications, close semantics, polish

Goal: agent dots on vtabs, notification click-through, agent-aware close
confirmation, shortcut conflicts resolved — **and the pane-death recovery that
shares their code path** (task 0, folded in from Phase 4).

### Tasks

0. **Recover a pane whose remote session is gone** (folded in from Phase 4's
   findings; do this *with* task 3, not before it). Restarting an `orca serve`
   host while the client is up leaves every remote vertical tab showing
   "Remote terminal was closed." permanently: `remote-runtime-pty-transport.ts`
   `attach` runs in a fire-and-forget IIFE and its dead-session branch `return`s
   instead of throwing, so the recovery in `pty-connection.ts`
   (`clearTabPtyId` + `startFreshSpawn`, whose own comment says it exists for
   exactly this) never runs. Nothing prunes the stale `tab.ptyId`, so it recurs
   on every later launch. Reproduced in Phase 4 app QA.
   **Why it lives here:** the obvious signal, `onPtyExit`, closes the tab when it
   is the pane's only one — which is precisely what task 3 is rewriting. Fixing it
   in isolation means doing the close-semantics work twice. Constraints:
   - the path is shared with classic remote worktrees, so the fix must be verified
     with the flag off as well as on;
   - a lone dead pane must not silently delete its vertical tab — Phase 1's rule
     is that only `reason === 'user'` closes a vtab, and a dead remote session is
     not user intent;
   - prune the stale id, or the next launch reproduces the same pane.
1. **Agent status dots.** Agent state is already keyed by workspace
   (`store/slices/agent-status.ts`, ai-vault session→workspace mapping in
   `right-sidebar/ai-vault-session-worktree.ts`). Verify it resolves for
   `folder:` keys (scout `src/main/ai-vault/*` session scanners for
   worktree-only assumptions). Render running/attention dots on vtab rows
   (reuse the classic card's status source, not its component; respect the
   Codex attention debounce).
2. **Notifications.** Sidebar bell entry (reuse the classic notifications
   surface). Click-through: `src/main/ipc/notifications.ts` (~L510) parses
   `repoId` out of worktree ids — verify/fix routing for `folder:` keys so a
   click activates the right vtab + focuses the originating htab.
3. **Agent-aware close.** Upgrade Phase 1's plain confirm: enumerate running
   agent sessions in the vtab (agent-status selectors) and list them in the
   dialog; skip the dialog when nothing is running.
4. **Shortcut conflicts.** Resolve the Linux digit collision decided in the
   spec (vtabs `ctrl+1..9`, htabs `alt+1..9`) against real defaults in
   `src/shared/keybindings.ts` `conflictGroup`s; ensure `allowInTerminal`
   is set so chords work while a terminal is focused.
5. **Polish.** Vtab drag-reorder if deferred; empty-state for zero vtabs
   (creates the first one); menu-bar labels (`register-app-menu.ts` renders
   hint labels only — follow that convention, no real accelerators).

### Verification

- Unit: agent-status selector for `folder:` keys; notification
  routing for folder keys; close-confirm predicate; task 0's dead-session branch
  reaching the fresh-spawn recovery (and *not* deleting the vertical tab).
- Manual: launch Claude in an htab → dot appears; agent hits
  needs-attention → attention state + notification; click notification from
  another vtab → correct vtab + htab focused; close vtab with running agent
  → confirm lists it; without → no dialog.
- cua-driver (Linux): agent-flow script (spawn agent, wait for attention,
  assert dot + notification click-through).
- **Task 0:** with a second `orca serve`, restart the *host* while the client is
  up → the pane respawns a working terminal, the vertical tab survives, and a
  relaunch after that does not resurrect the dead id. Repeat with the flag off
  against a classic remote worktree.
- **Re-run Phase 4's reattach journey** (`scratchpad/p4-01-setup.mjs` …
  `p4-09-final.mjs`, ~10 min): kill the client, relaunch, assert tabs + layout +
  live sessions + scrollback + panels. This is the standing guard for the MUST —
  no CI equivalent is possible, since it needs a second `orca serve` and a SIGKILL
  of a desktop client, and a unit-level stand-in would give false confidence in
  the one place that must not have it.
- **SSH vertical tab smoke** (carried from Phase 4, which shipped the routing —
  per-target hidden group, remote-home resolution, connection-id routing — without
  ever exercising it against a real SSH host). Fold it into the agent run: create a
  vtab on an SSH target, `cd`, confirm the panels follow and an agent launches in
  it. Expect layout-only restore across a client restart; SSH session reattach is a
  known gap (`buildTerminalSessionData` writes no `remoteSessionIdsByTabId` for a
  folder workspace) and the spec calls SSH reattach best-effort.

### App QA results (executed 2026-08-13, HEAD `581b4e3be`, Linux/Xvfb `:99`)

Rig: a second `orca serve` built from this branch (profile `/tmp/orca-p5qa-s`, port
36781, paired as `p5host`), a dev client on its own profile (`/tmp/orca-p5qa-c`)
driven over CDP. The machine's production serve (`~/orca-src`, port 6768,
`~/.config/orca`) and the shared `~/.config/orca-dev` profile were not touched.
Screenshots under `scratchpad/p5-qa-shots/` (session-scoped, not in the tree).

| Item | Result |
| --- | --- |
| **Task 0 — host restart, panes recover** | **Pass.** Two remote vtabs with live shells; `orca serve` killed and relaunched (new pid). Panes recover on their own: stale `tab.ptyId` is pruned to `null` and a live PTY is rebound, vtabs survive, no permanent "Remote terminal was closed." banner. Verified over **seven** restart cycles; no stale-id recurrence on later launches. |
| Slow restart (host down ≳1 min) | **Pass with a manual step.** The runtime connection exhausts its retries and the pane shows "Remote runtime disconnected — Automatic retries stopped." with a **Reconnect** button; one click restores the pane, and because the host daemon outlives the serve process the *same shell pid* and full scrollback come back. This is the pre-existing shared remote-terminal disconnect UX, not a dead pane. |
| Task 0 with the flag **off** (classic remote workspace) | **Pass — no worse than before.** A classic folder workspace on the same host recovers a live shell through the identical restart, no banner. |
| **Reattach MUST (Phase 4 journey re-run)** | **Pass.** Two remote vtabs + one local vtab, a `nohup` counter loop, markers; client `SIGKILL`; relaunch. Same shell pids everywhere, `jobs` still reports the loop `Running`, scrollback intact through the pre-kill markers, the vtab that had `cd`-ed re-derives its name (`orca-p5qa-work`) and its explorer re-roots to the pwd (showing the loop's `counter.txt`), local and remote vtabs coexist cleanly. |
| **Agent status dots** | **Pass.** A real `claude` session in a vtab htab drives the row through `Working` → `Done` → `Needs permission`, including while a *different* vtab is active. Agent status resolves for `folder:` keys (`worktreeId: folder:<uuid>` in `agentStatusByPaneKey`). The dot carries an sr-only state label. |
| **Notifications + click-through** | **Pass (in-app path).** Completion sets `unreadAgentCompletionPanes` and the sidebar Agents row shows its badge. With `experimentalActivity` on, the activity page lists the vertical tab under its own name with a live pane preview (the round-2 fix), and its jump action, invoked from another active vtab, lands on the right vtab **and** its htab (`activeWorkspaceKey` + `activeTabIdByWorktree` both correct, `activeRepoId` left null). The OS banner itself could not be exercised under Xvfb (no notification daemon). |
| **Agent-aware close** | **Pass.** Close with a running agent lists `claude` in the dialog; Cancel leaves the tab; Close tab deletes the vtab and kills its processes (verified: a `sleep 600` started in the tab was gone after confirming). Close with no agent shows the same dialog with no agent named — the deliberate always-confirm decision recorded below. |
| **No cry-wolf after a restart** | **Pass.** With the agent process killed while the client was down, the restored entry comes back `done` and the close dialog names nothing. |
| **SSH vtab smoke** | **Pass.** Loopback `sshd` on port 2222 with a session-scoped host key and its own `authorized_keys` (`~/.ssh/authorized_keys` untouched). Vtab created on the SSH target, shell spawns over SSH (`SSH_CONNECTION` confirms), `cd` re-titles the tab and re-roots the explorer over SFTP. Across a client restart it did **better** than the documented expectation: the same shell pid, scrollback and pwd came back, not just the layout. |
| **Regression sweep, flag off** | **Pass.** Classic sidebar renders normally and the three vertical tabs are filtered out of it; the classic remote workspace behaves as before. |
| Typecheck / lint / suite | **Not run — no code was changed by this QA pass** (the one candidate fix was reverted, see below). The tree is identical to `581b4e3be`. |

**Defects found (none of them fixed in this pass; see the gap list below):**

1. A host restart adds a **duplicate terminal tab** to whichever workspace is focused.
   Reproduced 5/5 times with the flag on and **also with the flag off on a classic
   remote workspace**, so it is an upstream defect, not a terminal-mode one.
2. Creating an SSH vertical tab **requires the SSH target to be connected already**,
   and otherwise fails with a raw internal error string.
3. A live remote pane can end up with `tab.ptyId === null`, which silently unhooks the
   pwd-derived panels and the vtab auto-name.

A candidate fix for (1) — skipping the lost-session respawn for host-mirrored panes —
was written, tested and **reverted**: instrumentation proved the duplicate does not come
from `onPtySessionLost` at all (that callback never fired in the reproducing cycles), so
the change would have been an unproven behavior change on the classic remote path.

---

## Phase 5 implementation notes (recorded 2026-08-13)

- **The lost-session signal is its own callback, not `onPtyExit`.** `onPtyExit` retires a PTY
  that *was* live, and for a pane that is its tab's only one that closes the tab. Routing a
  dead remote session through it would delete a user's terminal because a server restarted, so
  the transport reports `onPtySessionLost` and the pane answers with the same
  `clearTabPtyId` + `startFreshSpawn` its synchronous attach-failure path already ran. The
  teardown itself is shared (`tearDownRemoteTerminal`) so a lost session leaves no half state:
  an earlier draft cleared only `connecting`, leaving `handle` set and attachment waiters to
  time out after 15 s.
- **The respawn holder is nulled on dispose.** It is armed inside the attach branch and fired
  from an in-flight `resolvePane` round trip, so a pane unmounted mid-attach — a remount, or
  React StrictMode's mount→dispose→remount — would otherwise spawn an orphan PTY on the host.
- **Closing a vertical tab always confirms.** Phase 5 was specified as "skip the dialog when
  nothing is running", and that was implemented and then reverted: the action behind the dialog
  is `deleteFolderWorkspace`, which is irreversible and kills every process in the tab, and
  `Mod+Shift+W` is one key from `Mod+W`. App QA confirmed the cost — a backgrounded job died
  with no prompt. The "confirmations stop being read" argument applies to reversible actions.
  What the phase actually adds is the answer to *what dies*: the dialog names the agents. It
  deliberately does not claim the list is exhaustive, because there is no signal for "a build
  is running" — `command-finished` (OSC 133;D) exists, but no `command-started` fact does, and
  Phase 2 recorded that the `C` marker doubles per prompt in some shells, which would make a
  "running" flag sticky and the dialog cry wolf. A real foreground-process signal is Phase 6.
- **The close list cross-checks the row's own dot.** The dialog reads live agent entries, but
  the status dot attributes through a *different* function (orchestration parents, legacy pane
  keys). When the entries name nothing and the dot still says working/permission, the dialog
  shows one generic row — a dialog saying "no agents" under a spinning dot is the worst
  disagreement available.
- **The Agents row is one shared button.** The first version copied `SidebarNav`'s markup, and
  the copy drifted immediately: its badge counted worktrees only, so the row could not see a
  vertical tab. `SidebarAgentsButton` is now shared by both sidebars.
- **Unread counting is mode-branched, deliberately.** A vertical tab really does persist
  `isUnread`, but it is only reachable and clearable in terminal mode. Counting one with the
  flag off produces a Dock badge no surface can render and no click can dismiss, which
  survives restarts. The branch lives in **one** named selector at the catalog choke point
  (`selectBadgeCountableFolderWorkspaces`) rather than being copy-pasted into both badge
  hooks: the first version duplicated it and paid for it with two exemptions on the
  isolation tripwire, whose header says not to add them.
- **Classic folder workspaces now count toward the badges too.** Before Phase 5
  `getUnreadBadgeCount` had no folder-workspace input at all, so an unread *classic* folder
  workspace contributed nothing to the Dock badge or the Agents badge. Passing the classic
  catalog in the non-terminal arm fixes that. It is an intentional upstream fix, called out
  here because no other document mentions it.
- **Notification click-through needed four fixes, not one.** The click binding was gated on
  `worktreeId.includes('::')`, so a `folder:` key bound no handler at all; the activation path
  fetched a repo that does not exist; the OS banner titled itself with the raw `folder:<uuid>`;
  and the Dock badge ignored folder workspaces. Activation routes through
  `activateAndRevealWorkspace`, whose folder branch is what enforces the path-status gate —
  the worktree-only entry point would activate a missing or disconnected tab and stamp a
  synthetic repo id into `activeRepoId`.

### Review round 2 — fixes landed after the phase commit

A second independent review found four real defects in the committed phase; all were fixed
on top of it.

- **The bell led to a page that could not see vertical tabs.** `ActivityPrototypePage` builds
  its workspace index from `worktreesByRepo`, so every vertical-tab thread rendered as
  "Standalone terminal" with the jump action dead and no pane preview — the same gap the
  phase had just fixed one file over in `use-notification-dispatch.ts`. All four call sites
  gate on that one map, so `selectActivityWorktreeMap` fixes them together; the jump and the
  terminal activation also had to branch, because a vertical tab's `repoId` is a synthetic
  `folder-workspace:` stamp and `setActiveWorktree` cannot take a `folder:` key.
- **The lost-session guard was weaker than its siblings.** `connect()` bumps only
  `lifecycleEpoch` while `attach()` bumps both it and `attachGeneration`, and the attach
  branch checked generation only. A `connect` landing during an in-flight `resolvePane` was
  therefore invisible, and the stale attach would tear down and respawn the session `connect`
  had just created — on the *classic* remote-worktree path. The guard now matches the sibling
  `.catch`.
- **The recovery left a permanent lie on screen.** `setTerminalError` is sticky until the user
  dismisses it, so surfacing "Remote terminal was closed." before respawning left that banner
  sitting over a live shell. The message is now emitted only when no recovery is wired to hear
  the signal, which is exactly when it is still true.
- **The close dialog could cry wolf in the direction the fallback missed.**
  `selectLiveAgentStatusEntriesForWorktree` applies no freshness or `restoredUnconfirmed`
  filter, but the summary behind the status dot does. A hydrated-unconfirmed row after a
  client restart, or any `working` row older than 30 minutes, gave a grey dot *and* a dialog
  naming an agent. The dialog now applies the same gate.

Two smaller ones: the second attach call site (the pending-spawn branch) never armed the
respawn holder, so a lost session there pruned the tab's id and left the pane dead; and the
new status dot shipped `aria-hidden` with no sr-only label, which every sibling caller pairs.

**Correction to the Phase 5 report:** that commit was reported as `pnpm lint` clean. It was
not — `verify:localization-coverage` was failing on the dialog's generic `'agent'` label,
which is now localized. The lint gate is green as of the follow-up.

### Still open (recorded, not fixed)

- **A host restart duplicates the focused workspace's terminal tab** (found in Phase 5 app QA;
  **pre-existing and not terminal-mode-specific** — it reproduces with the flag off against a
  classic remote folder workspace on the same host). `web-session-tabs-sync.ts`
  `applyActiveSnapshot` calls `shouldRespawnWebRuntimeTerminalAfterWake`, whose conditions
  (`snapshotIsFresh`, `localTerminalCount > 0`, `!hasLiveLocalPty`, host terminal count `0`)
  are all true for a *few hundred milliseconds* after the host comes back, before the host has
  republished its own restored terminal for that workspace. The client asks for a terminal, the
  host's restore lands on the original tab, and the workspace ends up with two. It only ever hits
  the **active** workspace, because that predicate is keyed on `activeWorktreeId` — every
  unfocused vertical tab recovered with exactly one tab in every cycle. Fixing it means telling
  "the host has no terminals" apart from "the host has not republished yet", which no current
  signal does; a settle window on the first post-reconnect snapshot is the cheap candidate.
  Evidence: instrumented `createTab` (never called) and `createWebRuntimeSessionTerminalResult`
  (called once per restart, stack through `applyActiveSnapshot`).
- **An SSH vertical tab cannot be created unless the SSH target is already connected.**
  `terminalMode:ensureContext` resolves the start directory through
  `resolveRemoteHomePath(connectionId, '~')`, which returns the literal `~` when
  `getActiveMultiplexer(connectionId)` is null, and `folderWorkspaces:create` then rejects it —
  the user sees a toast carrying the raw `folder_workspace_path_unavailable:~`. Connecting the
  target first (Settings → SSH, or any classic flow) makes the same click work end to end. The
  obvious fix is to `await connectRegisteredSshTarget(connectionId)` inside the resolver in
  `attach-main-window-services.ts`; it was left out of this QA pass because it puts an unbounded,
  credential-prompting connect behind a "+" menu click with no progress UI — a product call for
  Phase 6, not a QA fix.
- **A live remote pane can hold `tab.ptyId === null`.** Seen once after repeatedly closing the
  duplicate tab from the defect above: the surviving tab kept a working shell (typing, correct
  pid) while `tab.ptyId`, `ptyIdsByTabId` and the layout's leaf map were all empty. Everything
  keyed on the pty then degrades quietly — the panels fall back to the workspace root, the vtab
  auto-name reverts from the pwd, and the close dialog's process accounting cannot see the pane.
  Reproduction is entangled with the duplicate-tab defect; it did not occur in any clean cycle.
- **Cosmetic, from the same QA run:** a vertical tab's agent thread is grouped under
  "UNKNOWN PROJECT" on the activity page (a vtab's `repoId` is the synthetic
  `folder-workspace:` stamp, which no project row matches); and toggling the flag off while a
  vertical tab is the active workspace leaves that tab's terminal rendered in the main pane —
  the sidebar switches to classic correctly, but the pane only clears once a classic workspace
  is picked.
- **Two attribution functions cross-check each other.** The dialog and the status dot answer
  "which agents does this workspace own" through different code, and the disagreement is
  patched with a synthetic row whose `paneKey` is not a pane key. The freshness fix above
  removes the acute symptom; collapsing them onto one attribution is a refactor of a shared
  classic module and belongs in Phase 6.
- **`connectPanePty` gained more connect-scope mutable state.** The respawn holder is declared,
  armed and disarmed in three regions of a 8,400-line function. Extracting it to a small
  module would make the arm/disarm balance readable and unit-testable.
- **The notification IPC's `worktreeId` carries two id spaces**, discriminated by a prefix
  parse on one side and a `::` substring test on the other. One `resolveNotificationTarget`
  parse would replace three checks in two vocabularies.

### Deliberately not done in Phase 5

- **`allowInTerminal` on `tab.selectByIndex`.** The design doc asked for it; it was implemented
  and reverted because `src/shared/keybindings.test.ts` proved the flag is read by the
  terminal-first context gate — setting it takes `Ctrl+1..9` (macOS) / `Alt+1..9` away from
  every *classic* user who chose `terminal-first`, to fix a terminal-mode ergonomic. The digit
  defaults already match the spec's table (`workspace.selectByIndex` = `Mod+1`, which already
  carries `allowInTerminal`), so vertical-tab switching works under any policy; horizontal-tab
  switching under `terminal-first` does not. That is a product call about whose chord wins, and
  it is left to Phase 6 rather than taken silently.
- **Vertical-tab drag-reorder** stays deferred for Phase 1's recorded reason (the classic
  mechanism is entangled with `WorktreeList`'s virtualized row model). `manualOrder` is still
  unused; ordering remains `createdAt` ascending.
- **Menu-bar labels** (`register-app-menu.ts` hint labels) were not touched.

---

## Phase 6 — Hardening & acceptance

Carried-in fixes (decided at Phase 5 close, 2026-08-13; user delegated):

0a. **SSH "+" connect UX** — clicking "+" for a disconnected SSH host must show
    a connecting state on the control and a clean, human-readable failure
    toast instead of the raw `folder_workspace_path_unavailable:~`. Keep the
    change inside terminal-mode files (await `connectRegisteredSshTarget`
    with visible progress; no silent unbounded hang).
0b. **Cosmetics** — (i) vtab agent threads on the activity page must not
    group under "UNKNOWN PROJECT" (give them a sensible heading, e.g. the
    vtab name or "Terminal tabs"); (ii) toggling the flag off must not leave
    the last vtab's pane rendered — fall back to classic empty/selected
    state.
0c. **Housekeeping** — kill the stale QA leftovers from earlier sessions
    (orca serve pid 3204275 on :36771 with profile /tmp/orca-p5s; orphan
    daemons 2172379/2204509 for the deleted /tmp/orca-p4s / /tmp/orca-p4c
    dirs). Verify against the process list before killing; the production
    serve (:6768, ~/.config/orca) is untouchable. Then `git add -f` both
    terminal-mode docs onto the branch (they are the merge contract).
    Accepted, NOT to be fixed: the upstream duplicate-tab-on-host-restart
    race and its null-ptyId symptom (documented in "Still open").

1. Run the full **daily-driver checklist** from the spec (§5) on Linux via
   the CDP/cua-driver harness: dev client on this machine against an
   isolated branch-built `orca serve` on this machine. macOS local and
   macOS client → omarchy remote host remain the user's manual passes.
2. **Reattach + host-restart proof** re-run on final HEAD (client SIGKILL
   journey and host-restart recovery).
3. **Upstream merge dry-run:** merge the latest upstream stable tag on a
   throwaway branch off the feature branch; conflicts must be confined to
   the spec §3.3 touch-point list — update that list to match reality.
   Abort the merge afterwards; do not land it.
4. **Tripwire wiring:** add a terminal-mode smoke to the update-from-upstream
   flow (~/.claude/skills/update-from-upstream) — run the
   terminal-mode-isolation invariant test + typecheck after every upstream
   merge. Keep the skill edit minimal.
5. Windows sanity: flag hidden, classic mode untouched (CI packaging only;
   not in the interactive test matrix).
6. Update both docs with any drift discovered during implementation.

### Phase 6 implementation notes (recorded 2026-08-13)

- **Housekeeping (0c) done.** Each stale pid was matched against its cmdline before the
  kill: the `orca serve` on :36771 (its daemon child owned `/tmp/orca-p5s`) plus that
  daemon, and the two orphan daemons whose `/tmp/orca-p4s` / `/tmp/orca-p4c` profiles were
  deleted. The production serve (`~/orca-src`, :6768, `~/.config/orca`) and the shared
  `~/.config/orca-dev` daemon were left running and verified alive afterwards.
- **The SSH "+" fix is a connect, not a message fix.** The raw
  `folder_workspace_path_unavailable:~` was a *symptom*: `resolveRemoteHomePath` answers
  `~` with `~` when the target has no live multiplexer. The tab now connects the target
  first, on the click's own await, through the same registry the classic connect surfaces
  use — `isSshConnectInFlight` + `isConnectingSshStatus` so a dial in flight or a
  host-driven transient is *waited out* rather than dialed again (a second dial on a
  passphrase-gated target is a second credential prompt), `SSH_RECONNECT_UI_TIMEOUT_MS`
  rather than the composer's 20 s (an interactive passphrase alone allows 120 s
  host-side), and the resolved state written back because `ssh.connect` can resolve
  before the state-change IPC lands.
- **The unresolved home is rejected where it is known.** `createVerticalTab` throws a
  readable error when `homeDir` is empty or still starts with `~`, instead of letting a
  folder workspace be created at `~` and reverse-engineering the resulting path error out
  of three layers of wrapping. The first draft did the archaeology; it was deleted.
- **`formatFolderWorkspaceCreateError` had never matched an IPC failure.** Its
  `startsWith` runs against `Error invoking remote method 'folderWorkspaces:create': Error: …`,
  so every coded create failure — classic folder workspaces included — showed the user the
  raw code. Fixed in the canonical helper rather than re-implemented in a terminal-mode
  module.
- **Progress is store state, not button state.** `Mod+T` and the empty-state button start
  the same wait as the "+", so the in-flight count lives in the slice and both controls
  subscribe. A local create still costs nothing visible; an SSH one shows a spinner for
  the whole connect.
- **The flag-off fallback cannot live in the sidebar.** The toggle is in the Settings
  view, where `Sidebar` is unmounted — the hook would only fire on the next sidebar mount,
  one frame after the stale pane rendered. It is an App-level null leaf next to
  `AgentHibernationGate`. It answers "is this a vertical tab" by hidden-group membership,
  so a classic folder workspace stays selected.
- **The Activity heading is keyed on the catalog, not on `folder:`.** A classic folder
  workspace also reaches that page (`standaloneActivityWorktree` keeps the `folder:<id>`
  id), so a key-shape test would have relabelled classic threads "Terminal tabs" with the
  flag off. The keys come from `selectTerminalModeWorkspaceKeys` and the set is empty
  outside terminal mode.

**Review round (one, proportionate to the diff):** nine findings, all triaged as real and
fixed — the classic-folder-workspace regression above (blocker), the string archaeology,
the wrong SSH timeout budget, the hand-rolled status check, button-local progress state,
the sidebar mount point, a state snapshot held across a minutes-long await, an unfenced
`ensureContext`, and the missing §3.3 entries.

### Acceptance run (executed 2026-08-14, Linux/Xvfb `:99`, final Phase 6 code)

Rig: dev client on its own profile (`/tmp/orca-p6c`) driven over CDP, plus real X key events
through `xdotool` so the menu accelerators fire the way they do for a user; a second
`orca serve` built from this branch (`/tmp/orca-p6s`, port 36791, paired as `p6-serve`). The
machine's production serve (`~/orca-src`, :6768, `~/.config/orca`) and `~/.config/orca-dev`
were not touched. Screenshots under `scratchpad/p6-shots/` (session-scoped, not in the tree).

| Checklist row | Result |
| --- | --- |
| Create / rename / close vtabs; auto-title follows pwd until pinned | **Pass.** Created from the empty state, the "+", the host picker and `Ctrl+N`; `cd` retitles the tab (`p6-hostwork`), an inline rename pins it and a later `cd` no longer renames it — the pin survived a client restart. **Reorder: not implemented** (deferred since Phase 1, `manualOrder` unused, `createdAt` order). |
| New vtab inherits host + pwd; default host; host picker | **Pass.** `Ctrl+N` from a tab sitting in a repo opened there; the picker lists Local / `p6-serve` / an SSH target and pins the new tab to the pick; a remote tab starts at the host's `$HOME`. |
| New htab inherits pwd; shortcuts on Linux | **Pass.** `Ctrl+T` inherits the pwd; `Ctrl+1..3` switch vertical tabs; `Alt+1/2` switch horizontal tabs (default policy — the `terminal-first` caveat from Phase 5 is unchanged); `Ctrl+W` closes an htab without touching the vtab; `Ctrl+Shift+W` opens the close dialog. |
| Explorer re-roots on `cd` | **Pass** for bash, local and remote (`p6-hostwork` → `sub/deeper` → repo, over the host grant). zsh/fish were not re-exercised in this pass (Phase 2/3 covered them). |
| Git panel: repo detection, empty state, diff | **Pass (local).** Nearest-repo detection from the pwd, `CHANGES 1 · README.md +2 M`, the file opens a correct diff htab, and leaving the repo shows "Not a git repository — cd into one to see changes." **Remote is the documented clamp**: a remote tab shows the panel only when the pwd's repository *is* the workspace root, and even then `git.status` stays selector-addressed, so the changes list was empty. Pre-existing and recorded above ("`git.status` is still selector-addressed"). |
| Fallback polling covers a stripped shell | **Pass.** Client relaunched with `ORCA_DISABLE_OSC7=1`; a new local vtab still followed `cd` into `sub/deeper` — tab auto-name and explorer both re-rooted from the process-cwd poll. |
| Agent in an htab: dot, attention, click-through | **Pass.** A real `claude` session drove its row `Working` → `Done`; the Activity page listed the thread with a live preview and **"TERMINAL TABS"** as its heading (item 0b-i), and "Jump to workspace" from there landed on the right vertical tab with its terminal focused. |
| Restart restores layout + pwds; reattach restores live sessions | **Pass (the MUST).** Client `SIGKILL` + relaunch: all four vtabs back, the remote tab reattached to the **same shell pid** with scrollback and pwd intact and its `nohup` counter still ticking, the local tab kept its pwd and scrollback. |
| Host restart | **Pass.** `orca serve` killed and relaunched: the remote pane recovered on its own, same shell pid, correct pwd, no error banner, no vertical tab lost. |
| Close-with-running-agent confirmation | **Pass.** With `claude` mid-turn the dialog names `claude`; Cancel leaves the tab and its processes alone. |
| Classic mode with the flag off | **Pass.** Toggled from Settings: the vertical strip disappears, **no terminal pane is left rendered** (item 0b-ii), and the classic sidebar plus its empty state render normally. Toggling back restores all four tabs. |
| SSH "+" connect UX (item 0a) | **Pass.** Against a deliberately unreachable target the "+" goes busy (`aria-busy`, "Opening terminal tab…") for the whole connect, and the failure toast reads "Failed to create terminal tab / connect ECONNREFUSED 127.0.0.1:59" — no `folder_workspace_path_unavailable:~`, no Electron `invoking remote method` wrapper, no phantom tab. |

Two things the run found and fixed on the spot: the failure toast still carried Electron's IPC
wrapper (now stripped in `terminal-mode-ssh-connect.ts`, with a unit test), and the earlier
draft's activity heading would have mislabelled classic folder workspaces (fixed before the
run, see the review round above).

macOS local and macOS client → omarchy remote host remain the user's manual passes; Windows
stays CI-only (the flag cannot be enabled there).

---

## Phase 2 implementation notes (recorded 2026-08-13)

- **The cwd fact is emitted from `recordOsc7MetadataForPty`, not from the
  `onPtyData` call site.** Snapshot-seed paths (`maybeHydrateHeadlessFromRenderer`,
  provider-snapshot replacement) scan OSC 7 too; emitting at the single place that
  decides `cwdChanged` means every one of them reaches the renderer, and the fact
  rides its own batch because that call runs before the chunk-application window.
- **There are THREE rcfile copies, not two.** This doc named the local and daemon
  wrappers; `src/relay/pty-shell-launch.ts` is a third, and it is the one SSH hosts
  run. All three interpolate `src/main/shell-osc7-integration.ts`. Anything that edits
  shell integration has to touch all three or SSH silently diverges.
- **Where the emit sits in the prompt is load-bearing.** Each bash wrapper closes its
  prompt window with a hook that reopens the DEBUG trap (`__orca_osc133_prompt_done`
  locally and in the relay, `__orca_osc133_epilogue` in the daemon). An OSC 7 entry
  placed *after* it reads as a foreground command: measured, that doubles the OSC 133
  `C` per prompt and then emits a bogus `D`, which strands agent rows in "working". So
  the entry is spliced before that hook, and — belt and braces, the same defense
  `__orca_prompt_mark` already had — `*__orca_osc7_emit*` is named in all three
  preexec skip lists. In zsh the hazard is the reverse: the hook must be *appended* to
  `precmd_functions`, after `__orca_osc133_precmd` has read `$?`.
- **The registration form is exported, not retyped.** Two shapes exist because the
  wrappers build PROMPT_COMMAND differently (`__orca_append_prompt_command` helper vs
  one assignment), so the module exports both and every wrapper is one interpolation.
- **Shell integration is NOT flag-gated, deliberately.** The rcfiles are generated once
  per userData root and shared by every PTY on that host, and a remote/SSH host never
  learns the client's flag — a per-spawn gate would make the hosts disagree with each
  other. Consequences with the flag OFF, recorded rather than hidden: split-pane cwd
  inheritance (`resolve-split-cwd.ts`) now prefers the shell's logical `$PWD` over the
  process's physical cwd, and `resolveTerminalCwd` — which resolves relative paths
  clicked in terminal output — switches to the same source for every wrapped shell
  instead of only for users whose own shell emitted OSC 7. Both are the behavior every
  other terminal has. The renderer slice itself stays inert: nothing installs the cwd
  observer or the poll outside terminal mode.
- **`ORCA_DISABLE_OSC7` is the field kill switch.** The emitter ships to every
  shell on hosts Orca cannot rebuild quickly (SSH, remote daemons), so the
  registration guard honors an env var: set it on a PTY and that shell reports
  nothing. It is the cheapest possible answer to "un-gated rollout with no way
  to turn it off".
- **One guard does three jobs.** Registration is skipped when the effective
  `PROMPT_COMMAND` / `precmd_functions` already matches `*osc7*` — which also matches
  Orca's own hook, so re-sourcing an rcfile cannot double-register — and on
  MSYS/Cygwin/WSL, whose POSIX paths the host resolves under a Windows path flavor
  (UNC share, or an untranslatable Linux path). The list of foreign emitters is
  deliberately not exhaustive: main dedupes on the value, so a shell Orca fails to
  recognize just costs ~60 bytes a prompt.
- **Percent-encoding is byte-wise** (`LC_ALL=C` in bash, `no_multibyte` in zsh), or a
  non-ASCII directory decodes to mojibake host-side. Verified against real bash 5.3 and
  zsh 5.9 with spaces, `#`, `%` and UTF-8. zsh also probes `printf -v` before
  registering: it landed in zsh 5.1, and an older SSH host would otherwise print an
  option error at every prompt whose path needs escaping.
- **The cwd path has its own sequence guard.** The replay snapshot is an async
  IPC round-trip, so a `cd` observed while it was in flight would otherwise be
  overwritten by the older directory the snapshot carries. The consumer registry's
  existing guard cannot cover it: `lastLiveTitleSeq` only advances on *title*
  facts, and a shell with a static title never emits one. The observers therefore
  keep their own per-PTY high-water mark.
- **The new-htab pwd is applied at the affordance, not in `createTab`.** That
  reducer has ~25 callers — agent launches, quick commands, background/setup
  terminals, CLI-created sessions, pane detach — and each owns its own start
  directory (pane detach in particular wants the *detached* pane's, not the
  focused tab's). `openNewTerminalTabInActiveWorkspace` is the Mod+T / tab-bar
  "+" / Cmd+J funnel, so the inheritance lives there.
- **The 300 ms debounce is keyed on the workspace.** Switching vertical tabs is a
  discrete action, not `cd` churn, so a new workspace key applies immediately —
  otherwise every switch shows the previous tab's directory for 300 ms and
  re-roots Phase 3's consumers twice.
- **Stickiness is derived, not stored.** `activeTabIdByWorktree` already holds the last
  *terminal* tab while an editor/diff tab is focused, so `getActivePwdForVtab` gets the
  spec's sticky rule for free — no extra state to keep in sync on tab close.
- **`cwdByPtyId` entries carry their source.** Only `'osc7'` retires the fallback poll,
  and a `'poll'` value can never overwrite an `'osc7'` one: the poll reads the shell
  *process*, which lags a `cd` and is plain wrong while a foreground process runs.
- **Dead PTYs are forgotten explicitly.** `window.api.pty.onExit` clears the entry:
  Orca reuses PTY ids across incarnations, and a retained directory would be shown for
  the shell that replaced it. The 256-entry prune stays only as a backstop for PTYs
  whose exit never reaches the renderer (remote ones close over RPC).
- **`cwd` facts never enter the handoff buffer.** That bounded 64-batch buffer exists to
  carry bells/completions across a reveal remount; a `cd`-churning shell would otherwise
  flush it. Cwd facts reach their observers before the consumer lookup, so dropping them
  there loses nothing.
- **Remote cwd rides the multiplexer's own callback contract.** The `Metadata` branch
  calls `stream.callbacks.onCwd`, and `remote-runtime-pty-transport.ts` answers it —
  the only place that knows which PTY id a stream's terminal handle belongs to. A
  module-global sink keyed by handle was tried first and reverse-resolved the PTY id by
  scanning tabs, which mis-attributed across environments sharing a handle string. That
  callback is terminal-mode gated and clears the entry on stream end, because a remote
  PTY closes over RPC and never raises the `pty:exit` the local invalidation listens to.
  Against a current host the same cwd arrives twice (fact + frame, idempotent); the
  frame is really the compatibility path for hosts older than the fact.

### Known gaps carried to later phases

- **Foreign OSC 7.** A local shell running `ssh`/`tmux`/`docker` emits the *remote*
  shell's OSC 7, so the tracked pwd is a path that does not exist locally (the same
  caveat `use-checks-panel-terminal-worktree.ts` documents — it deliberately reads the
  process cwd for that reason). Consequences to settle in Phase 3: the sidebar shows a
  nonexistent path, and `Mod+T` inherits it as `startupCwd`, where
  `allowMissingCwdFallback` silently reroutes the new tab to the workspace root. Main
  already tracks the discriminator (`terminalFileUriHostnameByPtyId`) next to the emit
  site; carrying it on the fact is the cheap fix when Phase 3 decides the policy. It is
  left alone here because main's *existing* `resolveTerminalCwd` already prefers
  OSC 7 over the process cwd — inverting that is a product decision, not plumbing.
- **A PTY that once emitted OSC 7 is never polled again.** `exec`ing into a shell with
  no integration therefore freezes the pwd at the last prompt. Retiring the poll is what
  keeps `lsof` off the hot path on macOS; revisit only if the case shows up in practice.
- **Remote workspaces on an old host have no fallback.** The poll deliberately skips
  remote-runtime PTYs, so if the host's shells report nothing the pwd stays at the tab's
  start directory. Phase 4 owns remote hosts and should decide whether `terminal.getCwd`
  over RPC is worth a round trip.
- **The cross-version wire harness has no `Metadata` step.** Nothing new is sent, so the
  contract holds by construction today; Phase 4 should add the journey step (host emits
  `Metadata { cwd }`; assert not rejected, never rendered as output, no ack frame) when
  remote vtabs make that path load-bearing.

## Resolved questions (settled 2026-08-13, code-verified — treat as decisions)

| # | Question | Phase | Resolution |
|---|---|---|---|
| 1 | Fish OSC 7 wrapper? | 2 | **No wrapper.** Fish emits OSC 7 natively; `resolveProcessCwd(pid)` fallback (`src/main/daemon/terminal-host-session-cwd.ts`) covers silent shells. |
| 2 | Remote hidden-group creation | 4 | **Existing RPC.** Call `projectGroup.create` (`src/main/runtime/rpc/methods/repo.ts:123`) on the target host, then `folderWorkspace.create`; host hard-fails on missing group so ordering is safe. |
| 3 | Gate for absolute-path `files.readDir`/`git.status` params | 3 | **Capability token, never version compare.** Add a const in `src/shared/protocol-version.ts` (e.g. `files.absolute-path-scope.v1`), advertised via `status` RPC, checked with `assertRuntimeEnvironmentCapability` (`runtime-rpc-client.ts:322`). Old hosts zod-`.strip()` unknown params → wrong data, hence the hard gate. |
| 4 | Keybindings | 1/5 | **Add zero new chords.** Reuse `workspace.create` (Mod+N), `tab.newTerminal` (Mod+T), `tab.close` (Mod+W), `workspace.selectByIndex` (Mod+1..9), `tab.selectByIndex` (Ctrl+1..9 mac / Alt+1..9 linux). Bind the currently-empty `workspace.delete` default to Mod+Shift+W for close-vtab. |
| 5 | First terminal on fresh folder workspace | 1 | **Automatic** — `shouldAutoCreateInitialTerminal` + `Terminal.tsx` activation path creates it. Caveat: skipped for paired web clients (host-authoritative session tabs). |
| 6 | PTY disposal on `folderWorkspaces.delete` | 1 | **Leak confirmed — must fix.** Add main-side disposal in `deleteFolderWorkspace` (mirror `teardownMissingManagedWorktreeTerminals`, `orca-runtime.ts:21163`) so local and remote deletes kill the workspace's sessions. |

## Testing conventions

- Unit tests: vitest, colocated `*.test.ts` (e.g.
  `store/slices/repos-all-hosts-folder-workspaces.test.ts` is the model for
  host-routing tests). Pure predicates/helpers get direct tests; keep React
  component testing minimal.
- E2E: cua-driver CLI on Linux is the primary harness from Phase 1 onward;
  every phase adds its scripts so the suite accretes into the acceptance
  run. Stable `data-testid`s are part of each phase's deliverable.
- Per AGENTS.md: no `max-lines` disables; concrete file names; concise
  comments; cross-platform key handling (`isMac` checks, never bare
  `metaKey`); wire changes follow `remote-wire-compatibility.md`; git
  commands respect the 2.25 baseline + `GitCapabilityCache`.

---

## Phase 1 implementation notes (recorded 2026-08-13)

Deviations and consequences worth carrying forward:

- **Vtab ordering** is `createdAt` ascending, not `sortOrder`/`manualOrder` (task 3
  above). Drag-reorder is deferred to Phase 5.
- **The hidden group has no folder root.** `normalizeFolderWorkspaces`
  (`src/shared/folder-workspaces.ts`) drops workspaces whose group has a null
  `parentPath`, so it gained one clause keeping terminal-mode workspaces instead.
  Inventing a root (`$HOME`) was tried first and is wrong: it feeds the
  authorized-filesystem scope, the connection-id migration and the path-status
  probe a directory the user never opened. A vtab's own `folderPath` still
  authorizes that directory — the same contract as any folder workspace — and
  Phase 2 replaces the `~` default with the focused terminal's pwd.
- **A vtab's host is its group's host, never a path heuristic.**
  `inferFolderWorkspacePathConnection` and `backfillFolderScopeConnectionIds`
  short-circuit for terminal-mode groups. Without that, a machine with both local
  and SSH repos under `~` resolves `ambiguous` and vtab creation throws
  `folder_workspace_connection_ambiguous`; with only SSH repos it silently spawns
  terminals on the remote host. Phase 4 sets `connectionId` on the per-host hidden
  group and the same short-circuit routes it.
- **`workspace.delete` now ships a default chord** (`Mod+Shift+W`, macOS and Linux
  only). This is the one behavior change visible with the flag OFF: classic users
  gain a bound destructive shortcut. It routes through the existing confirm flow
  and passes `forceConfirm`, so it cannot inherit `skipDeleteWorktreeConfirm` —
  a preference the user opted into for the sidebar action, not for a global chord.
  Revisit in Phase 5 alongside the shortcut-conflict pass if the trade is unwanted.
- **`terminalModeAutoName` is written but not yet read.** Phase 3's auto-title is
  the consumer. It is also not mapped by `folderWorkspaceToWorktree`, and old
  remote hosts zod-strip it from `folderWorkspace.update` — Phase 4 should
  capability-gate the remote rename if pinning must be authoritative there.
- **Close-last-htab-closes-vtab is driven by intent, not by observed state.**
  `closeUnifiedTab` (the single close funnel) calls
  `closeVerticalTabIfEmptied(workspaceKey)` at its tail. Three conditions, each
  learned the hard way:
  - **Workspace scope, not `wasLastTab`.** `wasLastTab` is the *tab group's* order, so
    using it destroyed a split vtab when only one of its groups emptied — taking the
    other group's running agent with it. The signal is the same emptiness
    `shouldDeactivateWorktree` computes: no unified tabs, no terminal rows, no browser
    tabs, no open files.
  - **`reason === 'user'` only.** The reason is threaded from `terminals.closeTab`.
    Cleanup, `pty-exit` and paired-mobile closes are not intent to delete a workspace.
    Consequence: typing `exit` in the last terminal leaves an empty vtab rather than
    closing it; re-activating it spawns a fresh terminal. Revisit in Phase 5.
  - **Never from an empty tab record.** Tab-model reconciliation writes the same empty
    record when it prunes terminals whose runtime rows went stale, so inferring from
    state deletes live workspaces. An earlier reconciler did exactly that.
  The confirmation dialog still lives in `TerminalModeSidebarHost` so Mod+Shift+W works
  with the sidebar collapsed.
- **Load-bearing and non-obvious:** `Terminal.tsx`'s auto-create effect keys on
  `[workspaceSessionReady, activeWorktreeId]`, not on tab state, so it does not
  re-fire when the last tab closes and cannot race the close path. It is also the
  recovery route when a delete fails: `closeVerticalTab` re-activates the vtab, which
  spawns a terminal rather than leaving it empty and unusable.
- **Known gaps left for later phases:** the host still publishes the hidden group
  through `projectGroup.list` / `folderWorkspace.list`, so a mixed-version or
  mobile client without the client-side filter would render it (Phase 4, when
  remote vtabs make that path real); `worktree-list-review-cache-inputs.ts` and
  `dashboard/useRetainedAgents.ts` still count vtab keys for bookkeeping (no
  user-visible rows, perf only).
- **A vertical tab's `folderPath` widens the authorized filesystem scope, deliberately.**
  `main/ipc/filesystem-auth.ts` authorizes every folder workspace's path, and a Phase 1
  vtab defaults to the user's home directory — so creating one authorizes `$HOME` for
  the app's filesystem IPC/RPC. This is inherent to the product: the spec's explorer
  "roots at the literal pwd, always", so a terminal-first workspace is by definition a
  broad scope. It is recorded here as an explicit decision rather than an accident of a
  default. Phase 2 narrows the *default* (inherit the focused terminal's pwd) but not
  the ceiling. If a narrower boundary is wanted, that is a product decision to take
  before the daily-driver switch, not a Phase 1 implementation detail.
- **The hidden group is identified by name, permanently.** `__terminal-mode__` is the
  marker because it survives persistence and the remote `projectGroup.create` RPC with
  no schema change — an old host would zod-`.strip()` a new field, which is exactly the
  Phase 4 mixed-version case. `Store.createProjectGroup` / `updateProjectGroup` reject
  the name for everyone except the ensure path, so no user, import or migration can
  mint it.
- **Isolation is a choke point, not per-edge filters.** Removing the hidden group
  from `state.projectGroups` at catalog ingress is not possible: a folder
  workspace's execution host is resolved *from its group* in
  `getFolderWorkspaceHostId`, `folder-workspace-connection.ts`,
  `folder-workspace-runtime-owner.ts` and `resolved-worktree-execution-host.ts`, so
  removing it would silently default every vtab to local and break Phase 4's remote
  routing. Instead every classic consumer reads through
  `store/classic-workspace-catalog.ts` (spec §3.3 item 1b), which is one filter
  implementation, cached per source array so identity and cost are unchanged for
  users with no vertical tabs. The residual risk — an upstream merge adding a new
  enumeration — is covered by the two isolation tripwire tests, which assert the
  invariant through the real production functions rather than through the helper.

## Phase 3 implementation notes (recorded 2026-08-13)

- **One store scope, five consumers.** `store/slices/terminal-mode-panels.ts` holds a single
  `terminalModePanelScope` (workspace key, explorer root, workspace root, repo root, addressing
  mode, clamp flag) for the *active* vertical tab, written by
  `vertical-tabs/use-terminal-mode-panel-scope.ts` and read by the File Explorer, Source
  Control, `useGitStatusPolling`, `useEditorExternalWatch` and the remote file client. Deriving
  the root independently in each consumer desynchronizes: the git panel's file-watch filter
  compares against the *repo* root while the explorer's compares against the *pwd*, and a
  consumer computing its own answer half a tick later silently stops matching events. One scope
  also gives main a single directory to authorize.

- **Source Control substitutes the workspace pair, not the path.** `SourceControl.tsx` reads
  `worktreePath` once, but that read is downstream of `activeWorktree`/`activeRepo`, and a
  vertical tab is a folder workspace: `useRepoById` answers `null`, `isFolder` is true, and every
  git surface (the tab itself, the poller, the diff actions) disables itself. Substituting the
  *pair* with one rooted at the pwd's repository — same workspace key, synthetic `kind: 'git'`
  repo — re-enables all of them through code that already exists, at the cost of three edits
  instead of one. Passing a raw path with `activeRepo` still null is worse: ~150 call sites sit
  after an early return that assumes the repo is non-null.

- **The foreign-OSC7 policy is existence, not hostname.** A local shell running `ssh`/`tmux`/
  `docker` reports the *other* machine's pwd. Rather than plumb the OSC 7 hostname discriminator
  onto the fact, the panel root is adopted only after the tab's host confirms the directory
  resolves there — for local tabs that confirmation *is* the `terminalMode:setPathScope` round
  trip (main stats the directory before granting it), so it costs nothing extra. A rejected pwd
  leaves the panels on the last valid root (sticky), the same behavior as the no-OSC7 case. This
  is strictly broader than a hostname check: it also catches a `cd` into a directory deleted
  under the shell, and `docker exec` paths that carry no hostname.

- **The filesystem grant is corroborated by main, not asserted by the renderer.**
  `terminalMode:setPathScope` accepts a directory only when main has itself observed a PTY of
  that vertical tab in it (`recordObservedPtyCwd`, fed by OSC 7 tracking *and* the process-cwd
  read that covers shells with no shell integration), or it is the tab's own start folder, or it
  is the directory already granted (which keeps a foreign pwd sticky). Main then resolves the
  enclosing repository *itself* with `rev-parse --show-toplevel` and grants that too, because the
  git panel is by definition scoped to the whole repository — so no caller can name an ancestor.
  The grant is in-memory, replaced on every `cd`, re-validated on every authorization (flag on +
  workspace still a live vertical tab), revoked on unmount and on the granting `webContents`
  being destroyed or navigating. A monotonic sequence token keeps a slow `stat` from letting an
  older `cd` win.
  An earlier draft accepted any absolute directory the renderer named on the theory that
  `fs:authorizeExternalPath` already allowed that; it does not — that IPC has no preload binding
  and every caller is dialog- or trust-list-gated. Corroboration is what replaced it.

- **The granted repository root is bounded away from `$HOME`.** It is a *containment* root — Source
  Control reads and stages anywhere inside it — so a dotfiles repository at the home directory would
  turn one `cd` into read/write authorization over everything under `$HOME`, plus the `git:*`
  mutation door (including `git:discard`) on it. `boundedRepoRoot` refuses any repository that
  contains the home directory, and the panel shows its quiet empty state there instead. (A vertical
  tab whose *start folder* is `$HOME` still authorizes `$HOME` — that is Phase 1's recorded decision
  and is unchanged here.)

- **Remote vertical tabs clamp to their start folder for the whole of Phase 3.**
  `requiresAbsolutePathScope` returns true for *any* remote pwd other than the workspace root, not
  just one outside it: the explorer's mutation and file-open paths each build their own
  worktree-relative path against the root the explorer is showing, and only the two read sites were
  given the workspace-root base. Clamping is the only answer that cannot address the wrong file.
  Phase 4 threads the workspace root through the remaining call sites and lifts the clamp.

- **`resolveRegisteredWorktreePath` had to move too.** Every `git:*` IPC handler uses the strict
  door (exact `git worktree list` registration), not containment — so a repository discovered by
  `cd` fails it even though its own pwd is authorized. It now also accepts the terminal-mode repo
  root. That root is one main resolved itself from a corroborated directory, so the door still
  never trusts a caller-supplied repository path. Note this deliberately opens the *whole* `git:*`
  surface for that one repository, including `git:commit`, `git:discard` and `git:push` — which is
  the point: the panel is a working Source Control view, not a read-only one.

- **Reused `IGitProvider.isGitRepoAsync` instead of adding a contract method.** The design called
  for a new `repoRootForPath` on the provider contract and a new relay method.
  `isGitRepoAsync(dirPath) -> { isRepo, rootPath }` already exists on the contract, is already
  implemented by `SshGitProvider`, and the relay already answers `git.isGitRepo` with
  `rev-parse --show-toplevel`. Reusing it makes SSH work against *existing* relay builds; adding a
  method would have made it fail until the host was rebuilt, for no behavioral gain.

- **`git.status` did not get the absolute-path param.** It was implemented and then removed: the
  rest of the git RPC surface (diff, stage, commit, branch compare) still addresses a worktree
  *selector*, so status for `/repo` with a diff action resolving under `/repo/sub` would be a
  correctness bug, and no client could safely send it. `resolveTerminalModeGitRoot` therefore
  shows a remote tab's git panel only when the pwd's repository *is* the workspace root; local and
  SSH take an absolute worktree path throughout and follow the pwd's repository freely. Phase 4
  owns making the remaining git RPCs path-addressed.

- **The capability token exists and gates, but is deliberately not advertised yet.**
  `ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY` is defined, checked before every send, and honored
  host-side — but it is *not* in `RUNTIME_CAPABILITIES`. A capability is a permanent promise about
  behavior, and a host that accepts `absolutePath` today still denies any path outside its own
  allow-list, because the terminal-mode grant is declared by a renderer and an `orca serve` host
  has none. Advertising it would promise a clamp-free experience the host cannot deliver, with no
  way to retract short of a `v2`. Until Phase 4 gives the host its own scope source, every remote
  vertical tab clamps to its start folder and shows the hint — which is the honest answer and the
  path this phase can actually test.

- **The absolute-path scope is refused for anyone but a desktop terminal-mode tab.**
  `files.readDir`/`files.stat` accept `absolutePath` only from a non-mobile client, only for a
  workspace the host itself recognizes as a terminal-mode vertical tab, never for an SSH-backed
  workspace (whose file reads bypass `resolveAuthorizedPath` entirely), and always through
  `resolveAuthorizedPath`. Without those checks the param would have widened every RPC client's
  reach from "inside the selected worktree" to "anywhere in the host's allow-list".

- **Addressing is a stored decision, not a re-derived negation.** `scope.addressing` is written
  once by the scope hook and read by `runtime/terminal-mode-file-scope.ts`. Re-deriving it from
  `!clamped` at the call site made a pwd *inside* the start folder on an old host send the gated
  param and hard-error, instead of using the relative contract that works there. The same module
  also overrides the remote relative *base* to the workspace root: the explorer's own root is the
  pwd, and computing a relative path against that would resolve the wrong directory host-side.

- **`relativePath` still rides along with `absolutePath`.** The `files.readDir` / `files.stat`
  schema requires `relativePath`, so the absolute branch sends `''`. Making it optional would
  change a shape older clients rely on for no gain — the host ignores it when `absolutePath` is
  present, and an old host that strips `absolutePath` answers for the workspace root, which is
  exactly what the hard capability assert in `getRemoteAbsoluteScopeArgs` exists to prevent.

- **Auto-title is display-side with a 10 s persistence debounce keyed on the pending writes.**
  Keying the debounce on `cwdByPtyId` was wrong: that map gets a new identity on every OSC 7 emit
  in every terminal, so an active user reset the timer forever and it never fired. The timer is
  now keyed on the serialized `{id, name}[]` that would actually be written.

- **The sticky-pwd rule needed the tab fallback that Phase 2 assumed it already had.**
  `activeTabIdByWorktree` does *not* keep pointing at the last terminal tab: opening a diff from
  Source Control makes the diff tab active, it owns no PTY, and the panels snapped back to the
  start directory — reproduced in app QA. The cwd slice now records
  `lastTerminalTabIdByWorkspace` (written only by terminal mode's tracking hook, on the active tab
  while it owns a PTY), and `resolveWorkspaceTerminalPtyId` prefers it, falling back to the last
  tab in strip order that still has one for a session restored with no focus history.

- **`SourceControl`'s per-worktree prune had to learn about vertical tabs.** It drops state for any
  key missing from the classic worktree map, which never contains `folder:` keys — harmless while
  a folder workspace could not reach the git surfaces, and a commit-draft eraser the moment it
  can. The predicate now retains the active terminal-mode workspace. It is the clearest example of
  the cost of the workspace-pair substitution: the pair covers `activeWorktree`/`activeRepo`, not
  every downstream read that assumes the key is in the classic catalog.

- **Expanded directories are collapsed on re-root, keyed by workspace.** `expandedDirs` is keyed
  by workspace, and a vertical tab keeps its key across `cd`, so the previous root's expansions
  would be re-read as children of the new root. The guard has to remember *which* tab it committed
  a root for, or every tab switch collapses the tab being switched to.

- **The git panel needed its own watch arm.** `getEditorExternalWatchTargets` gates the sidebar
  watch on `sourceControlCanConsumeWatch`, which resolves a classic repo — always `undefined` for a
  folder workspace. Left alone, a vertical tab with Source Control as its only open surface would
  install no filesystem watcher at all, and the pwd-derived watch roots would be unreachable in the
  one panel whose filter uses the repo root.

- **The git tabs stay visible for a vertical tab whether or not the pwd is in a repository.**
  `getVisibleRightSidebarActivityItems` hides `gitOnly` items for folder workspaces, which hid the
  panel that is supposed to render the "cd into a repo" affordance, and made the activity bar
  flicker on every `cd` between repos.

### Known gaps carried to Phase 4

- **Remote vertical tabs are not reachable yet** (Phase 1 pins vtab creation to local), so the
  remote half of this phase — the capability token, the clamp, the absolute-path reads — is
  implemented and unit-tested but not exercised end to end. Phase 4 advertises the token once the
  host can serve it, which is also what turns the absolute-path branch on.
- **The host's own allow-list still bounds a remote tab's reach.** `files.readDir` with
  `absolutePath` runs through `resolveAuthorizedPath` on the host, so a remote pwd outside every
  registered root would be denied rather than followed. The fix is a host-side terminal-mode scope
  (the same corroborated grant, declared over RPC) once remote vertical tabs exist — and it is why
  the token is not advertised yet.
- **`files.watch` is still selector-addressed**, and only two of the explorer's ~10 remote call
  sites were given the workspace-root base — which is why remote tabs clamp for now. Phase 4 must
  thread the workspace root (or absolute addressing) through the mutation, file-open and watch
  paths before lifting the clamp.
- **An editor tab whose file leaves the grant stops reloading.** Open a file, `cd` elsewhere, and
  its reload/`pathExists` probes log access-denied until the tab is closed or the shell returns.
  Phase 4 should either pin open editor tabs' directories into the grant or stop the retry.
- **Git-status decorations in the explorer are relative to the repo root** while explorer rows are
  relative to the pwd, so with the pwd in a subdirectory the per-file badges do not line up. The
  Source Control list itself is correct.
- **Diff-tab identity does not include the root.** `buildDiffEditorFileId` keys on workspace +
  relative path, so `cd`ing between two repositories inside one vertical tab can alias two diffs
  of the same relative path.
- **The synthetic worktree carries no branch identity** (`branch`/`head`/`pushTarget` are empty),
  so Source Control surfaces keyed on the branch — PR generation records, hosted-review cache
  keys, upstream compare — are degraded for a vertical tab even though status, staging, commit and
  diff work.
- **Two overlapping local watchers** are installed when the pwd is a subdirectory of the repo root
  (one per panel filter). Events under the pwd are delivered twice; the shared batching absorbs
  most of the cost.

## Phase 4 implementation notes (recorded 2026-08-13)

- **The hidden group is ensured through a purpose-built RPC, not `projectGroup.create`.**
  Resolved question 2 called for the existing method, and it was written before Phase 1 put
  `assertProjectGroupNameNotReserved` in `OrcaRuntimeService.createProjectGroup`. Reaching the
  reserved name through it now needs an `allowReservedName`-shaped parameter — a general
  bypass for *any* reserved name on the general group RPC. `terminalMode.ensureContext` narrows
  that to one shape: the only group it can mint is the terminal-mode sentinel. To be precise
  about what it does *not* do: every non-mobile RPC client — the CLI included — can still call
  it, so the bypass is limited by shape, not by caller. It also carries the host's home
  directory, which is the *other* thing a remote vertical tab needs at creation and which no
  existing RPC exposes. Ordering is unchanged and still load-bearing: the
  group is ensured before `folderWorkspace.create`, which hard-fails on a group it does not have.

- **Two capabilities, in opposite directions.** `terminal-mode.vertical-tabs.v1` is a HOST token
  ("I answer `terminalMode.*`"); `terminal-mode.catalog.v1` is a CLIENT token ("I filter vertical
  tabs out of every classic surface, so send them"). Conflating them was tempting — one string,
  read by whoever asks — but the host's catalog decision has to be about the *client's* code, and
  a host advertising the catalog token would be claiming it hides its own tabs, which is the
  opposite of what it does. `terminal-mode.absolute-path-scope.v1` is now advertised too, because
  the host finally has a scope source of its own (below). A test pins that the client token never
  appears in `RUNTIME_CAPABILITIES`.

- **The host's grant is keyed by vertical tab, not by client session.** The obvious shape is a
  per-connection registry reaped on socket close. It is wrong here: a runtime client's connection
  identity is not stable across the reconnects this whole phase exists to survive (shared-control
  multiplexing, per-request sockets, relay hops), so reaping on close revokes the grant exactly
  when the client comes back and the first `files.readDir` after a reattach would be denied until
  the user pressed Enter. The grant is therefore scoped to the tab: re-validated on every read
  (the workspace must still be a live terminal-mode vertical tab), replaced on every `cd`, dropped
  on `deleteFolderWorkspace` and on an explicit `root: null`, and bounded to 32 tabs. The reach it
  adds is one corroborated directory per tab, readable only through the absolute-path branch of
  `files.readDir`/`files.stat`/`files.watch` — which is already refused for mobile clients, for
  SSH-backed workspaces and for any workspace that is not a vertical tab.

- **The grant is read-only, deliberately.** It is *not* joined into `getAllowedRoots`. Every
  mutating file RPC still addresses a worktree selector plus a contained relative path, so a
  granted directory can never authorize a write, and the blast radius of a bad corroboration is
  "the client can read a directory its own shell is sitting in". The cost is the honest gap
  below: a mutation on a pwd outside the workspace root fails loudly instead of working.

- **Threading the workspace root is what actually lifted the clamp, not the capability.**
  `requiresAbsolutePathScope` now returns true only for a pwd *outside* the workspace root,
  because every explorer call site was given `terminalModeFileScopeArgs` — which pins the
  relative base to the workspace root while the panels show the pwd. That covers the common
  case (`cd` into a subdirectory of the tab's start folder) on **every** host, including ones
  with no terminal-mode capability at all. The capability only buys the escape from the root.

- **`git.status` is still selector-addressed, so a remote tab's git panel still clamps.**
  `resolveTerminalModeGitRoot` continues to show the panel only when the pwd's repository *is*
  the workspace root. Making the whole git RPC surface path-addressed (diff, stage, commit,
  branch compare) is a larger change than this phase should carry, and a half-converted surface
  would resolve status for one repository and a diff action for another. Carried forward.

- **Cwd on reattach comes from a field the host has always sent.** `SnapshotStart` carries
  `cwd`; `decodeSnapshotInfo` simply never read it. Reading it is a Rule-1 change with no wire
  motion at all, and it is what makes a restored remote pane's panels re-seed before the shell
  prints another prompt. The `Metadata` frame remains the live-`cd` path.

- **The client token is declared by the desktop window, not by the shared transport.**
  `shared/remote-runtime-*.ts` is the client transport for the desktop app, the CLI *and*
  headless `orca serve`; hard-coding `terminal-mode.catalog.v1` there made the CLI promise a
  filter it does not have. `shared/remote-runtime-client-capabilities.ts` holds the
  unconditional base set and one `declare…` call from `attach-main-window-services.ts` — the
  process that owns `store/classic-workspace-catalog.ts`, i.e. the only one that can keep the
  promise. The paired **web** client is deliberately left un-advertised: it runs the same
  renderer and could honestly claim it, but terminal mode is desktop-only, so withholding is
  the fail-safe direction and costs it nothing.

- **`terminalMode.ensureContext` lets a paired runtime client mint the hidden group on the
  host**, which makes `isRemoteOnlyFolderScope` treat that tab's start folder as a local root
  (`filesystem-auth.ts`). Recorded rather than gated: the same folder scope is reachable today
  through an ordinary `folderWorkspace.create`, and a paired runtime client can already start
  terminals on the host — arbitrary execution strictly dominates a read scope.

- **The cross-version harness gained a `cwd-metadata` step**, and it caught something: the extra
  output crosses the transport's credit threshold, so a `C>H Ack` now appears in the journey's
  frame sequence for every pairing. That is real protocol behavior and is pinned. `Metadata`
  itself is filtered out of the strict positional sequence and given a counted oracle instead —
  whether a build sends it is a per-build property that predates the harness, so a positional
  assertion would fail a pairing for an optional frame. Verified locally against `v1.4.180`
  (`ORCA_CROSS_VERSION_BASELINE_REF=c610e175a`): all three pairings green, the old host does
  emit `Metadata`, and the old client drops it silently.

- **`files.watch` had to skip the ordinary authorization for a granted path.** The watch
  resolves its directory through the host grant and then re-authorized it with
  `resolveAuthorizedPath`, whose allow-list on an `orca serve` host never contains a
  terminal-mode grant — so the watch failed for exactly the outside-the-root case the
  parameter exists for. The scoped path is now used directly; it was already canonicalized
  and contained by `resolveTerminalModeHostScopedPath`.

- **The host grant's declaration token is per tab.** A single module-level counter (which is
  correct for the local module, because it holds exactly one scope) made any activity on tab
  B cancel an in-flight declaration for tab A — while still leaving A's grant written, so the
  host held a directory A's client had been told was refused. The counter is now keyed by
  workspace, and a losing declaration withdraws its own entry (identified by its sequence, so
  it never removes a newer one).

- **Phase-3 gaps that Phase 4 closed:** the two read sites' workspace-root base now reaches
  every explorer call site; `files.watch` follows the pwd; the host has a scope source, so
  the absolute-path token is advertised and remote tabs no longer clamp inside their root.
  Still open from Phase 3 and carried forward: git-status decorations in the explorer are
  relative to the repo root while rows are relative to the pwd; `buildDiffEditorFileId` does
  not include the root, so two repositories in one tab can alias a diff; the synthetic
  worktree carries no branch identity; two overlapping local watchers are installed when the
  pwd is a subdirectory of the repo root; an editor tab whose file leaves the grant keeps
  retrying its reload probes.

### What the MUST is proven by

The design called for a cua-driver script as "the regression test for the MUST requirement".
What exists is the same journey driven over CDP from
`scratchpad/p4-01-setup.mjs` … `p4-09-final.mjs` (the Phase-3 precedent: the scripts live with
the QA run, not in the tree — nothing in CI can start a second `orca serve` and SIGKILL a
desktop client). Evidence captured on Linux/Xvfb against a second `orca serve` built from this
branch, in its own profile and on its own port: four remote vertical tabs plus one local tab,
a `nohup` loop started in a remote tab, `SIGKILL` of the client, relaunch, and then — same
shell PID, `jobs` still reporting the loop `Running`, scrollback intact through the
pre-kill marker, and every tab's panels re-rooted at its own pwd (screenshots
`p4-shots/15-before-kill.png` → `19-all-tabs-reattached.png`). The pieces additionally have
unit oracles (host partitioning, hydration keys, `SnapshotStart.cwd` decode, capability
gating). What is *not* covered by an automated regression test is the assembled journey; that
remains a manual run per phase.

### Known gaps carried to Phase 5

- **A mutation on a remote pwd outside the workspace root fails loudly.** Create/rename/delete/
  duplicate/import compute a worktree-relative path against the workspace root; outside it there
  is no such path, so `getRemoteFileArgs` returns null and the local-filesystem fallback refuses.
  Reads, watches and the tree are unaffected. Fixing it means an `absolutePath` param on the
  whole `files.*` mutation surface — and a decision to make the host grant writable, which this
  phase deliberately did not take.
- **Git-ignored decorations still use the explorer root as their base** (`use-file-explorer-ignored-paths.ts`
  was left alone): its context type is the git one, which is still selector-addressed. Same class
  as the Phase-3 git-status decoration gap.
- **A stale grant survives a tab switch.** Switching between two remote vertical tabs leaves the
  previous tab's grant on the host until that tab is closed. It is re-validated on every read and
  bounded, so this is bookkeeping, not reach.
- **`workspace-session.ts buildTerminalSessionData` never writes `remoteSessionIdsByTabId` for a
  folder workspace**, so an SSH-backed vertical tab's relay PTYs cannot reattach after a restart
  (its layout still restores; the shells respawn). Runtime (`orca serve`) tabs are unaffected —
  they reattach through `terminal.resolvePane`, not the relay session ledger.
- **A host restart leaves the pane dead until the tab is closed** — pre-existing, shared with
  classic remote worktrees, and reproduced in Phase 4 app QA. `remote-runtime-pty-transport.ts`
  `attach` runs its work in a fire-and-forget IIFE, and the "persisted pane is gone" branch
  `return`s rather than throwing, so the recovery in `pty-connection.ts` (`clearTabPtyId` +
  `startFreshSpawn`, whose own comment says it exists for exactly this) is unreachable and the
  stale `tab.ptyId` is never pruned — it reproduces on every later launch. **Now Phase 5 task
  0**, because the only clean signal (`onPtyExit`) closes the tab when it is the pane's only
  one — which is the close semantics Phase 5 rewrites, so fixing it earlier means doing that
  work twice. It does not affect this phase's MUST: a *client* kill/relaunch reattaches through
  `terminal.resolvePane`, which was verified end to end. **If remote terminal mode is
  daily-driven before Phase 5 lands, this has to be pulled forward** — every `orca serve`
  update strands the user's tabs.
- **SSH vertical tabs were built but never exercised.** The per-target hidden group, the
  remote-home resolution through `session.resolveHome`, and the connection-id routing all
  shipped this phase with unit coverage only; no SSH host was driven end to end. Phase 5's
  verification folds an SSH vtab into the agent run.
- **Nothing prunes `remoteSessionIdsByTabId` or a vertical tab's session rows**, and folder keys
  are self-validating at hydration (`collectFolderWorkspaceKeysFromSession` derives the valid
  set from the very session being validated, where a worktree key must exist in
  `worktreesByRepo`). A vertical tab whose host is gone therefore re-hydrates as valid forever.
- **Two more `worktree:`-shaped assumptions on the reattach path**, both harmless for
  `runtime:` tabs and wrong for SSH-backed ones: `terminals.ts` deferred-SSH resolution derives
  a repo id from the workspace key, so an SSH vertical tab never enters
  `deferredSshSessionIdsByTabId`; and `workspace-session-host-persistence.ts`
  `listKnownRuntimeHostIds` is repo-derived, so a runtime host that owns *only* vertical tabs
  contributes no host id and startup recovery leans entirely on the restored-owner map.
- **`buildRuntimeSessionPlaceholders` skips `folder:` keys.** Harmless today because
  `collectFolderWorkspaceKeysFromSession` already marks them valid for hydration, but it means a
  remote vertical tab has no placeholder `Repo`/`Worktree` during the window before its catalog
  loads — anything that starts reading those for vertical tabs must revisit it.
