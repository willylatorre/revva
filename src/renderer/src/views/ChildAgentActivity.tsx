import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronRight, CircleAlert, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranscriptVisibility } from '@/lib/transcript-stream'
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
  const rows = children.data ?? []
  const waiting = inbox.filter((item) => item.rootId === sessionId)
  /** Does this agent wait on you directly, or does one of its descendants? */
  const waitsOn = (id: string): { self: boolean; below: boolean } => ({
    self: inbox.some((item) => item.sessionID === id),
    below: inbox.some((item) => item.branch?.includes(id))
  })
  const status = (row: AgentSession): string => waitsOn(row.sessionId).self ? 'Needs you'
    : activity.data?.includes(row.sessionId) ? 'Running'
      : row.outcome === 'failed' ? 'Failed' : row.outcome === 'interrupted' ? 'Stopped' : row.outcome === 'succeeded' ? 'Finished' : 'Ready'
  const rowIcon = (row: AgentSession, label: string): ReactNode => {
    if (label === 'Running') return <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" />
    if (label === 'Needs you' || label === 'Failed') return <CircleAlert className="size-3.5 shrink-0 text-status-warning" />
    if (waitsOn(row.sessionId).below) return <CircleAlert className="size-3.5 shrink-0 text-status-warning/60" aria-label="A delegated agent below needs you" />
    return <Bot className="size-3.5 shrink-0" />
  }

  if (!rows.length && !children.isError) return null
  return <section aria-label="Delegated agents" className="shrink-0 border-t px-3 py-2 sm:px-6">
    <Collapsible className="group/agents mx-auto max-w-3xl" defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-sm py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight className="size-3 shrink-0 group-data-[open]/agents:rotate-90" />
        <span className="font-medium">Agents ({rows.length})</span>
        {waiting.length > 0 && <Badge variant="secondary">{waiting.length} waiting on you</Badge>}
        <span className="ml-auto text-muted-foreground">Open output to inspect</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex max-h-32 flex-col overflow-y-auto">
          {rows.map((row) => {
            const label = status(row)
            const below = !waitsOn(row.sessionId).self && waitsOn(row.sessionId).below
            return <Button key={row.sessionId} type="button" variant="ghost" className="h-auto min-w-0 justify-start px-2 py-2 text-xs" aria-label={`${row.title}: ${label}${below ? ' (a delegated agent below needs you)' : ''}. Open agent output`} onClick={(event) => {
              trigger.current = event.currentTarget
              setPath([row])
            }}>
              {rowIcon(row, label)}
              <span className="min-w-0 flex-1 truncate text-left" title={row.title}>{row.title}</span>
              {row.agentID && <span className="max-w-32 truncate text-muted-foreground">{row.agentID}</span>}
              <span className="shrink-0 text-muted-foreground">{label}</span>
            </Button>
          })}
        </div>
        {children.isError && <p role="alert" className="py-1 text-xs text-destructive">Could not load agents. <Button size="xs" variant="outline" onClick={() => void children.refetch()}>Retry</Button></p>}
      </CollapsibleContent>
    </Collapsible>
    <Dialog open={path.length > 0} onOpenChange={(open) => { if (!open) { setPath([]); stop.reset() } }}>
      <DialogContent className="flex h-[85vh] max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader>
          <DialogTitle>{selected?.title ?? 'Agent output'}</DialogTitle>
          <DialogDescription>{selected ? `${status(selected)}${selected.agentID ? ` · ${selected.agentID}` : ''}. Send follow-ups through the coordinator.` : 'This child session is no longer available.'}</DialogDescription>
        </DialogHeader>
        {path.length > 1 && <Button type="button" size="sm" variant="ghost" className="self-start shrink-0" onClick={() => { setPath((current) => current.slice(0, -1)); stop.reset() }}>Back to {path.at(-2)?.title}</Button>}
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
                return <Button key={row.sessionId} type="button" variant="ghost" className="h-auto w-full min-w-0 justify-start px-2 py-2 text-xs" onClick={() => { setPath((current) => [...current, row]); stop.reset() }}>
                  {rowIcon(row, label)}<span className="min-w-0 flex-1 truncate text-left">{row.title}</span><span className="shrink-0 text-muted-foreground">{label}</span>
                </Button>
              })}
              {descendants.isError && <p role="alert" className="text-xs text-destructive">Could not load delegated agents. <Button size="xs" variant="outline" onClick={() => void descendants.refetch()}>Retry</Button></p>}
            </section> : null}
          </div>
        )}
        {selected && <div className="flex min-h-[45%] min-w-0 flex-1 flex-col">{renderTranscript(selected)}</div>}
      </DialogContent>
    </Dialog>
  </section>
}
