---
name: update-from-upstream
description: Pull the latest stable release tag from the upstream Orca repo (stablyai/orca), merge it into the current local branch, then build and install the app onto this machine and, when asked, onto a remote `orca serve` host. Use when the user asks to "update from upstream", "pull latest stable", "merge the latest release", "rebuild and install Orca", or to update a remote Orca server.
---

# Update from upstream stable release

Merge the newest **stable** upstream release into the current branch, then build and install it locally — and, when the user wants it, onto a remote `orca serve` host too (step 8).

Stable = tag matching `^v[0-9]+\.[0-9]+\.[0-9]+$`. Anything with a suffix (`-rc.0`, `.issue7936`, `.ghes`) is **not** stable and must be skipped.

Do not open a PR and do not back up the currently installed app. Stay on the branch the user is already on. Push the merge to `origin` (the fork) only after the build succeeds — never push a merge that does not build.

## 1. Preflight

```bash
git status --porcelain
git branch --show-current
git remote -v
```

- Working tree must be clean. If not, stop and ask whether to stash or commit — never discard the user's changes.
- `upstream` must point at `https://github.com/stablyai/orca`. If it is missing, add it:
  `git remote add upstream https://github.com/stablyai/orca`

On macOS, require a stable code-signing identity before starting the merge:

```bash
security find-identity -v -p codesigning
```

At least one valid Apple Development, Developer ID Application, or Apple Distribution identity
must be present. If the command reports `0 valid identities found`, stop and ask the user to create
a free Apple Development certificate in Xcode → Settings → Accounts → Manage Certificates. Do not
continue to a local macOS build or install with ad-hoc signing: Accessibility and Screen Recording
grants for the nested Computer Use helper would be tied to a changing CDHash and break after a
helper rebuild. The identity must exist before step 5 so electron-builder signs both the outer app
and the nested helper during packaging.

**The remote host is always `omarchy`.** Never ask which host — that is settled. Ask only *whether* the remote should be updated this run, and ask it before starting the merge, since the answer changes the ordering (the remote clones from `origin`, so the push in step 7 must happen before step 8). If the user already said yes or no, skip the question entirely. Everywhere below, `<host>` means `omarchy`.

## 2. Find the latest stable tag

```bash
git fetch upstream --tags --prune
git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
```

Check whether it is already merged:

```bash
git merge-base --is-ancestor <tag> HEAD && echo "already merged"
```

If already merged, report that and skip to step 4 only if the user asked for a rebuild anyway; otherwise stop.

**Upstream tags are not linear — always check the merge base before merging anything.**

```bash
git merge-base --is-ancestor <older-tag> <newer-tag> && echo linear || echo DIVERGED
git merge-base --is-ancestor <tag> upstream/main && echo "on main" || echo "release branch"
```

Stable `vX.Y.Z` tags are cut as **release branches off main** with fixes cherry-picked onto them;
`vX.Y.Z-rc.N` tags sit **on main**. So consecutive stable tags are not ancestors of each other, and
the same PR exists on both lines under different SHAs. Merging across lines makes git reconcile two
independently-authored copies of every shared fix: expect conflicts in dozens of files the branch
never touched (one real run produced 36 conflicted files, ~90 hunks, 28 of them untouched by the
branch). That is survivable but it is a deliberate decision, not a routine update — surface the
conflict scale to the user before starting.

When it is right to proceed, split the conflicts by ownership and say so in the report:

```bash
git diff --name-only <last-merged-tag>...HEAD > /tmp/branch-files   # what the branch actually owns
git diff --name-only --diff-filter=U > /tmp/conflicts
grep -xFf /tmp/branch-files /tmp/conflicts        # A: resolve by hand
grep -vxFf /tmp/branch-files /tmp/conflicts       # B: duplicate upstream fixes
```

Class B may be taken wholesale from the incoming side (`git checkout --theirs`) **only after**
verifying no fix is lost — every PR number reachable from the currently-merged tag must also appear
in the incoming tag. Never `--theirs` a class-A file: it discards the branch's clean, non-conflicted
changes elsewhere in that same file.

