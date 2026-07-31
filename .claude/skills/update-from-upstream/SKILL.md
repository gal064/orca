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

**Ask about remote servers now, not later.** If the user did not say whether a remote `orca serve` host should also be updated, ask before starting the merge — the answer changes the ordering (the remote clones from `origin`, so the push in step 7 must happen before step 8). One question is enough: which host(s), or none. If they named a host, skip the question and do step 8.

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

**macOS** — replace `/Applications/Orca.app` outright, no backup:

```bash
osascript -e 'quit app "Orca"' 2>/dev/null || true
rm -rf /Applications/Orca.app
cp -R dist/mac-arm64/Orca.app /Applications/Orca.app
```

Then **always** run the signature repair below before relaunching. `forceCodeSigning` is off for
non-release builds (`config/electron-builder.config.cjs`), so on a machine with no codesigning
identity electron-builder silently skips signing the outer bundle: the app keeps the prebuilt
Electron signature (`Identifier=Electron`) with a seal broken by the packaged resources.
`UNUserNotificationCenter` refuses to register an app with an invalid signature, so **every
notification is silently dropped** and Orca never appears in System Settings → Notifications.

```bash
codesign --force --deep --sign - /Applications/Orca.app
codesign --verify --deep --strict /Applications/Orca.app   # must exit 0 and print nothing
codesign -dvv /Applications/Orca.app 2>&1 | grep Identifier # must be com.stablyai.orca, not Electron
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Orca.app
killall usernoted 2>/dev/null || true
```

Run this from a shell **outside** the app being signed — `codesign` rewrites the Mach-O binary and
will kill a running Orca (including an agent session hosted in it). Quitting Orca in the step above
already covers this, but never sign an app you are currently running inside.

The signing identity changes from `Electron` to `com.stablyai.orca`, so macOS treats the app as new
and re-prompts for notification permission on first launch — tell the user to accept it.

Permanent fix worth suggesting: a free **Apple Development** certificate (Xcode → Settings →
Accounts → Manage Certificates → **+** → Apple Development). `findInstalledMacSigningIdentity` in
`config/electron-builder.config.cjs` picks it up automatically on non-release builds, so every
future build is signed with a stable identity and this repair step becomes a no-op.

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

Push to `origin` (the fork) on the current branch only. Never push to `upstream`, never force-push, and do not open a PR.

## 8. Install onto a remote `orca serve` host (only when asked)

Skip this whole step unless the user asked for it in step 1. The remote clones the branch from `origin`, so **step 7 must already be pushed**.

Build **on the remote host**, never cross-built from the Mac: native modules link against the host's glibc, and a darwin→linux native compile is not viable without Docker.

### 8a. Preflight the remote

```bash
ssh <host> 'uname -m; nproc; df -h /home | tail -1; sudo -n true && echo "passwordless sudo" || echo "sudo needs password"'
ssh <host> 'command -v git gcc make python3; node -v; ls ~/.nvm >/dev/null && echo "nvm present"'
```

- If `sudo` needs a password, install everything under `$HOME`. **Never** touch `/opt` or the distro package (`pacman`/`apt`) — leave a `stably-orca-bin`-style package installed and simply stop pointing the service at it.
- Node 24 and the pinned pnpm are required, same as locally. `nvm` is usually already there: `. ~/.nvm/nvm.sh && nvm use 24`, then `corepack pnpm` (no global install, no sudo).
- Budget ~4 GB for the clone plus build output.

### 8b. Find how the server is actually started — do not invent a service

```bash
ssh <host> 'systemctl --user list-units --type=service --all --no-legend | grep -i orca'
ssh <host> 'systemctl --user cat orca-server.service'
```

The unit typically calls a **one-line shim** rather than a binary directly, e.g.
`~/.config/orca/linux-orca-cli-shim/orca` → `exec '/opt/<pkg>/resources/bin/orca-ide' "$@"`.

When a shim exists, repointing it **is** the whole install. Leave the unit file, `--port`, and `--pairing-address` exactly as they are — matching the existing values is what keeps already-paired clients working. Ask the user before changing a port or run mode; "it's already running" means match it, not replace it.

### 8c. Build on the remote

```bash
ssh <host> 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh; nvm use 24
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

### 8e. Repoint the shim and restart

```bash
SHIM=~/.config/orca/linux-orca-cli-shim/orca
cp "$SHIM" "$SHIM.<previous>-backup"          # one-line revert path
systemctl --user stop orca-server.service
printf '#!/usr/bin/env bash\nexec %s "$@"\n' "'$HOME/orca-src/dist/linux-unpacked/resources/bin/orca-ide'" > "$SHIM"
chmod +x "$SHIM"
systemctl --user start orca-server.service
```

Reverting is restoring the backup and restarting — say so in the report.

### 8f. Verify before calling it done

```bash
systemctl --user status orca-server.service --no-pager      # cgroup must list the NEW path
ss -tlnp | grep <port>                                      # listener owned by the new orca-ide
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/   # 200
strings ~/orca-src/dist/linux-unpacked/resources/app.asar | grep -c <branch-feature-token>
```

The last one proves the branch's own feature actually shipped, not just that *something* is serving.

### 8g. What to warn the user about

- The restart briefly drops connected clients. Pairings survive because userData, port, and pairing address are unchanged.
- Agent panes that were already running keep reporting: the hook scripts source `~/.config/orca/agent-hooks/endpoint.env` at fire time, so they pick up the new hook port even though the stale `ORCA_AGENT_HOOK_PORT` is still in their process env. No need to restart agents.
- `orca serve` needs a display and auto-starts Xvfb **only if Xvfb is installed**. On a desktop distro the user manager usually carries one already — check `systemctl --user show-environment | grep DISPLAY`. If it is absent and Xvfb is missing, installing it needs sudo; surface that rather than silently leaving a server that dies on next boot.
- The previous install's daemon process can linger under its own socket version (`daemon-vNN`). Harmless, but mention it if the user is debugging session behavior.

## 9. Report

State: the tag merged, whether there were conflicts and how they were resolved, the installed version (`/Applications/Orca.app/Contents/Info.plist` → `CFBundleShortVersionString`, or `orca --version`), and the branch pushed to `origin`. On macOS also report the `codesign --verify` result and remind the user to accept the notification permission prompt on first launch.

If step 8 ran, also state: the host, what the shim now points at and how to revert it, the verification results (service active, port listening, HTTP probe, feature token present), whether the glibc floor gate was bypassed and the resulting do-not-copy constraint, and any Xvfb/display gap left open.
