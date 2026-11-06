import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, FolderTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The single root every clone and worktree lives under. Revva refuses to guess:
 * an unset root stops worktree creation with a message pointing here, because the
 * old fallbacks scattered checkouts across three unrelated directory trees.
 */
export function WorktreeRootField(): React.JSX.Element {
  const qc = useQueryClient()
  const saved = useQuery({ queryKey: ['settings', 'worktreeRoot'], queryFn: () => window.revva.settings.get('worktreeRoot') })
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? (typeof saved.data === 'string' ? saved.data : '')
  const dirty = draft !== null && draft !== (saved.data ?? '')

  const persist = (next: string): void => {
    void window.revva.settings.set('worktreeRoot', next).then(() => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['settings', 'worktreeRoot'] })
      void qc.invalidateQueries({ queryKey: ['worktrees'] })
    })
  }

  const browse = (): void => {
    void window.revva.workspace.pickFolder().then((picked) => {
      if (picked) persist(picked)
    })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-xs">
          <FolderTree className="size-3.5 text-muted-foreground" /> Worktree root
        </Label>
        <div className="flex items-center gap-1.5">
          {dirty && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => persist(draft!.trim())}>
              Save
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="/Users/you/revva"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && persist(value.trim())}
          className="font-mono text-xs"
        />
        <Button type="button" size="icon" variant="outline" aria-label="Browse for a worktree folder" title="Browse for a folder" onClick={browse}>
          <FolderOpen />
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Required. Review clones go to <code>&lt;root&gt;/repos/&lt;owner&gt;/&lt;repo&gt;</code>; their worktrees, and the
        worktrees of your own checkouts, go to <code>&lt;root&gt;/worktrees/…</code>. Keep it outside your repositories.
      </p>
    </div>
  )
}