## 3. Merge the tag

```bash
git merge <tag>
```

A clean merge self-commits as `Merge tag 'vX.Y.Z' into <branch>`, matching this repo's history. Keep the default message.

On conflicts: do **not** `--abort` unilaterally. List the conflicted files, resolve the ones that are mechanical (lockfile, generated catalogs, version bumps), and surface anything touching the branch's own feature code to the user. Leave the merge **in progress** — resolve the working tree but do not commit yet, so the build in step 5 validates the resolution before it becomes a commit. Regenerate rather than hand-merge generated files:

- `pnpm-lock.yaml` → take upstream's, then re-run `pnpm install`
- localization catalogs → `pnpm run sync:localization-catalog`
- bundled skill guides / manifest → `pnpm run generate:bundled-skill-guides` and `pnpm run generate:skill-bundle-manifest`

## 4. Install dependencies

```bash
pnpm install
```

`postinstall` rebuilds the native deps (node-pty et al.) against Electron — do not skip it. Node 24 and the pinned pnpm from `packageManager` are required; use `corepack` if pnpm is the wrong version.

## 5. Build for this machine

Build only the host architecture and only the unpacked app — the dmg/zip targets are for releases and roughly double the build time.

**macOS** (`dist/mac-arm64/Orca.app` on Apple Silicon, `dist/mac/Orca.app` on Intel):

```bash
pnpm run build:mac --arm64 --dir     # use --x64 on Intel; check with `uname -m`
```

Verify the packaged app before replacing the installed copy:

```bash
ORCA_BUILD_APP=dist/mac-arm64/Orca.app # use dist/mac/Orca.app on Intel
ORCA_BUILD_HELPER="$ORCA_BUILD_APP/Contents/Resources/Orca Computer Use.app"
codesign --verify --deep --strict "$ORCA_BUILD_APP"
codesign -dvvv "$ORCA_BUILD_APP" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Signature)='
codesign -dvvv "$ORCA_BUILD_HELPER" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Signature)='
```

Both descriptions must show a real `Authority` and a non-empty `TeamIdentifier`; neither may show
`Signature=adhoc`. The outer identifier must be `com.stablyai.orca`, and the helper identifier must
be `com.stablyai.orca.computer-use`. If any check fails, stop and fix the signing identity or build
configuration before installing. Never repair this by ad-hoc signing the packaged app.

**Linux** (`dist/linux-unpacked/`):

```bash
pnpm run build:linux --dir
```

**Windows** (`dist/win-unpacked/`):

```bash
pnpm run build:win --dir
```

If the build fails on typecheck, that is a real merge regression — report it with the failing files instead of working around it with `--skip`-style flags.

## 6. Install onto the machine

Quit the running app first (a running Electron app holds open file handles).

**Never keep a backup of the install.** No `Orca.app.old`, no `.bak`, no dated copy — not even a
temporary one you intend to delete later. The bundle is ~800M on a volume that is routinely near
full, and the revert path is a rebuild from a known tag, not a stale copy in `/Applications`. If a
staging copy is unavoidable (see the in-place case below), delete it in the same command that
swaps it in — never leave the decision to a later step.

**macOS** — replace `/Applications/Orca.app` outright:

```bash
osascript -e 'quit app "Orca"' 2>/dev/null || true
rm -rf /Applications/Orca.app
cp -R dist/mac-arm64/Orca.app /Applications/Orca.app
```

**When the Claude Code session is hosted by Orca itself** (`TERM_PROGRAM=Orca`), quitting the app
kills the session mid-install. Ask the user how to proceed rather than assuming; if they choose to
install in place without quitting, stage and swap so the bundle is never missing, and drop the
displaced copy immediately:

```bash
ditto dist/mac-arm64/Orca.app /Applications/Orca.app.new   # ditto, not cp -R: preserves the signature
rm -rf /Applications/Orca.app && mv /Applications/Orca.app.new /Applications/Orca.app
```

The running process keeps its own open inodes alive, so it survives until the user relaunches.
Anything it loads lazily afterwards comes from the new bundle, so tell the user to relaunch
promptly rather than leaving a half-old process running for hours.

