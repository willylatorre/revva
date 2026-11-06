/**
 * Asked for before a PR action needs a checkout: the worktree root (the one
 * setting Revva refuses to guess) and the agent/model the new session runs on.
 *
 * It exists so a missing root is a question, not a dead end — the action that
 * needs the folder opens this, the user picks it, and the action continues.
 */
import { FolderOpen, FolderTree } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RoleSel } from '@shared/types'
import { PR_SESSION_SELECTION, selectionKeys } from '@/lib/pr-session-selection'
import { RoleSelectors, selOrUndefined } from './RoleSelectors'

export function WorktreeSetupDialog({
  open,
  initialRoot,
  initialSelection,
  reason,
  onOpenChange,
  onReady
}: {
  open: boolean
  /** Whatever the setting holds now, so an invalid value can be corrected rather than retyped. */
  initialRoot: string
  initialSelection: RoleSel
  /** Why the folder is needed, e.g. "to check out this PR for the review". */
  reason: string
  onOpenChange: (open: boolean) => void
  /** Called with the saved selection once a root is chosen. */
  onReady: (sel: RoleSel) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Where should Revva keep its checkouts?</DialogTitle>
          <DialogDescription>
            Revva needs your worktree root {reason}. It never guesses this folder, because clones from
            different runs would otherwise scatter across your disk.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <SetupChoices
            initialRoot={initialRoot}
            initialSelection={initialSelection}
            onOpenChange={onOpenChange}
            onReady={onReady}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SetupChoices({
  initialRoot,
  initialSelection,
  onOpenChange,
  onReady
}: {
  initialRoot: string
  initialSelection: RoleSel
  onOpenChange: (open: boolean) => void
  onReady: (sel: RoleSel) => void
}): React.JSX.Element {
  const picked = selectionKeys(initialSelection)
  const [root, setRoot] = useState(initialRoot)
  const [agentID, setAgentID] = useState(picked.agentID)
  const [modelKey, setModelKey] = useState(picked.modelKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const browse = (): void => {
    void window.revva.workspace.pickFolder().then((folder) => {
      if (!folder) return
      setRoot(folder)
      setError(null)
    })
  }

  const save = (): void => {
    const next = root.trim()
    if (!next) {
      setError('Choose the folder Revva should keep its checkouts in.')
      return
    }
    const sel = selOrUndefined(agentID, modelKey) ?? {}
    setSaving(true)
    setError(null)
    void window.revva.settings
      .set('worktreeRoot', next)
      .then(() => window.revva.settings.set(PR_SESSION_SELECTION, sel))
      .then(() => {
        // Only onReady settles — calling onOpenChange here would read as a cancel.
        onReady(sel)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-xs">
            <FolderTree className="size-3.5 text-muted-foreground" /> Worktree root
          </Label>
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="/Users/you/revva"
              value={root}
              onChange={(e) => {
                setRoot(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Browse for a folder"
              title="Browse for a folder"
              onClick={browse}
            >
              <FolderOpen />
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Review clones go to <code>&lt;root&gt;/repos/&lt;owner&gt;/&lt;repo&gt;</code>; their worktrees, and the
            worktrees of your own checkouts, go to <code>&lt;root&gt;/worktrees/…</code>. Keep it outside your
            repositories.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Agent and model for this session</Label>
          <RoleSelectors agentID={agentID} modelKey={modelKey} onAgent={setAgentID} onModel={setModelKey} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Remembered for the next PR session Revva starts. The role defaults live in Setup → Agents.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save and continue'}
        </Button>
      </DialogFooter>
    </>
  )
}
