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
| Commits | `d7dcc539f1`, `17979b5094`, `ba4e83323b`, `1054560674`, `dd171ffc66`, `72dd050a64` |
| Upstream issue | none filed |
| Upstream PR | none |
| Upstream status | **not fixed** — `upstream/main` still derives `tabOrder` from the tabs-array order |

Three symptoms on a remote (`orca serve`) host, one theme: the host publishes degraded state for
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

**Regression tests:** `src/main/runtime/headless-tab-order-stability.test.ts` (4 tests, pins both
order builders) and 3 tests in `web-session-tabs-sync.test.ts` (title placeholder, status retention,
stuck-spinner guard). All fail if their fix is reverted.

**Action:** worth upstreaming — upstream still has these and no issue tracks them. Re-check
`collectHeadlessTopLevelTabOrder(tabs)` at each merge.

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

## Known open — not yet fixed

**No completion notifications for remote sessions.** Agents running on a remote `orca serve` host
never produce a desktop notification; local sessions work. This is missing wiring, not a regression:

- The only entry point is `observeAgentHookCompletionForNotification`, called from exactly one place
  — `useIpcEvents.ts:3270`, the *local* main-process hook IPC path.
- Remote agent status arrives by a different route entirely, the snapshot mirror
  (`buildMirroredAgentStatusPatch` in `web-session-tabs-sync.ts`). It updates
  `agentStatusByPaneKey` — which is why spinners and badges do work remotely — but never dispatches
  a notification.
- A headless host emits no agent notification of its own either: its notification type union
  includes `agent-task-complete` (`orca-runtime.ts:2542`) but the only dispatch sites are `plugin`
  and `dismiss`. So there is nothing to subscribe to, and no duplicate risk in adding an emitter.

**Fix order matters.** This must be built on top of §1c. Wiring notifications while the host still
reports `done` for unfocused panes would fire a false "task complete" on every tab switch.

`remote-server-parity.test.ts` covers tab ordering and focus parity between local and remote but has
no notification coverage — which is why this went unnoticed.

---

## Review checklist for the next upstream merge

1. `git fetch upstream --tags --prune`, then check the merge base — upstream stable tags are release
   branches cut off main, so consecutive tags are **not** ancestors of each other.
2. Re-check whether upstream retains tab order in `buildHeadlessMobileSessionTabGroups` (§1).
3. Run `src/main/runtime/headless-tab-order-stability.test.ts` after the merge — it is the tripwire
   for an upstream change that reintroduces array-derived ordering.
4. Update the base tag and audit date at the top of this file.
