import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Bot, CircleAlert, CircleCheck, CirclePause, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { childStatusLabel, childStatusTone, durationSince, reviewRowTone, reviewStatusPills, statusTones, useChildActivity, type ChildStatusLabel, type StatusTone } from '@/lib/agent-status'
import { useInbox } from '@/views/InboxView'
import { useTranscriptVisibility } from '@/lib/transcript-stream'
import { isReviewStopped } from '@/lib/agent-status'
import type { AgentSession, ReviewRow, WorkSummary } from '@shared/types'
import { FormCard, PermissionCard } from '@/views/InboxView'

const roleLabels: Record<string, string> = {
  sol: 'Sol-loop',
  testAudit: 'Test audit',
  impeccable: 'UI review',
  fixer: 'Fixer'
}

/** Compact tone pill; the sidebar card is too narrow for full Badges. */
function Pill({ tone, children }: { tone: StatusTone, children: ReactNode }): React.JSX.Element {
  return <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium whitespace-nowrap', statusTones[tone].pill)}>{children}</span>
}

/**
 * The one place delegated agents and review-cycle progress are shown: a compact
 * card in the right rail under Stats. Each child carries a live activity line —
 * it exists for the moments when nothing looks like it moves. A row opens the
 * full output dialog (transcript, follow-ups, nested delegations).
 */