Verify the installed copy without re-signing it:

```bash
codesign --verify --deep --strict /Applications/Orca.app   # must exit 0 and print nothing
codesign -dvvv /Applications/Orca.app 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Signature)='
codesign -dvvv '/Applications/Orca.app/Contents/Resources/Orca Computer Use.app' 2>&1 \
  | grep -E '^(Identifier|Authority|TeamIdentifier|Signature)='
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Orca.app
```

Never run `codesign --force --deep --sign - /Applications/Orca.app` after packaging. `--deep`
recursively replaces the nested helper's stable signature with an ad-hoc identity, which makes its
TCC grants rebuild-sensitive again. If the installed verification differs from the packaged
verification in step 5, stop and report the copy or signing failure instead of repairing it in
place.

When migrating from an older ad-hoc install to the first stable-signed build, the old TCC rows are
stale. Ask the user immediately before resetting them, then run this once and reopen Computer Use
permission setup:

```bash
tccutil reset Accessibility com.stablyai.orca.computer-use
tccutil reset ScreenCapture com.stablyai.orca.computer-use
orca computer permissions --json
```

Tell the user to grant Accessibility and Screen Recording to Orca Computer Use. Do not reset TCC on
later updates when the helper keeps the same TeamIdentifier and bundle identifier; preserving that
identity is what keeps the grants durable. Notification permission may prompt once during the
ad-hoc-to-stable migration, but it should also persist on later builds.

**Linux** — build the installable artifact and install it:

```bash
pnpm run build:linux
sudo dpkg -i dist/orca-ide_*_amd64.deb   # or run the AppImage from dist/
```

**Windows** — run the generated installer:

```bash
pnpm run build:win
# then execute dist/orca-windows-setup.exe
```

The `orca` CLI is relinked by `build:cli` during the desktop build, so no separate CLI install step is needed.

## 7. Commit and push

Only after the app is built **and** installed — a merge that does not build or run must never reach `origin`.

```bash
git status --porcelain          # confirm what is outstanding
git add -A                      # conflict resolutions + regenerated files
git commit --no-edit            # finalizes an in-progress merge, keeping the default merge message
git push origin HEAD
```

If the merge was clean, `git merge` already made the commit — then only fold in regenerated files (if any) and push. If there is genuinely nothing to commit, skip straight to the push.

**The pre-commit hook can invalidate the build you just installed.** lint-staged runs `oxfmt --write`
over every staged file, so committing a large merge can rewrite hundreds of production sources
*after* packaging (one run reformatted 708). The install then no longer corresponds to `HEAD`. Check
and rebuild if needed — formatting is semantically neutral, but the installed artifact should be
traceable to the commit, and the version string embeds the SHA:

```bash
find src \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' \
  -newermt "@$(stat -f %m dist/mac-arm64/Orca.app)" | wc -l   # non-zero → rebuild and reinstall
```

Two other hook failures are routine on a big merge, and neither may be worked around with a
`max-lines` disable or a per-file bump (see AGENTS.md) — split the file at a `describe` seam instead:
a test file that each side grew past the 800-line limit, and unused imports left behind by the split.

Push to `origin` (the fork) on the current branch only. Never push to `upstream`, never force-push, and do not open a PR.

## 8. Install onto the remote `orca serve` host, `omarchy` (only when asked)

Skip this whole step unless the user asked for it in step 1. The remote clones the branch from `origin`, so **step 7 must already be pushed**.

The host is `omarchy` — an Arch box reached over the `omarchy` entry in `~/.ssh/config`. Being Arch, it trips the glibc floor gate in 8d every time; expect that rather than treating it as a new failure.

Build **on the remote host**, never cross-built from the Mac: native modules link against the host's glibc, and a darwin→linux native compile is not viable without Docker.

### 8a. Preflight the remote

```bash
ssh omarchy 'uname -m; nproc; df -h /home | tail -1; sudo -n true && echo "passwordless sudo" || echo "sudo needs password"'
ssh omarchy 'command -v git gcc make python3; node -v; ls ~/.nvm >/dev/null && echo "nvm present"'
```

