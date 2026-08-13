import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { getActivePwdForVtab } from '@/store/slices/terminal-cwd'

// Why debounced: `cd` churn (a shell script walking directories, a `cd -` typo)
// would otherwise re-root the explorer and restart git status per prompt.
export const ACTIVE_PWD_DEBOUNCE_MS = 300

/**
 * Trailing-edge debounce for `cd` churn *within* one vertical tab. Switching
 * tabs is a discrete user action, not churn, so a new workspace key applies
 * immediately — otherwise every switch would show the previous tab's directory
 * for 300 ms and re-root its consumers twice.
 */
function useDebouncedPwd(
  pwd: string | null,
  workspaceKey: string | null,
  delayMs: number
): string | null {
  const [settled, setSettled] = useState({ pwd, workspaceKey })
  useEffect(() => {
    if (settled.workspaceKey !== workspaceKey) {
      setSettled({ pwd, workspaceKey })
      return
    }
    if (settled.pwd === pwd) {
      return
    }
    const timer = setTimeout(() => setSettled({ pwd, workspaceKey }), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs, pwd, settled, workspaceKey])
  return settled.pwd
}

/** Pwd the terminal-mode panels follow (Phase 3 consumers read this). */
export function useActiveVerticalTabPwd(): string | null {
  const workspaceKey = useAppStore((state) => state.activeWorkspaceKey)
  const pwd = useAppStore((state) =>
    state.activeWorkspaceKey ? getActivePwdForVtab(state, state.activeWorkspaceKey) : null
  )
  return useDebouncedPwd(pwd, workspaceKey, ACTIVE_PWD_DEBOUNCE_MS)
}
