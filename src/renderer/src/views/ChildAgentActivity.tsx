import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Bot, ChevronRight, CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useTranscriptVisibility } from '@/lib/transcript-stream'
import { cn } from '@/lib/utils'
import { childStatusLabel, childStatusTone, durationSince, statusTones, useChildActivity, type ChildStatusLabel } from '@/lib/agent-status'
import type { AgentSession } from '@shared/types'
import { FormCard, PermissionCard, useInbox } from './InboxView'

/** Domain composition: native/helper children, reusing Revva's agent-output controls. */
export function ChildAgentActivity({ sessionId, renderTranscript }: {
  sessionId: string
  renderTranscript: (child: AgentSession) => ReactNode
}): React.JSX.Element | null {
  const qc = useQueryClient()
  const visible = useTranscriptVisibility()
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
  const activity = useQuery({ queryKey: ['session-activity'], queryFn: () => window.revva.session.active(), enabled: false })
  const live = useChildActivity(visible)
  const inbox = useInbox()
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
  /** What a running child is doing right now; the row-level glance the panel lacked. */
  const detail = (row: AgentSession, label: ChildStatusLabel): string => {
    if (label !== 'Running') return ''
    const liveRow = live.data?.[row.sessionId]
    if (liveRow?.activity) return liveRow.activity
    return liveRow?.lastActivityAt && Date.now() - liveRow.lastActivityAt >= 60_000
      ? `No new activity for ${durationSince(Date.now() - liveRow.lastActivityAt)}`
      : 'Working…'
  }
  const rowIcon = (row: AgentSession, label: ChildStatusLabel): ReactNode => {
    if (label === 'Needs you') return <CircleAlert className="size-3.5 shrink-0 text-status-warning" />
    if (label === 'Failed') return <CircleAlert className="size-3.5 shrink-0 text-status-error" />
    if (waitsOn(row.sessionId).below) return <CircleAlert className="size-3.5 shrink-0 text-status-warning" aria-label="A delegated agent below needs you" />
    if (label === 'Running') return <Loader2 className={cn('size-3.5 shrink-0 motion-safe:animate-spin', statusTones.active.text)} />
    if (label === 'Finished') return <CircleCheck className={cn('size-3.5 shrink-0', statusTones.approved.text)} />
    return <Bot className="size-3.5 shrink-0" />
  }
  /** Collapsed-header glance: progress first, then what the newest running agent is doing. */
  const labels = rows.map((row) => status(row))
  const runningCount = labels.filter((label) => label === 'Running').length
  const doneCount = labels.filter((label) => label === 'Finished' || label === 'Failed' || label === 'Stopped').length
  const newest = rows.filter((_, i) => labels[i] === 'Running')
    .sort((a, b) => (live.data?.[b.sessionId]?.lastActivityAt ?? 0) - (live.data?.[a.sessionId]?.lastActivityAt ?? 0))[0]
  const glance = runningCount
    ? `${runningCount} running${newest ? ` · ${detail(newest, 'Running')}` : ''}`
    : doneCount === rows.length && doneCount > 0 ? `${doneCount}/${rows.length} finished`
      : 'Open output to inspect'

  if (!rows.length && !children.isError) return null
  return <section aria-label="Delegated agents" className="shrink-0 border-t px-3 py-2 sm:px-6">
    <Collapsible className="group/agents mx-auto max-w-3xl" defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-sm py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight className="size-3 shrink-0 group-data-[open]/agents:rotate-90" />
        <span className="font-medium">Agents ({rows.length})</span>
        {waiting.length > 0 && <Badge variant="secondary">{waiting.length} waiting on you</Badge>}
        <span className="ml-auto truncate pl-2 text-muted-foreground" title={glance}>{glance}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex max-h-40 flex-col overflow-y-auto">
          {rows.map((row) => {
            const label = status(row)
            const below = !waitsOn(row.sessionId).self && waitsOn(row.sessionId).below
            const note = detail(row, label)
            return <Button key={row.sessionId} type="button" variant="ghost" className="h-auto min-w-0 justify-start gap-2 px-2 py-2 text-left text-xs" aria-label={`${row.title}: ${label}${below ? ' (a delegated agent below needs you)' : ''}${note ? `. ${note}` : ''}. Open agent output`} onClick={(event) => {
              trigger.current = event.currentTarget
              setPath([row])
            }}>
              {rowIcon(row, label)}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0 truncate text-left" title={row.title}>{row.title}</span>
                {note && <span className="min-w-0 truncate text-left text-[11px] text-muted-foreground" title={note}>{note}</span>}
              </span>
              {row.agentID && <span className="max-w-32 shrink-0 truncate text-muted-foreground">{row.agentID}</span>}
              <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium', statusTones[childStatusTone(label)].pill)}>{label}</span>
            </Button>
          })}
        </div>
        {children.isError && <p role="alert" className="py-1 text-xs text-destructive">Could not load agents. <Button size="xs" variant="outline" onClick={() => void children.refetch()}>Retry</Button></p>}
      </CollapsibleContent>
    </Collapsible>
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
                  {rowIcon(row, label)}<span className="min-w-0 flex-1 truncate text-left">{row.title}</span><span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium', statusTones[childStatusTone(label)].pill)}>{label}</span>
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
  </section>
}
