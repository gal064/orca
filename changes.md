# Fork changes vs upstream

What this branch (`feat/reuse-checkout-workspace`) carries on top of upstream
[`stablyai/orca`](https://github.com/stablyai/orca), and what to watch upstream so each change can be
dropped once it is no longer needed.

- **Upstream base merged:** `v1.4.176`
- **Latest upstream tag seen:** `v1.4.176`
- **Last audited:** 2026-08-07

**`v1.4.176` audit result: nothing landed upstream — no fork code dropped.** Basis: all 56 non-merge
commit subjects in `v1.4.175..v1.4.176` read, and a per-symbol line count over the range for 20
fork-critical symbols. Every one is **0 changed lines** except
`observeAgentHookCompletionForNotification` (7), all of which are new *test* lines plus one unrelated
`sessionBoundary` field passthrough in `useIpcEvents.ts` — the non-test call-site count is unchanged
at one. Three upstream changes are adjacent to carried sections but fix different failure modes; see
§1, §3, and the notes below.

Regenerate the raw delta with:

```bash
git fetch upstream --tags --prune
git diff --stat v1.4.176..HEAD -- src/            # fork's own source delta
git log --no-merges --cherry-pick --right-only --format='%h %an %s' upstream/main...HEAD
```

Status legend: **Carry** = still needed · **Drop next merge** = upstream has it, remove on the next
update · **Watch** = no upstream fix yet, re-check each merge.

**Open upstream PRs** (check these first at each merge — a merged one means the local change can be
dropped): [#12042](https://github.com/stablyai/orca/pull/12042) tab order + titles — **OPEN** ·
[#12045](https://github.com/stablyai/orca/pull/12045) completion notifications — **OPEN**.
[#12044](https://github.com/stablyai/orca/pull/12044) agent status was **closed unmerged**
2026-08-04 (`mergedAt=null`), superseded by upstream's own `hookRow.live` fix that landed at
`v1.4.175` — see §1. Its remaining uncovered part is §1c, which is still carried.
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
| Upstream PR | [#12042](https://github.com/stablyai/orca/pull/12042) — order + titles (§1a/§1b), opened 2026-08-01, still **OPEN** at `v1.4.176` · [#12044](https://github.com/stablyai/orca/pull/12044) — agent status (§1c/§1c′), **closed unmerged** 2026-08-04 after upstream shipped its own §1c′/§1d fix |
| Upstream status | **unchanged at `v1.4.176`** — no movement since the `v1.4.175` partial fix. §1c′/§1d remain upstream's (fork code stays removed). Still absent: `collectHeadlessTopLevelTabOrder` rebuilds `tabOrder` from the tabs-array order (§1a); no placeholder-title guard in `buildMirroredTerminalTabs` (§1b); no `pending-handle` status-retention guard (§1c — the string `pending-handle` does not appear in upstream's `web-session-tabs-sync.ts` at all); live-PTY-title precedence in `worktree.ps` untouched (§1e). Range evidence over `v1.4.175..v1.4.176`: `collectHeadlessTopLevelTabOrder`, `buildHeadlessMobileSessionTabGroups`, `mergeMobileSessionTabGroups`, `buildMirroredTerminalTabs`, `buildMirroredAgentStatusPatch`, `isClientAuthoritativeAgentStatusPane`, `buildPtyMobileAgentStatus`, `resolveHookLiveAgentRow`, `getHookAgentRowForPane`, `lastOscTitleEpochMs`, `findPtyForMobileTerminalTab`, `mobileTerminalTabMatchesPty`, `allowWorktreeOnlyMatch` — **all 0 changed lines**. Both suites remain absent upstream. |

**Landed upstream at `v1.4.175` (fork code dropped).** Upstream reworked `getHookAgentRowForPane`
to return a `live: HookLiveAgentRow | null` — the newest fresh, non-`providerSessionOnly`,
non-`restoredUnconfirmed` hook row, carrying `payload`/`updatedAt`/`stateStartedAt`/`worktreeId`.
`buildPtyMobileAgentStatus` now prefers `retained ?? resolveHookLiveAgentRow(hookRow.live, …)` and
attributes it with `pty?.worktreeId ?? liveRow.worktreeId`. That is §1c′ (hook state beating a
title-derived `done`) and §1d (worktree attribution surviving a missing PTY) in one mechanism, with
a stricter freshness gate than the fork's — it dates the fallback by `lastOscTitleEpochMs` instead
of the byte stream, so a paired client's live status can outrank it. Both functions are now
byte-identical to `v1.4.175`, and all 12 tests in `headless-agent-status-from-hooks.test.ts`,
`headless-tab-order-stability.test.ts`, and `headless-agent-unread.test.ts` pass against it.

**Not subsumed: §1c.** Upstream #12641/#12664 added a delete-loop guard to
`buildMirroredAgentStatusPatch`, but it gates on `isClientAuthoritativeAgentStatusPane` — a pane
*this renderer* claimed at transport creation and writes byte-derived status for. The fork's guard
gates on the *host surface* reporting `pending-handle` with no status, which is precisely a pane
this renderer is **not** streaming and therefore never claimed. Verified empirically: with the fork
guard removed and upstream's in place, `keeps a running agent status when the host republishes the
pane without one` fails (`expected undefined to be 'working'`). Both guards now sit in the same loop
and all 82 tests across `web-session-tabs-sync.test.ts`, `mirrored-attention-staleness.test.ts`, and
upstream's new `web-session-tabs-sync-remote-status-title-flap.test.ts` pass together.

**Adjacent at `v1.4.176`, not a duplicate.** Two upstream changes land near this section without
covering it:

- **#12778 (AI Vault tab names)** edits `buildMirroredTerminalTabs` itself — the §1b function — but
  only adds an `aiVaultTitle` passthrough alongside the existing `generatedTitle` one. It carries a
  title field across a snapshot rebuild; it does not judge whether an incoming title is a
  placeholder, which is the whole of §1b. The two changes now sit in the same object literal.
- **#12859 (`sessionBoundary`)** adds `projectSessionTabAgentStatus`, which **strips `agentStatus`
  outright** for runtime clients lacking `AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY`. That is a new
  way for a host to publish a pane with no status — which makes §1c's retention guard *more* load-
  bearing, not redundant. Do not read this commit as covering §1c.

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
~~Retaining the client's status (c) was necessary but not sufficient: `buildPtyMobileAgentStatus` read
*identity* from the agent hook but *state* from the PTY title — and an unstreamed pane's title is the
`Terminal` placeholder.~~ **Landed upstream at `v1.4.175`; fork implementation removed.** Upstream's
`hookRow.live` row plus `resolveHookLiveAgentRow` supplies the same hook-state precedence. Kept here
only to explain why (c) alone is insufficient — that reasoning still holds.

**d. Completions on an unfocused remote pane never notified** (see also §3). The same hook-only
branch attributed the worktree as `pty?.worktreeId ? … : {}`, so whenever the host resolved no PTY
record for the pane the published status carried **no `worktreeId` at all** — and the client skips a
mirrored status it cannot attribute. The `done` arrived on time and updated the spinner, then was
dropped before it could notify; switching back materialized the pane, a PTY appeared, and the
notification fired tens of seconds late. **Landed upstream at `v1.4.175`; fork implementation
removed** — upstream's live-row branch attributes with `pty?.worktreeId ?? liveRow.worktreeId`. Its
*last-resort* branch still uses `pty?.worktreeId` alone, which is acceptable: that branch only fires
on identity-only hook evidence and publishes a title-derived `done` that should not notify.

**e. A running agent intermittently showed no spinner in mobile's workspace list.** The terminal
snapshot used its live PTY title and correctly reported `working`, but `worktree.ps` preferred the
older persisted tab title and reported only `active`. Fixed by using the live PTY title for status
when available, with the persisted title retained only as a fallback. This is host-side; shipped
mobile clients already render and poll the corrected status.

Note the PTY record is resolved by an **exact** worktree-id match that instance workspaces
(`::workspace:<uuid>`) can fail where plain worktrees cannot — see §3b. The fix deliberately does not
depend on that lookup succeeding.

**Regression tests:** `src/main/runtime/headless-tab-order-stability.test.ts` (4 tests, pins both
order builders), `src/main/runtime/headless-agent-status-from-hooks.test.ts` (4 tests: hook state
beats a title-derived `done`, and worktree attribution survives a missing PTY — these now pass
against *upstream's* implementation and are retained as tripwires), and 3 tests in
`web-session-tabs-sync.test.ts` (title placeholder, status retention, stuck-spinner guard).
`orca-runtime.test.ts` also pins live PTY title precedence, the saved-title fallback, and stale-row
removal in `worktree.ps`.

**Action:** §1a, §1b, §1c, §1e remain worth upstreaming — upstream still has them and no issue
tracks them. §1c′/§1d are done. Re-check `collectHeadlessTopLevelTabOrder(tabs)` and live-title
precedence in `worktree.ps` at each merge.

---

## 2. reuse-checkout workspaces — **Carry** (fork feature)

| | |
|---|---|
| Commits | `0e6a3daff6`, `8c611ebec5`, `9b6a10d073`, `53787632fa`, `14be9b2a60` (2026-07-13 → 07-28) |
| Upstream issue | none |
| Upstream PR | none |
| Upstream status | **absent** at `v1.4.176` — `git grep -c reuseCheckout v1.4.176 -- src` returns nothing, and `src/main/ipc/reuse-checkout-workspace.ts` does not exist upstream |

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
| Upstream PR | [#12045](https://github.com/stablyai/orca/pull/12045) — opened 2026-08-01, was stacked on the now-closed [#12044](https://github.com/stablyai/orca/pull/12044), still **OPEN** at `v1.4.176` |
| Upstream status | **not fixed** at `v1.4.176` — `observeAgentHookCompletionForNotification` still has exactly one non-test call site, `useIpcEvents.ts` (local IPC); the 7 changed lines carrying that symbol across `v1.4.175..v1.4.176` are all in `useIpcEvents.test.ts` and `agent-hook-completion-notifications.test.ts`. The snapshot mirror still never dispatches a notification; `ingestRemote` has 0 changed lines and still only SSH and WSL callers, no serve-host path. §3c and §3d untouched (`headless-agent-unread.test.ts` and `mirrored-attention-staleness.test.ts` absent upstream). §3b's dependency remains upstream-owned since `v1.4.175` — see §1. |

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

**c. Headless completions did not mark mobile workspaces unread.** `worktree.ps` carried the agent's
`done` row, but its `unread` field came only from workspace metadata. With no renderer attached,
nothing converted the completion into that metadata update, so shipped mobile clients hid the bell.
The runtime now marks new `done`/`waiting`/`blocked` turns unread when no authoritative renderer is
available, deduplicated by pane and state-start time. Hook-cache replay is ignored, acknowledgement
does not resurrect the same turn, and renderer-attached hosts retain their visibility-aware behavior.
This is host-side; no mobile rebuild is required for the workspace bell.

**Regression test:** `src/main/runtime/headless-agent-unread.test.ts` pins regular and folder
workspaces, acknowledgement deduplication, replay suppression, and the renderer-attached guard.

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

**d. Dismissed bells came back minutes later on remote workspaces.** A remote host's hooks reach the
renderer only through the session mirror, which republishes each pane's last status on reconnect and
carries no replay marker. `agentStatusEntryEqual` treats a missing previous entry as changed, so
those old `done` rows re-entered `observeAgentHookCompletionForNotification` as fresh completions.
The only guard was the coordinator's in-memory `lastCompletionIdentity`, which
`pruneClosedPaneCoordinators` discards during the very rehydrate that triggers the replay. Mirrored
`done`/`waiting`/`blocked` rows whose turn started over a minute ago are now dropped before the
notification observer; the store patch has already applied, so pane visuals are unaffected.

Confirmed from desktop traces: 39 stale republished completions, 8 of which re-marked a workspace
unread. One reconnect at 2026-08-02T02:15:33 re-raised five workspaces within 17 ms for turns that
had ended 8.9–33 minutes earlier. Median mirror lag is −17 ms and p95 is 3.7 s, while every false
mark had a lag of at least 477 s.

**Regression test:** `src/renderer/src/runtime/mirrored-attention-staleness.test.ts` pins fresh
completions through, stale `done`/`waiting`/`blocked` dropped, long-running `working` retained for
turn sequencing, and the unchanged-row skip.

**Adjacent at `v1.4.176`, not a duplicate.** #12859 taught `resolveAttention` in
`smart-attention.ts` to skip a `sessionBoundary` entry unless it displaced a real completion —
suppressing spurious attention from a *resumed session's* `SessionStart` row. That is a different
input (a genuinely new boundary row) at a different layer (attention classification, after the store
patch) from §3d's input (a **replayed old** `done` on mirror reconnect) at its layer (the
notification observer feed). Neither guard sees the other's case; both are needed.

---

## 4. Shift-click workspace pinning — **Carry** (fork feature)

| | |
|---|---|
| Commits | `67048d7c06` (2026-08-02) |
| Upstream issue | none |
| Upstream PR | none |
| Upstream status | **absent** at `v1.4.176` — `WorktreeCard.tsx` still has no `shiftKey` handling (0 occurrences, 0 changed lines in range) |

Shift-clicking a workspace card toggles its pinned state without activating the workspace or
changing the multi-selection. The shortcut uses the same pin/reveal mutation as the context menu,
so it works for local, SSH, remote-server, and folder workspaces.

Main files: `src/renderer/src/components/sidebar/WorktreeCard.tsx` and
`src/renderer/src/components/sidebar/WorktreeCard.interactions.test.tsx`.

---

## 5. Download remote files from editor tabs — **Carry** (fork feature)

| | |
|---|---|
| Commits | `06569213d9` (2026-08-02) |
| Upstream issue | none |
| Upstream PR | none |
| Upstream status | **absent** at `v1.4.176` — no `remote-file-download.ts`, and `EditorFileTabContextMenu.tsx` has 0 occurrences of `download` |

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

## 6. Packaged daemon-entry boot budget — **Carry** (fork build tooling)

| | |
|---|---|
| Commits | this commit (2026-08-03) |
| Upstream issue | none filed |
| Upstream PR | none |
| Upstream status | **10 s** at `v1.4.176` — `verifyPackagedDaemonEntryBoots` still spawns with `timeout: 10_000` |

`afterPack`'s `verify-packaged-daemon-entry` gate boots the freshly packaged `daemon-entry.js` under
a spawn timeout. On a cold pack this Mac takes ~13 s to load the just-written native modules (~0.5 s
once warm), so the upstream 10 s budget fails a perfectly good bundle — and because the gate throws
inside `afterPack`, everything after it (runtime pruning, `chmodUnixCliLaunchers`) is skipped and the
bundle is unusable. Raised to **60 s**.

This only widens the budget; it does not weaken the check. A `MODULE_NOT_FOUND` or missing-usage
failure still fails the build, which is what the gate is actually for. Drop this if upstream raises
the budget or warms the modules before spawning.

Main file: `config/scripts/verify-packaged-daemon-entry.cjs`.

---

## 7. Automatically send completed dictation — **Carry** (fork feature)

| | |
|---|---|
| Commits | this commit (2026-08-07) |
| Upstream issue | none filed |
| Upstream PR | none |
| Upstream status | **absent** at `v1.4.176` — voice settings have no `autoSubmit` field |

Voice settings now include an opt-in **Send Automatically** toggle. When enabled, dictation waits
for the active speech session to finish, inserts the complete final transcript, then submits it in
terminal panes and the native chat composer. The terminal path preserves the submission flag across
the global dictation event and sends Enter only after the paste succeeds. Other text fields still
receive dictated text without being submitted.

This is a desktop-client change only. Local and cloud transcription can both take time, but no
speech RPC or remote-wire change is required; submission happens after the existing per-session
stopped event reaches the renderer.

Main files: `src/renderer/src/components/dictation/DictationController.tsx`,
`src/renderer/src/components/dictation/dictation-auto-submit.ts`,
`src/renderer/src/components/dictation/dictation-insertion-target.ts`,
`src/renderer/src/components/terminal-pane/terminal-programmatic-text-paste.ts`, and
`src/renderer/src/components/native-chat/use-native-chat-composer-keydown.ts`.

**Regression tests:** `DictationController.auto-submit.test.tsx` pins completion ordering;
`dictation-insertion-target.test.ts`, `terminal-dictation-paste-detail.test.ts`, and
`terminal-programmatic-text-paste.test.ts` pin insert-then-submit delivery; native-chat tests pin
the marked Enter path.

---

## Review checklist for the next upstream merge

1. `git fetch upstream --tags --prune`, then check the merge base — upstream stable tags are release
   branches cut off main, so consecutive tags are **not** ancestors of each other.
0. Sweep the **whole** `<last-merged-tag>..<tag>` commit range, not just the PRs listed above: read
   every commit subject and count changed lines per fork-critical symbol. Another author's PR can
   fix the same symptom under an unrelated title — the `gh --author gal064` query only proves our
   own PRs did not land.
2. Re-check whether upstream retains tab order in `buildHeadlessMobileSessionTabGroups` (§1).
3. Run `src/main/runtime/headless-tab-order-stability.test.ts` and
   `headless-agent-status-from-hooks.test.ts` after the merge — they are the tripwires for an
   upstream change that reintroduces array-derived ordering or title-derived agent state.
   `headless-agent-status-from-hooks.test.ts` now guards *upstream's* `hookRow.live` mechanism; if it
   starts failing, upstream regressed §1c′/§1d and the fork code may need reinstating from
   `git show <pre-v1.4.175-merge>:src/main/runtime/orca-runtime.ts`.
3b. Re-check §1c specifically: upstream's `isClientAuthoritativeAgentStatusPane` delete-loop guard
   and the fork's `unreportedPaneKeys` guard now sit side by side in
   `buildMirroredAgentStatusPatch`. They cover different panes (claimed-by-this-renderer vs
   host-has-no-handle) — do not collapse them without deleting the fork guard and confirming
   `keeps a running agent status when the host republishes the pane without one` still passes.
4. Check whether upstream has given serve hosts an `ingestRemote` path or its own notification
   emitter (§3a) — either would make the mirror wiring droppable. Cheapest probe:
   `git grep -c observeAgentHookCompletionForNotification <tag> -- src | grep -v test` must stay at
   the single `useIpcEvents.ts` call site.
5. Run the reuse-checkout mobile refresh and stale-agent projection regressions in
   `orca-runtime.test.ts` (§2).
6. Check whether upstream has added editor-tab downloads for remote files (§5); if so, drop the
   shared client-side wiring.
7. Check whether the merge reset `verify-packaged-daemon-entry.cjs` back to `timeout: 10_000` (§6) —
   a cold pack fails at that budget on this Mac.
7b. Check whether upstream added a voice `autoSubmit` setting or equivalent completion-triggered
   terminal/native-chat submission (§7). If so, compare final-transcript ordering and remove the
   fork path only when upstream waits for the matching session's stopped event.
8. New at `v1.4.176` — watch `projectSessionTabAgentStatus`
   (`src/main/runtime/rpc/methods/session-tab-agent-status-projection.ts`). It strips `agentStatus`
   for runtime clients without `AGENT_SESSION_BOUNDARY_RUNTIME_CAPABILITY`, i.e. a *new* source of
   status-less panes. If upstream widens that stripping, re-run the §1c retention test
   (`keeps a running agent status when the host republishes the pane without one`) before touching
   the fork guard.
9. Update the base tag and audit date at the top of this file.
