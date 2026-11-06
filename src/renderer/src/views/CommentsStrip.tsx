import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, MessageSquareText, Reply, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ActionError } from '@/lib/ask-agent'
import type { JiraComment, PushEvent } from '@shared/types'

/**
 * New Jira comments (M6): appears when reviewers/PMs commented on a shipped ticket
 * since revva last looked. The banner is an alert, not a task list — every comment
 * can be tackled (rework), answered in place, opened on Jira, or simply dismissed.
 */
export function CommentsStrip({ workId }: { workId: string }): React.JSX.Element | null {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'tackle' | 'dismiss' | 'reply' | null>(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const comments = useQuery({ queryKey: ['comments'], queryFn: () => window.revva.comments.pending() })

  useEffect(() => {
    return window.revva.events.on((e: PushEvent) => {
      if (e.kind === 'comments') qc.setQueryData(['comments'], e.items)
    })
  }, [qc])

  const mine = (comments.data ?? []).filter((c: JiraComment) => c.workId === workId)
  if (mine.length === 0) return null
  const ticketUrl = mine[0]!.url

  const run = (action: 'tackle' | 'dismiss' | 'reply', work: () => Promise<void>): void => {
    setBusy(action)
    setError(null)
    void work()
      .then(() => {
        if (action === 'reply') {
          setReplyOpen(false)
          setReplyText('')
        }
        void qc.invalidateQueries({ queryKey: ['comments'] })
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b bg-pink-500/5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <MessageSquareText className="size-3.5 shrink-0 text-pink-600 dark:text-pink-400" />
        <span className="font-medium">
          {mine.length} new Jira comment{mine.length > 1 ? 's' : ''} on {mine[0]!.ticketKey}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {ticketUrl && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              title={`Open ${mine[0]!.ticketKey} on Jira`}
              onClick={() => void window.revva.shell.openExternal(ticketUrl)}
            >
              <ExternalLink className="mr-1 size-3" />
              Open
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={busy !== null}
            title="Write a reply on the ticket without reworking the branch"
            onClick={() => {
              setReplyOpen((open) => !open)
              setError(null)
            }}
          >
            <Reply className="mr-1 size-3" />
            Reply
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={busy !== null}
            title="Nothing to do here — hide these comments"
            onClick={() => run('dismiss', () => window.revva.comments.dismiss(workId))}
          >
            <Check className="mr-1 size-3" />
            {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={busy !== null}
            onClick={() => run('tackle', () => window.revva.comments.tackle(workId))}
          >
            <Wrench className="mr-1 size-3" />
            {busy === 'tackle' ? 'Reworking…' : 'Tackle comments'}
          </Button>
        </div>
      </div>
      {mine.slice(0, 3).map((c) => (
        <p key={c.id} className="truncate text-[11px] text-muted-foreground" title={c.body}>
          <span className="font-medium">{c.author}:</span> {c.body}
        </p>
      ))}
      {mine.length > 3 && <p className="text-[11px] text-muted-foreground">…and {mine.length - 3} more</p>}
      {replyOpen && (
        <form
          className="flex items-center gap-1.5 pt-0.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!replyText.trim()) return
            run('reply', () => window.revva.comments.reply(workId, replyText))
          }}
        >
          <Input
            autoFocus
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={`Reply on ${mine[0]!.ticketKey}…`}
            aria-label="Jira reply"
            className="h-7 flex-1 text-[11px]"
          />
          <Button size="sm" className="h-7 px-2 text-[11px]" type="submit" disabled={!replyText.trim() || busy !== null}>
            {busy === 'reply' ? 'Sending…' : 'Send'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            type="button"
            onClick={() => {
              setReplyOpen(false)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </form>
      )}
      {error && <ActionError action="handle Jira comments" error={error} className="text-[11px]" />}
    </div>
  )
}
