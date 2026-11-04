/**
 * Cross-links between the two boards. A PR names its Jira ticket in its title or
 * branch, so the PR board can show the ticket's live status; the Jira board can
 * show the PR waiting on each ticket. Both sides read data the pollers already
 * keep hot, so neither adds a new fetch per card.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGithubPrs } from '@/lib/github-prs'
import type { LinkedTicket, PullRequest } from '@shared/types'

/** Status of the tickets named by the visible PRs, keyed by ticket key. */
export function useLinkedTickets(keys: string[]): Map<string, LinkedTicket> {
  // The key list is rebuilt every render; query on its stable content instead.
  const signature = [...new Set(keys.filter(Boolean))].sort().join(',')
  const q = useQuery({
    queryKey: ['ticket-briefs', signature],
    queryFn: () => window.revva.jira.tickets(signature.split(',')),
    enabled: signature.length > 0,
    staleTime: 60_000
  })
  return useMemo(() => new Map((q.data ?? []).map((t) => [t.key, t])), [q.data])
}

/** PRs per ticket key, from both GitHub scopes the pollers keep warm. */
export function usePrsByTicket(): Map<string, PullRequest[]> {
  const mine = useGithubPrs('mine')
  const review = useGithubPrs('review')
  return useMemo(() => {
    const byKey = new Map<string, PullRequest[]>()
    for (const pr of [...(mine.data ?? []), ...(review.data ?? [])]) {
      if (!pr.ticketKey) continue
      const list = byKey.get(pr.ticketKey) ?? []
      if (!list.some((p) => p.url === pr.url)) list.push(pr)
      byKey.set(pr.ticketKey, list)
    }
    return byKey
  }, [mine.data, review.data])
}

/**
 * How a PR reads on a ticket card. Merged is final; otherwise the reviewer's
 * current stance and a merge conflict matter more than "open", because those are
 * the states that need a person to act.
 */
const PR_STATE_LABEL: Record<string, { label: string; cls: string }> = {
  open: { label: 'open', cls: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  draft: { label: 'draft', cls: 'border-slate-500/40 text-muted-foreground' },
  merged: { label: 'merged', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  shipped: { label: 'shipped', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  linked: { label: 'PR', cls: 'border-slate-500/40 text-muted-foreground' },
  closed: { label: 'closed', cls: 'border-red-500/40 text-red-600 dark:text-red-400' },
  conflicts: { label: 'conflicts', cls: 'border-red-500/40 text-red-600 dark:text-red-400' },
  changes: { label: 'changes', cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400' },
  approved: { label: 'approved', cls: 'border-green-500/40 text-green-700 dark:text-green-400' }
}

export function prStateLabel(pr: PullRequest): { label: string; cls: string } {
  if (pr.merged) return PR_STATE_LABEL.merged!
  if (pr.state.toLowerCase() === 'closed') return PR_STATE_LABEL.closed!
  if (pr.mergeable === 'CONFLICTING') return PR_STATE_LABEL.conflicts!
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return PR_STATE_LABEL.changes!
  if (pr.reviewDecision === 'APPROVED') return PR_STATE_LABEL.approved!
  if (pr.isDraft) return PR_STATE_LABEL.draft!
  return PR_STATE_LABEL[pr.state.toLowerCase()] ?? { label: pr.state.toLowerCase(), cls: 'border-slate-500/40 text-muted-foreground' }
}

/**
 * Ticket-keyed PRs for the Jira board: the open PRs above, plus a PR a Revva
 * conversation shipped earlier. Merged PRs leave the open list, so without the
 * work row a merge would look like "no PR" on the ticket card.
 */
export function useLinkedPrs(works: Array<{ ticketKey: string; prUrl?: string; updatedAt: number; state: string }>): Map<string, PullRequest[]> {
  const hot = usePrsByTicket()
  // Only rows carrying both a ticket and a PR matter; the signature keeps the
  // memo stable across unrelated work-row updates.
  const signature = works
    .filter((w) => w.ticketKey && w.prUrl && w.state !== 'ABANDONED')
    .map((w) => `${w.ticketKey}|${w.prUrl}|${w.state}|${w.updatedAt}`)
    .join('\n')
  return useMemo(() => {
    const byKey = new Map<string, PullRequest[]>()
    for (const [key, prs] of hot) byKey.set(key, [...prs])
    for (const work of works) {
      // An abandoned run keeps its row; its PR is no longer this ticket's work.
      if (!work.ticketKey || !work.prUrl || work.state === 'ABANDONED') continue
      const list = byKey.get(work.ticketKey) ?? []
      if (list.some((p) => p.url === work.prUrl)) continue
      const ref = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(work.prUrl)
      list.push({
        repo: ref?.[1] ?? 'unknown',
        number: ref ? Number(ref[2]) : 0,
        title: '',
        url: work.prUrl,
        // Only Revva's own pipeline knows this PR; the open list did not carry it.
        state: work.state === 'SHIPPED' ? 'shipped' : 'linked',
        isDraft: false,
        updatedAt: work.updatedAt,
        ticketKey: work.ticketKey
      })
      byKey.set(work.ticketKey, list)
    }
    return byKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hot, signature])
}
