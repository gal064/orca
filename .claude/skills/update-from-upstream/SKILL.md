---
name: update-from-upstream
description: Pull the latest stable release tag from the upstream Orca repo (stablyai/orca), merge it into the current local branch, then build and install the app onto this machine. Use when the user asks to "update from upstream", "pull latest stable", "merge the latest release", or "rebuild and install Orca".
---

# Update from upstream stable release

Merge the newest **stable** upstream release into the current branch, then build and install it locally.

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

## 8. Report

State: the tag merged, whether there were conflicts and how they were resolved, the installed version (`/Applications/Orca.app/Contents/Info.plist` → `CFBundleShortVersionString`, or `orca --version`), and the branch pushed to `origin`.
