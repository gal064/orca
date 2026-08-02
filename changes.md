# Fork changes vs upstream

What this branch (`feat/reuse-checkout-workspace`) carries on top of upstream
[`stablyai/orca`](https://github.com/stablyai/orca), and what to watch upstream so each change can be
dropped once it is no longer needed.

- **Upstream base merged:** `v1.4.163`
- **Latest upstream tag seen:** `v1.4.164-rc.0`
- **Last audited:** 2026-08-02

Regenerate the raw delta with:

```bash
git fetch upstream --tags --prune
git diff --stat v1.4.163..HEAD -- src/            # fork's own source delta
git log --no-merges --cherry-pick --right-only --format='%h %an %s' upstream/main...HEAD
```

Status legend: **Carry** = still needed · **Drop next merge** = upstream has it, remove on the next
update · **Watch** = no upstream fix yet, re-check each merge.

**Open upstream PRs** (check these first at each merge — a merged one means the local change can be
dropped): [#12042](https://github.com/stablyai/orca/pull/12042) tab order + titles ·
[#12044](https://github.com/stablyai/orca/pull/12044) agent status ·
[#12045](https://github.com/stablyai/orca/pull/12045) completion notifications, stacked on #12044.
Each was rebuilt from scratch on `upstream/main`, so the upstream diffs are smaller than the fork's
history and do not carry the reuse-checkout feature.

```bash
gh pr list --repo stablyai/orca --author gal064 --state all \
  --json number,title,state,mergedAt --jq '.[] | "\(.state)\t#\(.number)\t\(.title)"'
```

---

## 1. Remote tab order, title, and agent status — **Watch**

| | |
|---|---|
| Commits | `d7dcc539f1`, `17979b5094`, `ba4e83323b`, `1054560674`, `dd171ffc66`, `72dd050a64`, `cc91750548` |
| Upstream issue | none filed |
| Upstream PR | [#12042](https://github.com/stablyai/orca/pull/12042) — order + titles (§1a/§1b) · [#12044](https://github.com/stablyai/orca/pull/12044) — agent status (§1c/§1c′) · opened 2026-08-01 |
| Upstream status | **not fixed** — `upstream/main` still derives `tabOrder` from the tabs-array order |

The §1d worktree-attribution fix went up with the notifications work instead — see §3.

Four symptoms on a remote (`orca serve`) host, one theme: the host publishes degraded state for
panes it is not actively streaming, and the client reads that as fact.

**a. Tab order rotated.** Whichever tab you clicked jumped to the rightmost slot. Every publish path
re-materializes a surface by dropping it from the tabs array and pushing it back on the end; the
order builders then rebuilt `tabOrder` from that array, keeping only the existing group's *id* and
discarding its stored order. Fixed by retaining the stored per-group order for still-live tabs and
appending only new ones, at both `buildHeadlessMobileSessionTabGroups` (activation path) and
`mergeMobileSessionTabGroups` (PTY-publish path).

**b. Unfocused tabs showed the literal `Terminal`.** The host has no live PTY for a pane it is not
streaming, so it publishes a placeholder title. The client adopted it over the real title it already
held. Fixed by treating the placeholder on a `pending-handle` surface as unknown.

**c. A running agent showed idle (checkmark) once its tab lost focus.** Same shape: the host
publishes no `agentStatus` for a pane it has no handle for, and the client *deleted* the status it
held. Fixed by retaining status when a `pending-handle` surface reports none — deliberately **not**
for `ready` surfaces, where absence genuinely means no agent and must still prune, or stuck spinners
return (#1437).

**c′. The status the host published was title-derived, so it said `done` over a running agent.**
Retaining the client's status (c) was necessary but not sufficient: `buildPtyMobileAgentStatus` read
*identity* from the agent hook but *state* from the PTY title — and an unstreamed pane's title is the
`Terminal` placeholder. Fixed by returning the hook row's `state`/`prompt`/`stateStartedAt` from
`getHookAgentRowForPane` and preferring them over the title-derived fallback.

**d. Completions on an unfocused remote pane never notified** (see also §3). The same hook-only
branch attributed the worktree as `pty?.worktreeId ? … : {}`, so whenever the host resolved no PTY
record for the pane the published status carried **no `worktreeId` at all** — and the client skips a
mirrored status it cannot attribute. The `done` arrived on time and updated the spinner, then was
dropped before it could notify; switching back materialized the pane, a PTY appeared, and the
notification fired tens of seconds late. Fixed with a `pty?.worktreeId ?? hookRow.worktreeId`
fallback, mirroring what the `retained` branch directly above it already did.

Note the PTY record is resolved by an **exact** worktree-id match that instance workspaces
(`::workspace:<uuid>`) can fail where plain worktrees cannot — see §3b. The fix deliberately does not
depend on that lookup succeeding.

**Regression tests:** `src/main/runtime/headless-tab-order-stability.test.ts` (4 tests, pins both
order builders), `src/main/runtime/headless-agent-status-from-hooks.test.ts` (4 tests: hook state
beats a title-derived `done`, and worktree attribution survives a missing PTY), and 3 tests in
`web-session-tabs-sync.test.ts` (title placeholder, status retention, stuck-spinner guard). All fail
if their fix is reverted.

**Action:** worth upstreaming — upstream still has these and no issue tracks them. Re-check
`collectHeadlessTopLevelTabOrder(tabs)` and the `worktreeId` attribution in
`buildPtyMobileAgentStatus` at each merge.

---

## 2. reuse-checkout workspaces — **Carry** (fork feature)

| | |
|---|---|
| Commits | `0e6a3daff6`, `8c611ebec5`, `9b6a10d073`, `53787632fa`, `14be9b2a60` (2026-07-13 → 07-28) |
| Upstream issue | none |
| Upstream PR | none |

Workspaces that reuse an existing checkout instead of creating a new git worktree, including SSH
repos and remote servers, the quick composer (defaulted on), detected-scan synthesis so a restart
purge cannot drop them, and `reuseCheckout` forwarding through the web `worktree.create` call.

Main files: `src/main/ipc/reuse-checkout-workspace.ts`, `src/main/ipc/worktrees.ts`,
`src/main/ipc/worktree-remote.ts`, `src/main/runtime/rpc/methods/worktree-schemas.ts`,
`src/renderer/src/components/NewWorkspaceComposerCard.tsx`,
`src/renderer/src/hooks/useComposerState.ts`, `src/shared/types.ts`, i18n locales.

A **feature**, not a bug workaround — it is why the branch exists. Only goes away if upstream ships
an equivalent. Nothing suggests that is in progress.

**Runtime identity follow-up (2026-08-02).** Controller inventory refresh selected the first
filesystem-equivalent workspace, so a PTY owned by `::workspace:<uuid>` could be rewritten to a
same-path sibling. Exact mobile matching then returned `pending-handle`, causing terminal reloads;
the macOS remote mirror could also treat the missing PTY as a wake failure and spawn a duplicate
terminal. Fixed by preferring the exact runtime ID and using path-equivalent fallback only when one
candidate exists, preserving SSH/path-normalization recovery without guessing between instances.

`worktree.ps` also returned retained hook rows beyond the existing 30-minute freshness window,
accumulating old agents in mobile's workspace overview. It now excludes expired rows.

**Regression tests:** `orca-runtime.test.ts` pins exact reuse-checkout PTY ownership across repeated
session-tab refreshes and excludes stale hook rows from workspace summaries.

---

## 3. Completion notifications for remote sessions — **Watch**

| | |
|---|---|
| Commits | `cc91750548` (shared with §1c′/§1d — one commit fixed both) |
| Upstream issue | none filed |
| Upstream PR | [#12045](https://github.com/stablyai/orca/pull/12045) — opened 2026-08-01, stacked on [#12044](https://github.com/stablyai/orca/pull/12044) |
| Upstream status | **not fixed** — the mirror still never dispatches a notification |

Agents on a remote `orca serve` host produced no desktop notification; local sessions always worked.
Two independent causes, both needed:

**a. Missing wiring.** `observeAgentHookCompletionForNotification` was called from exactly one place
— `useIpcEvents.ts`, the *local* main-process hook IPC path. `ingestRemote` covers SSH and WSL but
not serve, so a serve host's hooks never reach local IPC. Remote status arrives only via the
snapshot mirror (`buildMirroredAgentStatusPatch`), which updated `agentStatusByPaneKey` — why
spinners work remotely — but never notified. Fixed by feeding the mirror's changed statuses to the
same observer, in `applyWebSessionTabsStorePatch` via `collectChangedMirroredAgentStatuses`.

Two constraints worth preserving: the observer is fed **every** changed status, not just `done`, so
the coordinator sees the `working`→`done` sequence it needs rather than a bare terminal `done`; and
the import is **lazy**, because a static one pulls the terminal-pane/store graph in ahead of this
module and leaves `useAppStore.getState` undefined at module scope.

**b. Unattributable statuses were silently dropped** — see §1d. This was the reason the wiring alone
appeared not to work. It presented as "only non-worktree workspaces fail", consistently and over many
sessions. Measured on one run, a worktree pane notified in **30 ms** while instance-workspace panes
took 21 s, 35 s, and 602 s — each landing exactly when the workspace was reopened.

**Why the worktree correlation is probably causal.** For an *unstreamed* pane the host still tries to
resolve a PTY record, via `findPtyForMobileTerminalTab` → `mobileTerminalTabMatchesPty`, which gates
on an exact string match: `pty.worktreeId === worktreeId`. Worktree workspaces use `repoId::path`;
reuse-checkout and folder workspaces use `repoId::path::workspace:<uuid>`. A PTY recorded under one
form while the snapshot publishes the other fails that match, leaving no PTY and (pre-fix) no
`worktreeId`. The looser fallback immediately below is **disabled on serve hosts**
(`allowWorktreeOnlyMatch: !snapshot.publicationEpoch.startsWith('headless')`), so on a headless host
exact match is the only path. That predicts the observed split exactly.

The instance-workspace failure was confirmed on 2026-08-02 with a regression that starts with two
workspace IDs for the same checkout. Controller inventory reported the exact second instance, but
the refresh rewrote it to the first filesystem-equivalent workspace; the mobile snapshot then
returned `pending-handle`. The §2 exact-first, ambiguity-safe lookup fixes that ownership loss.
`mobileTerminalTabMatchesPty` remains exact by design and now receives the preserved instance ID.

**Fix order matters.** Both parts depend on §1c/§1c′. Wiring notifications while the host still
reported `done` for unfocused panes would fire a false "task complete" on every tab switch.

`remote-server-parity.test.ts` covers tab ordering and focus parity but has no notification
coverage — which is why this went unnoticed.

---

## 4. Shift-click workspace pinning — **Carry** (fork feature)

| | |
|---|---|
| Commits | `67048d7c06` (2026-08-02) |
| Upstream issue | none |
| Upstream PR | none |

Shift-clicking a workspace card toggles its pinned state without activating the workspace or
changing the multi-selection. The shortcut uses the same pin/reveal mutation as the context menu,
so it works for local, SSH, remote-server, and folder workspaces.

Main files: `src/renderer/src/components/sidebar/WorktreeCard.tsx` and
`src/renderer/src/components/sidebar/WorktreeCard.interactions.test.tsx`.

---

## 5. Download remote files from editor tabs — **Carry** (fork feature)

| | |
|---|---|
| Commits | this commit |
| Upstream issue | none |
| Upstream PR | none |

The editor tab context menu now shows **Download** beside the path-copy actions for concrete files
opened from a remote server or SSH workspace, including Markdown preview tabs. It reuses the file
explorer's existing runtime/SSH download path, native save dialog, and completion/error handling.
Virtual diff, conflict-review, and check-detail tabs remain excluded because they do not represent a
single downloadable file.

This is a desktop-client change only. The Mac app must be updated to expose the action; the remote
server requires no update because the existing download protocol and compatibility fallback are
unchanged.

Main files: `src/renderer/src/components/tab-bar/EditorFileTabContextMenu.tsx` and
`src/renderer/src/lib/remote-file-download.ts`.

**Regression tests:** `EditorFileTabContextMenu.test.tsx` verifies runtime-owner routing and hides
the action for local and virtual-file tabs; `FileExplorer.test.tsx` continues to cover shared
runtime/SSH download behavior.

---

## Review checklist for the next upstream merge

1. `git fetch upstream --tags --prune`, then check the merge base — upstream stable tags are release
   branches cut off main, so consecutive tags are **not** ancestors of each other.
2. Re-check whether upstream retains tab order in `buildHeadlessMobileSessionTabGroups` (§1).
3. Run `src/main/runtime/headless-tab-order-stability.test.ts` and
   `headless-agent-status-from-hooks.test.ts` after the merge — they are the tripwires for an
   upstream change that reintroduces array-derived ordering or title-derived agent state.
4. Check whether upstream has given serve hosts an `ingestRemote` path or its own notification
   emitter (§3a) — either would make the mirror wiring droppable.
5. Run the reuse-checkout mobile refresh and stale-agent projection regressions in
   `orca-runtime.test.ts` (§2).
6. Check whether upstream has added editor-tab downloads for remote files (§5); if so, drop the
   shared client-side wiring.
7. Update the base tag and audit date at the top of this file.
