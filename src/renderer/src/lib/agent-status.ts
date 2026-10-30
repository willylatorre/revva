import { useQuery } from '@tanstack/react-query'
import type { AgentActivity, AgentSession, ReviewStatus } from '@shared/types'

/** One status palette: cards, rows and pills must match across surfaces. */
export type StatusTone = 'neutral' | 'active' | 'approved' | 'attention' | 'error'

export const statusTones: Record<StatusTone, { text: string; pill: string; dot: string }> = {
  neutral: { text: 'text-muted-foreground', pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/40' },
  active: { text: 'text-status-info', pill: 'bg-status-info/10 text-status-info', dot: 'bg-status-info' },
  approved: { text: 'text-status-success', pill: 'bg-status-success/10 text-status-success', dot: 'bg-status-success' },
  attention: { text: 'text-status-warning', pill: 'bg-status-warning/10 text-status-warning', dot: 'bg-status-warning' },
  error: { text: 'text-status-error', pill: 'bg-status-error/10 text-status-error', dot: 'bg-status-error' }
}

/**
 * Live activity lines for delegated children, keyed by session. Push events
 * maintain the same map shape, so opening a conversation only needs one fetch.
 */
export function useChildActivity(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-activity'],
    queryFn: async () => {
      const rows = await window.revva.session.agentActivity()
      return Object.fromEntries(rows.filter((row) => row.activity).map((row) => [row.sessionId, row])) as Record<string, AgentActivity>
    },
    enabled,
    staleTime: 60_000
  })
}

export type ChildStatusLabel = 'Needs you' | 'Running' | 'Failed' | 'Stopped' | 'Finished' | 'Ready'

/** One status vocabulary for every surface that lists delegated agents. */
export function childStatusLabel(row: AgentSession, state: { needsYou: boolean; running: boolean }): ChildStatusLabel {
  if (state.needsYou) return 'Needs you'
  if (state.running) return 'Running'
  if (row.outcome === 'failed') return 'Failed'
  if (row.outcome === 'interrupted') return 'Stopped'
  if (row.outcome === 'succeeded') return 'Finished'
  return 'Ready'
}

/** Seconds since a timestamp, as the compact duration the agent panels use. */
export function durationSince(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

const childTones: Record<ChildStatusLabel, StatusTone> = {
  'Needs you': 'attention',
  Running: 'active',
  Failed: 'error',
  Stopped: 'neutral',
  Finished: 'approved',
  Ready: 'neutral'
}

export function childStatusTone(label: ChildStatusLabel): StatusTone {
  return childTones[label]
}

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: 'Queued',
  running: 'Reviewing',
  approved: 'Approved',
  changes: 'Changes',
  error: 'Needs attention',
  skipped: 'Not needed'
}

/** Compact pill text for the glance rail; cards keep the longer labels. */
export const reviewStatusPills: Record<ReviewStatus, string> = {
  pending: 'queued',
  running: 'running',
  approved: 'approved',
  changes: 'changes',
  error: 'error',
  skipped: 'skipped'
}

export function reviewStatusTone(status: ReviewStatus): StatusTone {
  return status === 'approved' ? 'approved'
    : status === 'changes' ? 'attention'
      : status === 'error' ? 'error'
        : status === 'running' ? 'active' : 'neutral'
}

/** A deliberate stop is not a provider failure, even though it blocks approval. */
export function isReviewStopped(row: { status: ReviewStatus; error?: string }): boolean {
  return row.status === 'error' && /stopped by you|was interrupted|^cancelled$/i.test(row.error ?? '')
}

/** Stopped runs read as "attention", not as a red provider failure. */
export function reviewRowTone(row: { status: ReviewStatus; error?: string }): StatusTone {
  return isReviewStopped(row) ? 'attention' : reviewStatusTone(row.status)
}
