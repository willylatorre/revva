import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, ScanEye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionError, SendErrorToChatButton } from '@/lib/ask-agent'
import type { WorkSummary } from '@shared/types'
/** IPC rejections arrive wrapped; show the reviewer-facing sentence only. */
function cleanError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

/**
 * One button, the whole review cycle: reviewers fan out over the committed diff,
 * findings go to a fixer, and the round repeats until the gates pass (bounded).
 * Works in ordinary chats too — the first press attaches the conversation's review
 * utilities to its own folder, then the Workflow control takes over. A dirty
 * checkout offers to commit the changes first; nothing here ever pushes, opens a
 * PR, or discards work.
 */
export function ChatReviewButton({ sessionId, directory, work }: {
  sessionId: string
  /** The chat's folder — anchors the review when no run exists yet. */
  directory?: string
  work?: WorkSummary
}): React.JSX.Element {
  const qc = useQueryClient()
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [needsCommit, setNeedsCommit] = useState<{ files: string[]; branch: string; dir: string } | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), 6000)
    return () => window.clearTimeout(timer)
  }, [note])

  const closeDialog = (): void => {
    setNeedsCommit(null)
    trigger.current?.focus()
  }
  const start = async (commitMessage?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.revva.work.chatReview({
        sessionId,
        directory: directory || undefined,
        commitMessage: commitMessage?.trim() || undefined
      })
      if (result.status === 'needs-commit') {
        setNeedsCommit({
          files: result.files,
          branch: result.work.branch || 'the current branch',
          dir: result.work.worktreeDir || directory || ''
        })
        setMessage('')
      } else {
        if (result.note) setNote(result.note)
        setNeedsCommit(null)
        void qc.invalidateQueries({ queryKey: ['works'] })
        void qc.invalidateQueries({ queryKey: ['session-activity'] })
      }
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  const running = work?.state === 'REVIEW' || work?.state === 'FIXING'
  const blocker = running ? 'Stop the current review before starting another cycle.'
    : work?.state === 'BUILDING' ? 'The agent is still working. Wait for it to finish before reviewing.'
    : work?.state === 'SHIPPED' ? 'This run shipped. Send a follow-up with new changes before reviewing again.'
    : undefined
  const label = busy ? 'Starting review…' : running ? 'Review running' : 'Full review'
  return <>
    {blocker ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0">
            <Button size="sm" variant="outline" ref={trigger} disabled>
              {running && <Loader2 data-icon="inline-start" className="animate-spin" />}{label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{blocker}</TooltipContent>
      </Tooltip>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            ref={trigger}
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ScanEye data-icon="inline-start" />}
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reviewers check the committed changes, a fixer addresses their findings, and re-review runs until the gates pass. Nothing is pushed.</TooltipContent>
      </Tooltip>
    )}
    {error && (
      <span className="flex min-w-0 shrink items-center gap-1">
        <span role="alert" className="max-w-48 truncate text-xs text-destructive" title={error}>{error}</span>
        <SendErrorToChatButton action="full review" error={error} />
      </span>
    )}
    {note && <span role="status" className="max-w-48 truncate text-xs text-muted-foreground" title={note}>{note}</span>}
    <Dialog open={needsCommit !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
      <DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader>
          <DialogTitle>Commit before reviewing</DialogTitle>
          <DialogDescription>
            Reviewers only read commits. {needsCommit?.files.length ?? 0} uncommitted change(s) in {needsCommit?.dir || 'this checkout'} would otherwise be left out of the review.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-36 overflow-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">
          {(needsCommit?.files ?? []).join('\n') || 'Uncommitted changes'}
        </pre>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What changed? (becomes the commit message)"
          rows={2}
          className="min-h-16"
          aria-label="Commit message"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && message.trim()) void start(message)
          }}
        />
        <p className="text-xs text-muted-foreground">Everything listed above is staged and committed on {needsCommit?.branch}. Nothing is pushed.</p>
        {error && <ActionError action="commit before reviewing" error={error} className="text-sm" onSent={closeDialog} />}
        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
          <Button disabled={!message.trim() || busy} onClick={() => void start(message)}>
            {busy ? 'Committing and starting…' : 'Commit and run full review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
