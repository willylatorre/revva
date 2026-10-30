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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const children = useQuery({
    queryKey: ['session-children', sessionId],
    queryFn: () => window.revva.session.children(sessionId),
    enabled: visible,
    staleTime: 30_000
  })
  const activity = useQuery({ queryKey: ['session-activity'], queryFn: () => window.revva.session.active(), enabled: false })
  const inbox = useInbox()
  useEffect(() => window.revva.events.on((event) => {
    if ((event.kind === 'session.children' && (event.sessionId === sessionId || event.sessionId === '*')) || (event.kind === 'chat.idle' && event.sessionId === '*')) {
      void qc.invalidateQueries({ queryKey: ['session-children', sessionId] })
    }
  }), [qc, sessionId])
  const stop = useMutation({
    mutationFn: (id: string) => window.revva.chat.interrupt(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['session-activity'] })
      void qc.invalidateQueries({ queryKey: ['session-children', sessionId] })
    }
  })
  const rows = children.data ?? []
  const selected = rows.find((row) => row.sessionId === selectedId)
  const waiting = inbox.filter((item) => rows.some((row) => row.sessionId === item.sessionID))
  const status = (row: AgentSession): string => inbox.some((item) => item.sessionID === row.sessionId) ? 'Needs you'
    : activity.data?.includes(row.sessionId) ? 'Running'
      : row.outcome === 'failed' ? 'Failed' : row.outcome === 'interrupted' ? 'Stopped' : row.outcome === 'succeeded' ? 'Finished' : 'Ready'

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
            return <Button key={row.sessionId} type="button" variant="ghost" className="h-auto min-w-0 justify-start px-2 py-2 text-xs" aria-label={`${row.title}: ${label}. Open agent output`} onClick={(event) => {
              trigger.current = event.currentTarget
              setSelectedId(row.sessionId)
            }}>
              {label === 'Running' ? <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" /> : label === 'Needs you' || label === 'Failed' ? <CircleAlert className="size-3.5 shrink-0 text-status-warning" /> : <Bot className="size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate text-left" title={row.title}>{row.title}</span>
              {row.agentID && <span className="max-w-32 truncate text-muted-foreground">{row.agentID}</span>}
              <span className="shrink-0 text-muted-foreground">{label}</span>
            </Button>
          })}
        </div>
        {children.isError && <p role="alert" className="py-1 text-xs text-destructive">Could not load agents. <Button size="xs" variant="outline" onClick={() => void children.refetch()}>Retry</Button></p>}
      </CollapsibleContent>
    </Collapsible>
    <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) { setSelectedId(null); stop.reset() } }}>
      <DialogContent className="flex h-[85vh] max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader>
          <DialogTitle>{selected?.title ?? 'Agent output'}</DialogTitle>
          <DialogDescription>{selected ? `${status(selected)}${selected.agentID ? ` · ${selected.agentID}` : ''}. Send follow-ups through the coordinator.` : 'This child session is no longer available.'}</DialogDescription>
        </DialogHeader>
        {selected && activity.data?.includes(selected.sessionId) && <Button type="button" size="sm" variant="outline" className="self-start" disabled={stop.isPending} onClick={() => stop.mutate(selected.sessionId)}>{stop.isPending ? 'Stopping…' : 'Stop agent'}</Button>}
        {stop.error && <p role="alert" className="text-xs text-destructive">{stop.error.message}</p>}
        {selected && <div className="max-h-[25vh] shrink-0 overflow-y-auto">
          {inbox.filter((item) => item.sessionID === selected.sessionId).map((item) => item.kind === 'form' ? <FormCard key={item.id} item={item} /> : <PermissionCard key={item.id} item={item} />)}
        </div>}
        {selected && renderTranscript(selected)}
      </DialogContent>
    </Dialog>
  </section>
}
