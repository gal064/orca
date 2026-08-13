import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { statRuntimePath } from '@/runtime/runtime-file-client'
import { getRuntimeRepoRootForPath } from '@/runtime/runtime-repo-root-client'
import { runtimeEnvironmentSupportsCapability } from '@/runtime/runtime-rpc-client'
import { ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { getTerminalModeGroupIds } from '../../../../shared/terminal-mode-group'
import { getFileExplorerOperationOwnerFromState } from '@/components/right-sidebar/file-explorer-operation-owner'
import { useActiveVerticalTabPwd } from './use-active-vertical-tab-pwd'
import {
  requiresAbsolutePathScope,
  resolveTerminalModeGitRoot,
  resolveTerminalModePanelRoot,
  type AbsolutePathScopeState,
  type PanelOwnerKind
} from './terminal-mode-panel-root'

type RootValidation = {
  valid: boolean
  repoRoot: string | null | undefined
}

/** Start directory of the active vertical tab, or null when none is active. */
function resolveActiveVerticalTabRoot(
  activeWorkspaceKey: string | null,
  folderWorkspaces: AppState['folderWorkspaces'],
  projectGroups: AppState['projectGroups']
): string | null {
  const scope = activeWorkspaceKey ? parseWorkspaceKey(activeWorkspaceKey) : null
  if (scope?.type !== 'folder') {
    return null
  }
  const workspace = folderWorkspaces.find((candidate) => candidate.id === scope.folderWorkspaceId)
  if (!workspace || !getTerminalModeGroupIds(projectGroups).has(workspace.projectGroupId)) {
    return null
  }
  // A vertical tab always has a start directory (`createVerticalTab` requires one);
  // treating a blank one as "not a vertical tab" keeps every consumer on the
  // classic path rather than rooting panels at nothing.
  return workspace.folderPath.trim() || null
}

async function resolveAbsolutePathScopeState(
  ownerKind: PanelOwnerKind,
  environmentId: string | null,
  workspaceRoot: string | null,
  pwd: string | null
): Promise<AbsolutePathScopeState> {
  if (!requiresAbsolutePathScope(ownerKind, workspaceRoot, pwd) || !environmentId) {
    return 'not-required'
  }
  try {
    return (await runtimeEnvironmentSupportsCapability(
      environmentId,
      ABSOLUTE_PATH_SCOPE_RUNTIME_CAPABILITY
    ))
      ? 'available'
      : 'unavailable'
  } catch {
    // Why clamp on failure: sending the param to a host that strips it returns the
    // workspace root's contents under the pwd's name — wrong data, not an error.
    return 'unavailable'
  }
}

/**
 * Terminal mode's panel plumbing: resolves the directory the File Explorer,
 * Source Control, git-status poller and file watcher follow, publishes it to
 * main's filesystem boundary, and derives the enclosing repository.
 *
 * Mounted by TerminalModeSidebarHost, so classic mode installs none of it and
 * the store scope stays null.
 */
export function useTerminalModePanelScope(): void {
  const setTerminalModePanelScope = useAppStore((s) => s.setTerminalModePanelScope)
  const collapseAllDirs = useAppStore((s) => s.collapseAllDirs)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const workspaceRoot = useMemo(
    () => resolveActiveVerticalTabRoot(activeWorkspaceKey, folderWorkspaces, projectGroups),
    [activeWorkspaceKey, folderWorkspaces, projectGroups]
  )
  const workspaceKey = workspaceRoot === null ? null : activeWorkspaceKey
  const pwd = useActiveVerticalTabPwd()
  // Why one selector returning a joined string: the owner is a fresh object per
  // call, and resolving it is not free — three subscriptions would re-run it on
  // every store write, including every cwd fact.
  const ownerKey = useAppStore((s) => {
    const owner = getFileExplorerOperationOwnerFromState(s, workspaceKey)
    return owner.kind === 'runtime'
      ? `runtime:${owner.environmentId}`
      : owner.kind === 'ssh'
        ? `ssh:${owner.connectionId}`
        : owner.kind
  })
  const [ownerKind, ownerId] = useMemo(() => {
    const separator = ownerKey.indexOf(':')
    return separator === -1
      ? ([ownerKey as PanelOwnerKind, null] as const)
      : ([ownerKey.slice(0, separator) as PanelOwnerKind, ownerKey.slice(separator + 1)] as const)
  }, [ownerKey])
  const environmentId = ownerKind === 'runtime' ? ownerId : null
  const connectionId = ownerKind === 'ssh' ? ownerId : null

  /** Last root that resolved on this host — what a foreign pwd falls back to. */
  const lastValidRootRef = useRef<{ workspaceKey: string; root: string } | null>(null)
  const committedRootRef = useRef<{ workspaceKey: string; root: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    const validateRoot = async (
      root: string,
      absolutePathScope: AbsolutePathScopeState
    ): Promise<RootValidation> => {
      if (ownerKind === 'local') {
        // One round trip: main corroborates the directory against a cwd it saw a
        // shell of this tab in, grants it, and answers with its repository.
        const api = window.api?.terminalMode?.setPathScope
        if (!api || !workspaceKey) {
          return { valid: false, repoRoot: undefined }
        }
        const result = await api({ scope: { workspaceKey, root } })
        return { valid: result.accepted, repoRoot: result.accepted ? result.repoRoot : undefined }
      }
      if (ownerKind === 'unresolved') {
        return { valid: false, repoRoot: undefined }
      }
      const context = {
        settings:
          ownerKind === 'runtime'
            ? { activeRuntimeEnvironmentId: environmentId }
            : { activeRuntimeEnvironmentId: null },
        worktreeId: workspaceKey,
        worktreePath: workspaceRoot,
        ...(connectionId ? { connectionId } : {}),
        // Never unconditional: a host without the capability must be probed over
        // the relative contract, or the probe itself throws and every root looks
        // unreachable.
        ...(absolutePathScope === 'available' ? { absolutePathScope: true as const } : {})
      }
      try {
        if (!(await statRuntimePath(context, root)).isDirectory) {
          return { valid: false, repoRoot: undefined }
        }
      } catch {
        return { valid: false, repoRoot: undefined }
      }
      try {
        const repoRoot = await getRuntimeRepoRootForPath(
          {
            settings: context.settings,
            ...(connectionId ? { connectionId } : {})
          },
          root
        )
        // An old host cannot answer at all. Claiming the start folder is a
        // repository the host never confirmed would un-hide the whole git surface
        // against a directory that may not be one, so degrade to the quiet
        // empty state instead.
        return { valid: true, repoRoot: repoRoot === 'unsupported' ? null : repoRoot }
      } catch {
        // Why null and not undefined: `undefined` means "still resolving", which
        // renders a blank panel with no message and no retry until the next `cd`.
        return { valid: true, repoRoot: null }
      }
    }

    const run = async (): Promise<void> => {
      if (!workspaceKey) {
        lastValidRootRef.current = null
        committedRootRef.current = null
        setTerminalModePanelScope(null)
        void window.api?.terminalMode?.setPathScope?.({ scope: null })
        return
      }
      const lastValid =
        lastValidRootRef.current?.workspaceKey === workspaceKey
          ? lastValidRootRef.current.root
          : null
      const absolutePathScope = await resolveAbsolutePathScopeState(
        ownerKind,
        environmentId,
        workspaceRoot,
        pwd
      )
      if (cancelled) {
        return
      }
      let resolved = resolveTerminalModePanelRoot({
        pwd,
        workspaceRoot,
        pwdStatus: 'valid',
        absolutePathScope,
        lastValidRoot: lastValid
      })
      let repoRoot: string | null | undefined
      if (resolved.root) {
        const validation = await validateRoot(resolved.root, absolutePathScope)
        if (cancelled) {
          return
        }
        if (validation.valid) {
          repoRoot = validation.repoRoot
        } else {
          resolved = resolveTerminalModePanelRoot({
            pwd,
            workspaceRoot,
            pwdStatus: 'foreign',
            absolutePathScope,
            lastValidRoot: lastValid
          })
          if (resolved.root) {
            const fallback = await validateRoot(resolved.root, absolutePathScope)
            if (cancelled) {
              return
            }
            repoRoot = fallback.valid ? fallback.repoRoot : null
          }
        }
      }
      if (!resolved.root || !workspaceRoot) {
        setTerminalModePanelScope(null)
        return
      }
      if (!resolved.foreignPwd) {
        lastValidRootRef.current = { workspaceKey, root: resolved.root }
      }
      // Why collapse: expanded directories are kept per workspace key, and a vtab
      // keeps its key across `cd`, so the previous root's expansions would be
      // re-read as if they were children of the new one. Keyed by workspace so a
      // tab *switch* — which brings its own expansions — never collapses them.
      const committed = committedRootRef.current
      if (committed?.workspaceKey === workspaceKey && committed.root !== resolved.root) {
        collapseAllDirs(workspaceKey)
      }
      committedRootRef.current = { workspaceKey, root: resolved.root }
      setTerminalModePanelScope({
        workspaceKey,
        root: resolved.root,
        workspaceRoot,
        repoRoot: resolveTerminalModeGitRoot(ownerKind, repoRoot, workspaceRoot),
        // Why re-derived from the committed root: the capability was probed against
        // the *reported* pwd, but a rejected pwd falls back to another directory,
        // which may sit on the other side of the workspace root.
        addressing:
          absolutePathScope === 'available' &&
          requiresAbsolutePathScope(ownerKind, workspaceRoot, resolved.root)
            ? 'absolute'
            : 'relative',
        clampedToWorkspaceRoot: resolved.clampedToWorkspaceRoot
      })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [
    collapseAllDirs,
    connectionId,
    environmentId,
    ownerKind,
    pwd,
    setTerminalModePanelScope,
    workspaceKey,
    workspaceRoot
  ])

  // Why a separate unmount effect: the effect above re-runs on every `cd`, and
  // revoking the grant there would blank the panels between two directories.
  useEffect(
    () => () => {
      setTerminalModePanelScope(null)
      void window.api?.terminalMode?.setPathScope?.({ scope: null })
    },
    [setTerminalModePanelScope]
  )
}