- If `sudo` needs a password, install everything under `$HOME`. **Never** touch `/opt` or the distro package (`pacman`/`apt`) — leave a `stably-orca-bin`-style package installed and simply stop pointing the service at it.
- Node 24 and the pinned pnpm are required, same as locally. `nvm` is usually already there: `. ~/.nvm/nvm.sh && nvm use 24`, then `corepack pnpm` (no global install, no sudo).
- Budget ~4 GB for the clone plus build output.

### 8b. Find how the server is actually started — do not invent a service

```bash
ssh omarchy 'systemctl --user list-units --type=service --all --no-legend | grep -i orca'
ssh omarchy 'systemctl --user cat orca-server.service'
```

The unit typically calls a **one-line shim** rather than a binary directly, e.g.
`~/.config/orca/linux-orca-cli-shim/orca` → `exec '/opt/<pkg>/resources/bin/orca-ide' "$@"`.

When a shim exists, repointing it **is** the whole install. Leave the unit file, `--port`, and `--pairing-address` exactly as they are — matching the existing values is what keeps already-paired clients working. Ask the user before changing a port or run mode; "it's already running" means match it, not replace it.

### 8c. Build on the remote

```bash
ssh omarchy 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh; nvm use 24
  git clone --depth 1 --branch <branch> --single-branch https://github.com/<fork>/orca ~/orca-src
  cd ~/orca-src && corepack pnpm install && corepack pnpm run build:desktop
  corepack pnpm run ensure:electron-runtime
  npx electron-builder --config config/electron-builder.config.cjs --linux dir'
```

Use `electron-builder --linux dir` directly — `pnpm run build:linux` hardcodes the `AppImage deb` targets and appending `--dir` does not override them.

### 8d. The glibc floor gate will fail on a modern distro

On anything newer than the Ubuntu 20.04 floor (Arch, Fedora), `afterPack` aborts packaging because node-pty just compiled against the host's glibc:

```
⨯ [verify-linux-glibc-floor] ... node-pty.node needs GLIBC_2.42 (from libc.so.6)
```

There is no supported opt-out, and the half-written `dist/linux-unpacked` is **not** usable — everything after the gate (`prunePackagedRuntimeNodeModules`, the daemon-entry boot check, `chmodUnixCliLaunchers`, which is what makes `resources/bin/orca-ide` executable) is skipped.

For a host-local server the floor is irrelevant, so patch **the remote clone only** — never commit it, never push it:

```js
// ~/orca-src/config/electron-builder.config.cjs
if (context.electronPlatformName === 'linux' && !process.env.ORCA_SKIP_LINUX_GLIBC_FLOOR) {
  verifyLinuxGlibcFloor(context.appOutDir)
}
```

Then rebuild with `ORCA_SKIP_LINUX_GLIBC_FLOOR=1`. Rules that come with the bypass:

- The artifact runs **only** on the machine that compiled it. Never copy `dist/linux-unpacked` to another Linux host — it crashes on startup on any older glibc.
- Every other `afterPack` check must still pass. `verify-packaged-daemon-entry` or `verify-packaged-plugin-resources` failing is a real regression, not something else to bypass.
- Say plainly in the report that the gate was bypassed and why.

### 8e. Repoint the shim, then kill the stale daemon before restarting

Restarting the service is **not enough**. `orca serve` is only the front-end; the long-lived
**daemon** owns sessions, PTYs and tab state, and it reattaches to an existing
`~/.config/orca/daemon/daemon-vNN.sock` instead of respawning. Because the build overwrites
`dist/linux-unpacked` in place, that daemon keeps executing a replaced inode — `/proc/<pid>/exe`
reads `... (deleted)` — and can serve **days-old code** while every other check (cgroup path, port,
HTTP 200, feature token in `app.asar`) looks perfectly correct. Every one of those checks reads the
new files on disk, not the running process. This is the single most likely reason a remote update
appears to do nothing.