export function AgentsPanel({ sessionId, work, renderTranscript }: {
  sessionId: string
  work?: WorkSummary
  renderTranscript: (child: AgentSession) => ReactNode
}): React.JSX.Element | null {
  const qc = useQueryClient()
  const visible = useTranscriptVisibility()
  const inbox = useInbox()
  const live = useChildActivity(visible)
  const busy = work?.state === 'REVIEW' || work?.state === 'FIXING'
  const [path, setPath] = useState<AgentSession[]>([])
  const trigger = useRef<HTMLButtonElement | null>(null)
  const children = useQuery({
    queryKey: ['session-children', sessionId],
    queryFn: () => window.revva.session.children(sessionId),
    enabled: visible,
    staleTime: 30_000
  })
  const snapshot = path.at(-1)
  const parentId = path.at(-2)?.sessionId ?? sessionId
  const parent = useQuery({
    queryKey: ['session-children', parentId],
    queryFn: () => window.revva.session.children(parentId),
    enabled: visible && !!snapshot,
    staleTime: 30_000
  })
  const selected = parent.data?.find((row) => row.sessionId === snapshot?.sessionId) ?? snapshot
  const descendants = useQuery({
    queryKey: ['session-children', selected?.sessionId],
    queryFn: () => window.revva.session.children(selected!.sessionId),
    enabled: visible && !!selected,
    staleTime: 30_000
  })
  const reviews = useQuery({
    queryKey: ['reviews', work?.id],
    queryFn: () => window.revva.work.reviews(work!.id),
    enabled: visible && !!work,
    refetchInterval: busy ? 5_000 : false
  })
  const activity = useQuery({ queryKey: ['session-activity'], queryFn: () => window.revva.session.active(), enabled: false })
  useEffect(() => window.revva.events.on((event) => {
    if ((event.kind === 'session.children' && (event.sessionId === sessionId || event.sessionId === '*')) || (event.kind === 'chat.idle' && event.sessionId === '*')) {
      void qc.invalidateQueries({ queryKey: ['session-children', sessionId] })
    }
    if (selected && ((event.kind === 'session.children' && (event.sessionId === selected.sessionId || event.sessionId === '*')) || (event.kind === 'chat.idle' && event.sessionId === '*'))) {
      void qc.invalidateQueries({ queryKey: ['session-children', selected.sessionId] })
    }
    if (snapshot && event.kind === 'session.children' && (event.sessionId === parentId || event.sessionId === '*')) {
      void qc.invalidateQueries({ queryKey: ['session-children', parentId] })
    }
  }), [qc, sessionId, selected?.sessionId, parentId, snapshot?.sessionId])
  const stop = useMutation({
    mutationFn: (id: string) => window.revva.chat.interrupt(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['session-activity'] })
      void qc.invalidateQueries({ queryKey: ['session-children', sessionId] })
    }
  })
  const [draft, setDraft] = useState('')
  const running = !!selected && (activity.data?.includes(selected.sessionId) ?? false)
  useEffect(() => { setDraft('') }, [selected?.sessionId])
  const send = useMutation({
    mutationFn: (text: string) => window.revva.chat.prompt(selected!.sessionId, text, undefined, running),
    onSuccess: () => {
      setDraft('')
      void qc.invalidateQueries({ queryKey: ['chat-messages', selected!.sessionId] })
      void qc.invalidateQueries({ queryKey: ['session-activity'] })
      if (running) void qc.invalidateQueries({ queryKey: ['session-queue', selected!.sessionId] })
    }
  })

  const rows = children.data ?? []
  const waiting = inbox.filter((item) => item.rootId === sessionId)
  /** Does this agent wait on you directly, or does one of its descendants? */
  const waitsOn = (id: string): { self: boolean; below: boolean } => ({
    self: inbox.some((item) => item.sessionID === id),
    below: inbox.some((item) => item.branch?.includes(id))
  })
  const status = (row: AgentSession): ChildStatusLabel => childStatusLabel(row, {
    needsYou: waitsOn(row.sessionId).self,
    running: activity.data?.includes(row.sessionId) ?? false
  })
  /** What a running child is doing right now; the glance the panel exists for. */
  const detail = (row: AgentSession, label: ChildStatusLabel): string => {
    if (label !== 'Running') return ''
    const liveRow = live.data?.[row.sessionId]
    if (liveRow?.activity) return liveRow.activity
    return liveRow?.lastActivityAt && Date.now() - liveRow.lastActivityAt >= 60_000
      ? `No new activity for ${durationSince(Date.now() - liveRow.lastActivityAt)}`
      : 'Working…'
  }
  const rowIcon = (row: AgentSession, label: ChildStatusLabel): ReactNode => {
    if (label === 'Needs you') return <CircleAlert className={cn('size-3 shrink-0', statusTones.attention.text)} />
    if (label === 'Failed') return <CircleAlert className={cn('size-3 shrink-0', statusTones.error.text)} />
    if (label === 'Running') return <Loader2 className={cn('size-3 shrink-0 motion-safe:animate-spin', statusTones.active.text)} />
    if (label === 'Finished') return <CircleCheck className={cn('size-3 shrink-0', statusTones.approved.text)} />
    if (label === 'Stopped') return <CirclePause className={cn('size-3 shrink-0', statusTones.neutral.text)} />
    return <Bot className="size-3 shrink-0 text-muted-foreground" />
  }

  const round = (reviews.data ?? []).reduce((latest, row) => Math.max(latest, row.round), 0)
  const currentRound = (reviews.data ?? []).filter((row) => row.round === round)
  const reviewers = [...new Map(currentRound.filter((row) => row.role !== 'fixer').map((row) => [row.role, row])).values()]
  const fixer = currentRound.find((row) => row.role === 'fixer')
  const gates = reviewers.filter((row) => row.status !== 'skipped')
  const approved = gates.filter((row) => row.status === 'approved').length
  const showingReview = !!work && (busy || round > 0)

  if (!showingReview && rows.length === 0 && !children.isError) return null

  const gateRow = (row: ReviewRow, label: string): React.JSX.Element => {
    const stopped = isReviewStopped(row)
    const tone = reviewRowTone(row)
    return <li key={row.id} className="flex min-w-0 items-center gap-1.5 text-[11px]" title={row.activity ?? undefined}>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {row.status === 'running' && <Loader2 className={cn('size-3 shrink-0 motion-safe:animate-spin', statusTones.active.text)} />}
        {stopped && <CirclePause className={cn('size-3 shrink-0', statusTones.attention.text)} aria-label="Stopped" />}
        <Pill tone={tone}>{stopped ? 'stopped' : reviewStatusPills[row.status]}</Pill>
      </span>
    </li>
  }
  const childRow = (row: AgentSession, onOpen: () => void): React.JSX.Element => {
    const label = status(row)
    const below = !waitsOn(row.sessionId).self && waitsOn(row.sessionId).below
    const note = detail(row, label)
    return <li className="min-w-0">
      <button type="button" className="w-full rounded-sm px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-accent"
        aria-label={`${row.title}: ${label}${below ? ' (a delegated agent below needs you)' : ''}${note ? `. ${note}` : ''}. Open agent output`}
        onClick={(event) => { trigger.current = event.currentTarget; onOpen() }}>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
          {rowIcon(row, label)}
          <span className="min-w-0 truncate text-muted-foreground">{row.title}</span>
          <span className="ml-auto"><Pill tone={childStatusTone(label)}>{label.toLowerCase()}</Pill></span>
        </span>
        {note && <span className="mt-0.5 block truncate pl-[18px] text-[10px] text-muted-foreground" title={note}>{note}</span>}
      </button>
    </li>
  }

  return <>
    <section aria-label="Agent progress" className="pointer-events-auto w-[200px] overflow-hidden rounded-lg border bg-background/95 px-2 py-1.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[9px] font-medium tracking-wide text-muted-foreground">AGENTS ({rows.length})</span>
        {showingReview && work?.reviewRound && <Pill tone="active">round {work.reviewRound}/{work.reviewRoundsMax ?? '?'}</Pill>}
      </div>
      {showingReview && (
        <ul className="space-y-1">
          {reviewers.map((row) => gateRow(row, roleLabels[row.role] ?? row.role))}
          {fixer && gateRow(fixer, roleLabels.fixer ?? 'Fixer')}
        </ul>
      )}
      {showingReview && gates.length > 0 && (
        <p className={cn('mt-1.5 text-[10px] font-medium tabular-nums', approved === gates.length ? 'text-status-success' : 'text-muted-foreground')}>
          {approved}/{gates.length} gates approved
        </p>
      )}
      {rows.length > 0 && (
        <ul className={cn('max-h-56 space-y-0.5 overflow-y-auto', showingReview && 'mt-1.5 border-t pt-1.5')}>
          {rows.map((row) => childRow(row, () => setPath([row])))}
        </ul>
      )}
      {children.isError && <p role="alert" className="mt-1 text-[10px] text-destructive">Could not load agents. <Button size="xs" variant="outline" onClick={() => void children.refetch()}>Retry</Button></p>}
      {waiting.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-status-warning">
          <CircleAlert className="size-3 shrink-0" /> {waiting.length} waiting on you
        </p>
      )}
    </section>
    <Dialog open={path.length > 0} onOpenChange={(open) => { if (!open) { setPath([]); stop.reset(); send.reset() } }}>
      <DialogContent className="flex h-[85vh] max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader className="min-w-0 shrink-0 pr-6">
          <DialogTitle className="truncate" title={selected?.title}>{selected?.title ?? 'Agent output'}</DialogTitle>
          <DialogDescription className="break-words">{selected ? `${status(selected)}${selected.agentID ? ` · ${selected.agentID}` : ''}. Follow-ups below go directly to this agent.` : 'This child session is no longer available.'}</DialogDescription>
        </DialogHeader>
        {path.length > 1 && <Button type="button" size="sm" variant="ghost" className="max-w-full self-start shrink-0" title={`Back to ${path.at(-2)?.title}`} onClick={() => { setPath((current) => current.slice(0, -1)); stop.reset(); send.reset() }}><span className="truncate">Back to {path.at(-2)?.title}</span></Button>}
        {selected && activity.data?.includes(selected.sessionId) && <Button type="button" size="sm" variant="outline" className="self-start shrink-0" disabled={stop.isPending} onClick={() => stop.mutate(selected.sessionId)}>{stop.isPending ? 'Stopping…' : 'Stop agent'}</Button>}
        {stop.error && <p role="alert" className="text-xs text-destructive shrink-0">{stop.error.message}</p>}
        {/* Requests and descendants share one shrinkable band, so the transcript below always keeps its reserved space. */}
        {selected && (
          <div className="min-h-0 shrink overflow-y-auto">
            {inbox.filter((item) => item.sessionID === selected.sessionId).map((item) => item.kind === 'form' ? <FormCard key={item.id} item={item} /> : <PermissionCard key={item.id} item={item} />)}
            {descendants.data?.length || descendants.isError ? <section aria-label="Delegated agents" className="border-b pb-2">
              <p className="text-xs font-medium">Delegated agents</p>
              {descendants.data?.map((row) => {
                const label = status(row)
                const below = !waitsOn(row.sessionId).self && waitsOn(row.sessionId).below
                return <Button key={row.sessionId} type="button" variant="ghost" className="h-auto w-full min-w-0 justify-start px-2 py-2 text-xs" aria-label={`${row.title}: ${label}${below ? ' (a delegated agent below needs you)' : ''}. Open agent output`} onClick={() => { setPath((current) => [...current, row]); stop.reset(); send.reset() }}>
                  {rowIcon(row, label)}<span className="min-w-0 flex-1 truncate text-left">{row.title}</span><Pill tone={childStatusTone(label)}>{label.toLowerCase()}</Pill>
                </Button>
              })}
              {descendants.isError && <p role="alert" className="text-xs text-destructive">Could not load delegated agents. <Button size="xs" variant="outline" onClick={() => void descendants.refetch()}>Retry</Button></p>}
            </section> : null}
          </div>
        )}
        {selected && <div className="flex min-h-[45%] min-w-0 flex-1 flex-col">{renderTranscript(selected)}</div>}
        {selected && (
          <form
            className="shrink-0"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim() && !send.isPending) send.mutate(draft.trim())
            }}
          >
            {send.error instanceof Error && <p role="alert" className="mb-1 text-xs text-destructive">{send.error.message}</p>}
            <div className="flex flex-col rounded-xl border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea
                aria-label={`Message ${selected.title}`}
                placeholder={running ? 'Queue a follow-up…' : 'Send a follow-up…'}
                rows={2}
                value={draft}
                disabled={send.isPending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                className="max-h-40 min-h-10 resize-none rounded-none border-0 bg-transparent px-4 pb-2 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <div className="flex flex-wrap items-center justify-end gap-1 px-2 pb-2">
                <span className="mr-auto px-1 text-xs text-muted-foreground">{running ? 'Queues behind the current turn' : 'Enter to send · Shift+Enter for a new line'}</span>
                <Button type="submit" size="sm" disabled={!draft.trim() || send.isPending}>
                  <ArrowUp data-icon="inline-start" /> {send.isPending ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  </>
}
