# Fork changes vs upstream

What this branch (`feat/reuse-checkout-workspace`) carries on top of upstream
[`stablyai/orca`](https://github.com/stablyai/orca), and what to watch upstream so each change can be
dropped once it is no longer needed.

- **Upstream base merged:** `v1.4.163`
- **Latest upstream tag seen:** `v1.4.164-rc.0`
- **Last audited:** 2026-08-01

Regenerate the raw delta with:

```bash
git fetch upstream --tags --prune
git diff --stat v1.4.163..HEAD -- src/            # fork's own source delta
git log --no-merges --cherry-pick --right-only --format='%h %an %s' upstream/main...HEAD
```

Status legend: **Carry** = still needed · **Drop next merge** = upstream has it, remove on the next
update · **Watch** = no upstream fix yet, re-check each merge.

---

## 1. Remote tab order, title, and agent status — **Watch**

| | |
|---|---|
| Commits | `d7dcc539f1`, `17979b5094`, `ba4e83323b`, `1054560674`, `dd171ffc66`, `72dd050a64`, `HEAD` |
| Upstream issue | none filed |
| Upstream PR | none |
| Upstream status | **not fixed** — `upstream/main` still derives `tabOrder` from the tabs-array order |

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
branch attributed the worktree as `pty?.worktreeId ? … : {}`. No live PTY means no PTY record, so the
published status carried **no `worktreeId` at all**, and the client skips a mirrored status it cannot
attribute. The `done` arrived on time and updated the spinner, then was dropped before it could
notify; switching back materialized the pane, a PTY appeared, and the notification fired tens of
seconds late. Fixed with a `pty?.worktreeId ?? hookRow.worktreeId` fallback, mirroring what the
`retained` branch directly above it already did.

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

---

## 3. Completion notifications for remote sessions — **Watch**

| | |
|---|---|
| Commits | `HEAD` |
| Upstream issue | none filed |
| Upstream PR | none |
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
appeared not to work, and it presented as "only non-worktree workspaces fail". That correlation was
real but incidental: those were simply the workspaces sitting unstreamed. Measured on one run, a
worktree pane notified in **30 ms** while unstreamed panes took 21 s, 35 s, and 602 s — each landing
exactly when the workspace was reopened.

**Fix order matters.** Both parts depend on §1c/§1c′. Wiring notifications while the host still
reported `done` for unfocused panes would fire a false "task complete" on every tab switch.

`remote-server-parity.test.ts` covers tab ordering and focus parity but has no notification
coverage — which is why this went unnoticed.

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
5. Update the base tag and audit date at the top of this file.
