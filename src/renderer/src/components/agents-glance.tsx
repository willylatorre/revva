import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { childStatusTone, isReviewStopped, reviewRowTone, reviewStatusPills, statusTones, useChildActivity, type StatusTone } from '@/lib/agent-status'
import { useInbox } from '@/views/InboxView'
import { useTranscriptVisibility } from '@/lib/transcript-stream'
import type { ReviewRow, WorkSummary } from '@shared/types'

const roleLabels: Record<string, string> = {
  sol: 'Sol-loop',
  testAudit: 'Test audit',
  impeccable: 'UI review',
  fixer: 'Fixer'
}

/** Compact tone pill; the glance rail is too narrow for full Badges. */
function Pill({ tone, children }: { tone: StatusTone, children: React.ReactNode }): React.JSX.Element {
  return <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums', statusTones[tone].pill)}>{children}</span>
}

/**
 * Quick-glance rail: review cycle progress plus delegated agents and what each
 * is doing right now. It deliberately shows less than the activity panels below
 * the transcript — it exists for the moments when nothing looks like it moves.
 */
export const AgentsGlance = memo(function AgentsGlance({ sessionId, work }: {
  sessionId: string
  work?: WorkSummary
}): React.JSX.Element | null {
  const visible = useTranscriptVisibility()
  const inbox = useInbox()
  const live = useChildActivity(visible)
  const busy = work?.state === 'REVIEW' || work?.state === 'FIXING'
  const children = useQuery({
    queryKey: ['session-children', sessionId],
    queryFn: () => window.revva.session.children(sessionId),
    enabled: visible,
    staleTime: 30_000
  })
  const reviews = useQuery({
    queryKey: ['reviews', work?.id],
    queryFn: () => window.revva.work.reviews(work!.id),
    enabled: visible && !!work,
    refetchInterval: busy ? 5_000 : false
  })
  const runningIds = useQuery({
    queryKey: ['session-activity'],
    queryFn: () => window.revva.session.active(),
    enabled: false
  })

  const rows = children.data ?? []
  const round = (reviews.data ?? []).reduce((latest, row) => Math.max(latest, row.round), 0)
  const currentRound = (reviews.data ?? []).filter((row) => row.round === round)
  const reviewers = [...new Map(currentRound.filter((row) => row.role !== 'fixer').map((row) => [row.role, row])).values()]
  const fixer = currentRound.find((row) => row.role === 'fixer')
  const gates = reviewers.filter((row) => row.status !== 'skipped')
  const approved = gates.filter((row) => row.status === 'approved').length
  const waiting = inbox.filter((item) => rows.some((row) => row.sessionId === item.sessionID) || rows.some((row) => item.branch?.includes(row.sessionId)))

  const showingReview = !!work && (busy || round > 0)
  if (!showingReview && rows.length === 0) return null

  const gateRow = (row: ReviewRow, label: string): React.JSX.Element => {
    const stopped = isReviewStopped(row)
    const tone = reviewRowTone(row)
    return <li key={row.id} className="flex min-w-0 items-center gap-1.5 text-[11px]" title={row.activity ?? undefined}>
      <span className={cn('size-1.5 shrink-0 rounded-full', statusTones[tone].dot)} />
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {row.status === 'running' && <Loader2 className="size-3 shrink-0 motion-safe:animate-spin text-status-info" />}
        {stopped && <CircleAlert className="size-3 shrink-0 text-status-warning" aria-label="Stopped" />}
        <Pill tone={tone}>{stopped ? 'stopped' : reviewStatusPills[row.status]}</Pill>
      </span>
    </li>
  }

  return (
    <section aria-label="Agent progress" className="pointer-events-auto w-[200px] overflow-hidden rounded-lg border bg-background/95 px-2 py-1.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[9px] font-medium tracking-wide text-muted-foreground">AGENTS</span>
        {showingReview && work?.reviewRound && (
          <Pill tone="active" >round {work.reviewRound}/{work.reviewRoundsMax ?? '?'}</Pill>
        )}
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
        <ul className={cn('max-h-44 space-y-1 overflow-y-auto', showingReview && 'mt-1.5 border-t pt-1.5')}>
          {rows.map((row) => {
            const needsYou = inbox.some((item) => item.sessionID === row.sessionId)
            const isRunning = runningIds.data?.includes(row.sessionId) ?? false
            const tone = childStatusTone(needsYou ? 'Needs you' : isRunning ? 'Running' : row.outcome === 'failed' ? 'Failed' : row.outcome === 'interrupted' ? 'Stopped' : row.outcome === 'succeeded' ? 'Finished' : 'Ready')
            const label = needsYou ? 'needs you' : isRunning ? 'running' : row.outcome === 'failed' ? 'failed' : row.outcome === 'interrupted' ? 'stopped' : row.outcome === 'succeeded' ? 'done' : 'ready'
            const note = isRunning ? live.data?.[row.sessionId]?.activity : undefined
            return (
              <li key={row.sessionId} className="min-w-0" title={[row.title, note].filter(Boolean).join(' — ')}>
                <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
                  <span className={cn('size-1.5 shrink-0 rounded-full', statusTones[tone].dot)} />
                  <span className="min-w-0 truncate text-muted-foreground">{row.title}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {isRunning && <Loader2 className="size-3 shrink-0 motion-safe:animate-spin text-status-info" />}
                    <Pill tone={tone}>{label}</Pill>
                  </span>
                </span>
                {note && <span className="mt-0.5 block truncate pl-[12px] text-[10px] text-muted-foreground">{note}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {waiting.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-status-warning">
          <CircleAlert className="size-3 shrink-0" /> {waiting.length} waiting on you
        </p>
      )}
    </section>
  )
})
