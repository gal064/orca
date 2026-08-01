# Fork changes vs upstream

What this branch (`feat/reuse-checkout-workspace`) carries on top of upstream
[`stablyai/orca`](https://github.com/stablyai/orca), and what to watch upstream so each change can be
dropped once it is no longer needed.

- **Upstream base merged:** `v1.4.163-rc.3`
- **Latest upstream tag seen:** `v1.4.164-rc.0`
- **Last audited:** 2026-08-01

Regenerate the raw delta with:

```bash
git fetch upstream --tags --prune
git diff --stat v1.4.163-rc.3..HEAD -- src/            # fork's own source delta
git log --no-merges --cherry-pick --right-only --format='%h %an %s' upstream/main...HEAD
```

Status legend: **Carry** = still needed · **Drop next merge** = upstream has it, remove on the next
update · **Watch** = no upstream fix yet, re-check each merge.

---

## 1. Cherry-pick of upstream #11448 — **Drop next merge**

| | |
|---|---|
| Commit | `4b7550e21b` (2026-07-30, authored by Brennan Benson) |
| Upstream PR | [#11448](https://github.com/stablyai/orca/pull/11448) — **merged** |
| Upstream SHA | `0281496c6f` on `main`, shipped in `v1.4.164-rc.0` |
| Files | `orca-runtime.ts`, `web-session-tabs-sync.ts` (+ tests) |

Cherry-picked while chasing the remote tab flicker. **It did not fix that bug.** It is now on upstream
`main`, so merging `v1.4.164` or later brings it in under a different SHA.

**Action:** drop this commit at the next upstream merge. Keeping it means git reconciles two
independently-authored copies of the same patch — the exact conflict pattern that made the
`v1.4.163-rc.3` merge cost 36 conflicted files.

---

## 2. Remote tab order rotation + placeholder title — **Watch**

| | |
|---|---|
| Commits | `d7dcc539f1`, `17979b5094`, `ba4e83323b`, `1054560674`, `dd171ffc66` (2026-07-31 → 08-01) |
| Upstream issue | none filed |
| Upstream PR | none |
| Upstream status | **not fixed** — `upstream/main:src/main/runtime/orca-runtime.ts:6858` still derives `tabOrder` from the tabs-array order |

**Symptom.** On a remote (`orca serve`) host the tab bar reordered itself: whichever tab you clicked
jumped to the rightmost slot, and unfocused tabs displayed the literal placeholder `Terminal` instead
of their real process name.

**Cause.** Two defects compose. Every publish path re-materializes a terminal surface by removing it
from the tabs array and pushing it back on the end, so clicking an idle tab moves it last. The order
builders then rebuilt the group's `tabOrder` straight from that array, keeping only the existing
group's *id* and discarding its stored order.

**Fix.** Retain the stored per-group order for still-live tabs and append only genuinely-new ones, at
both order builders:

- `buildHeadlessMobileSessionTabGroups` — the activation path (`activateHeadlessMobileSessionTerminalTab`)
- `mergeMobileSessionTabGroups` — the PTY-backed publish path

Plus a client-side guard so a `pending-handle` surface's placeholder title never overwrites the real
title the client already holds (`web-session-tabs-sync.ts`).

**Regression tests:** `src/main/runtime/headless-tab-order-stability.test.ts` (4 tests, pins both
order builders) and 2 tests in `web-session-tabs-sync.test.ts`. All fail if the fix is reverted.

**Action:** worth upstreaming — upstream still has the bug and no issue tracks it. Until then, re-check
`collectHeadlessTopLevelTabOrder(tabs)` at each merge; if upstream starts retaining order there, this
becomes a drop candidate.

**Known still-open, same root:** an unfocused Claude tab shows an idle checkmark instead of the
spinner while the agent is running. Host publishes placeholder *status* for panes it is not streaming,
same as it did for the title. Not yet fixed.

---

## 3. reuse-checkout workspaces — **Carry** (fork feature)

| | |
|---|---|
| Commits | `0e6a3daff6`, `8c611ebec5`, `9b6a10d073`, `53787632fa`, `14be9b2a60` (2026-07-13 → 07-28) |
| Upstream issue | none |
| Upstream PR | none |

Adds workspaces that reuse an existing checkout instead of creating a new git worktree, including SSH
repos and remote servers, the quick composer (defaulted on), detected-scan synthesis so a restart
purge cannot drop them, and `reuseCheckout` forwarding through the web `worktree.create` call.

Main files: `src/main/ipc/reuse-checkout-workspace.ts`, `src/main/ipc/worktrees.ts`,
`src/main/ipc/worktree-remote.ts`, `src/main/runtime/rpc/methods/worktree-schemas.ts`,
`src/renderer/src/components/NewWorkspaceComposerCard.tsx`,
`src/renderer/src/hooks/useComposerState.ts`, `src/shared/types.ts`, i18n locales.

This is a **feature**, not a bug workaround — it is why the branch exists. It only goes away if
upstream ships an equivalent. Nothing suggests that is in progress.

---

## 4. `update-from-upstream` skill — **Carry** (local tooling)

| | |
|---|---|
| Commits | `784368ece8`, `b347041fe3`, `e063bf92fe`, `380d58524c`, `512cc729e2` |
| File | `.claude/skills/update-from-upstream/SKILL.md` |

Local workflow doc: merge procedure for upstream's divergent release lines, macOS code-signature
repair after install, remote `orca serve` install onto `omarchy`, the Arch glibc-floor bypass, and the
stale-daemon kill (a daemon reattaches to its socket and keeps executing a replaced inode, so a
restart alone can serve days-old code).

Never upstreamed, never reverted. Not application code.

---

## Review checklist for the next upstream merge

1. `git fetch upstream --tags --prune`, then check the merge base — upstream stable tags are release
   branches cut off main, so consecutive tags are **not** ancestors of each other.
2. Drop the #11448 cherry-pick (§1) before merging.
3. Re-check whether upstream retains tab order in `buildHeadlessMobileSessionTabGroups` (§2).
4. Run `src/main/runtime/headless-tab-order-stability.test.ts` after the merge — it is the tripwire
   for an upstream change that reintroduces array-derived ordering.
5. Update the base tag and audit date at the top of this file.
