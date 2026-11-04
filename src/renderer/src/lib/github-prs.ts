/**
 * The PR board's data hook. It lives here rather than in the GitHub view so the
 * Jira board can read the same query without importing a view, which would make
 * the view/lib imports circular. The query key is the shared contract: the main
 * poller pushes `github.prs` events and every consumer sees the same list.
 */
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PullRequest } from '@shared/types'

/** PR board data for one scope: main answers instantly from its polled snapshot
 *  and pushes every background refresh, so no refetch interval is needed here. */
export function useGithubPrs(scope: 'mine' | 'review'): ReturnType<typeof useQuery<PullRequest[]>> {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['gh-prs', scope],
    queryFn: () => window.revva.github.list(scope),
    staleTime: 30_000,
    // GitHub being unavailable is a normal state: a board just shows no PRs.
    retry: false,
    refetchOnWindowFocus: false
  })
  useEffect(() => {
    return window.revva.events.on((e) => {
      if (e.kind === 'github.prs' && e.scope === scope) qc.setQueryData(['gh-prs', scope], e.items)
    })
  }, [qc, scope])
  return q
}