```bash
SHIM=~/.config/orca/linux-orca-cli-shim/orca
cp "$SHIM" "$SHIM.<previous>-backup"          # one-line revert path
systemctl --user stop orca-server.service
printf '#!/usr/bin/env bash\nexec %s "$@"\n' "'$HOME/orca-src/dist/linux-unpacked/resources/bin/orca-ide'" > "$SHIM"
chmod +x "$SHIM"

# Kill every daemon still running a replaced binary (all socket versions, not just the newest).
for p in $(pgrep -f daemon-entry); do
  readlink /proc/$p/exe | grep -q '(deleted)' && kill "$p" && echo "killed stale daemon $p"
done
sleep 5
for p in $(pgrep -f daemon-entry); do
  readlink /proc/$p/exe | grep -q '(deleted)' && kill -9 "$p"
done

systemctl --user start orca-server.service
```

**Killing the daemon terminates every shell it owns** (`pgrep -fc shell-ready` counts them — it is
routinely 15–20). That is real potential work loss, so **ask the user before doing it** rather than
folding it into the restart. On a repeat run where the shim already points at `~/orca-src`, this
daemon kill *is* the whole install — repointing the shim is a no-op.

Reverting is restoring the backup and restarting — say so in the report.

### 8f. Verify before calling it done

```bash
systemctl --user status orca-server.service --no-pager      # cgroup must list the NEW path
ss -tlnp | grep <port>                                      # listener owned by the new orca-ide
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/   # 200
strings ~/orca-src/dist/linux-unpacked/resources/app.asar | grep -c <branch-feature-token>

# THE decisive check — no daemon may be running a replaced binary, and it must
# have started AFTER the build. Empty output and a fresh timestamp, or it is stale.
for p in $(pgrep -f daemon-entry); do readlink /proc/$p/exe; done | grep '(deleted)'
ps -eo pid,lstart,args | grep daemon-entry | grep -v grep
stat -c '%y' ~/orca-src/dist/linux-unpacked/resources/app.asar   # must predate the daemon
```

The feature-token grep proves the branch's code is in the bundle *on disk*. It does **not** prove
anything is executing it — that is what the `(deleted)` and start-time checks are for. Report the
daemon's start time next to the asar's build time; if the daemon is older, the update did not land
no matter how green everything else looks.

### 8g. What to warn the user about

- The restart briefly drops connected clients. Pairings survive because userData, port, and pairing address are unchanged.
- Agent panes that were already running keep reporting: the hook scripts source `~/.config/orca/agent-hooks/endpoint.env` at fire time, so they pick up the new hook port even though the stale `ORCA_AGENT_HOOK_PORT` is still in their process env. No need to restart agents.
- `orca serve` needs a display and auto-starts Xvfb **only if Xvfb is installed**. On a desktop distro the user manager usually carries one already — check `systemctl --user show-environment | grep DISPLAY`. If it is absent and Xvfb is missing, installing it needs sudo; surface that rather than silently leaving a server that dies on next boot.
- The previous install's daemon lingers under its own socket version (`daemon-vNN`) and is **not**
  harmless — see 8e. It keeps serving old code until killed, and the restart alone will not replace
  it. Killing it drops the shells it owns, so confirm with the user first. Genuinely dead sockets
  from long-gone installs (e.g. a `daemon-v28` whose process no longer exists) can be left alone.

## 9. Report

State: the tag merged, whether there were conflicts and how they were resolved, the installed version (`/Applications/Orca.app/Contents/Info.plist` → `CFBundleShortVersionString`, or `orca --version`), and the branch pushed to `origin`. On macOS also report the outer-app and Computer Use helper signing authorities, TeamIdentifiers, and `codesign --verify` result. If this was the one-time migration from ad-hoc signing, state whether TCC was reset and remind the user to grant Computer Use and any newly prompted notification permission.

If step 8 ran, also state: the host, what the shim now points at and how to revert it, the verification results (service active, port listening, HTTP probe, feature token present), whether the glibc floor gate was bypassed and the resulting do-not-copy constraint, and any Xvfb/display gap left open.
