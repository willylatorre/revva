/**
 * Gate in front of every action that creates a checkout.
 *
 * Revva refuses to guess the worktree root, so an action that needs one cannot
 * just fail: it asks. `ready()` resolves immediately when a usable root is
 * configured and otherwise opens the setup dialog and waits for the answer, so
 * callers read as if the folder were always there.
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RoleSel } from '@shared/types'
import { PR_SESSION_SELECTION, readSelection } from '@/lib/pr-session-selection'
import { WorktreeSetupDialog } from '@/views/WorktreeSetupDialog'

/** What the caller should do: `null` = cancelled; `sel` absent = use the configured defaults. */
export interface SetupAnswer {
  sel?: RoleSel
}

/** A root main can actually resolve: absolute, or a `~` it expands itself. */
function usableRoot(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.startsWith('/') || trimmed.startsWith('~') || /^[A-Za-z]:[\\/]/.test(trimmed)
}

export function useWorktreeSetup(): {
  /** Proceed when a root is configured; otherwise ask, and resolve what was picked. */
  ready: (reason: string) => Promise<SetupAnswer | null>
  dialog: React.JSX.Element
} {
  const qc = useQueryClient()
  const [asking, setAsking] = useState<{ reason: string; root: string; sel: RoleSel } | null>(null)
  const resolver = useRef<((answer: SetupAnswer | null) => void) | null>(null)

  const ready = useCallback(async (reason: string): Promise<SetupAnswer | null> => {
    const [root, stored] = await Promise.all([
      window.revva.settings.get('worktreeRoot'),
      window.revva.settings.get(PR_SESSION_SELECTION)
    ])
    // A root that already works means no interruption: the session uses the role
    // defaults, so a remembered pick can never quietly override what Setup says.
    if (usableRoot(root)) return {}
    return new Promise<SetupAnswer | null>((resolve) => {
      resolver.current = resolve
      setAsking({ reason, root: typeof root === 'string' ? root : '', sel: readSelection(stored) })
    })
  }, [])

  const settle = (answer: SetupAnswer | null): void => {
    const resolve = resolver.current
    resolver.current = null
    setAsking(null)
    if (answer) {
      // A folder and a model just became known: refresh the views that read them.
      void qc.invalidateQueries({ queryKey: ['settings', 'worktreeRoot'] })
      void qc.invalidateQueries({ queryKey: ['worktrees'] })
    }
    resolve?.(answer)
  }

  return {
    ready,
    dialog: (
      <WorktreeSetupDialog
        open={asking !== null}
        reason={asking?.reason ?? ''}
        initialRoot={asking?.root ?? ''}
        initialSelection={asking?.sel ?? {}}
        onOpenChange={(open) => {
          if (!open) settle(null)
        }}
        onReady={(sel) => settle({ sel })}
      />
    )
  }
}
