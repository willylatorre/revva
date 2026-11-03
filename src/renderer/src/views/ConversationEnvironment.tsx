import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionError } from '@/lib/ask-agent'
import type { WorkSummary } from '@shared/types'
import { ReviewRerunButton } from './ReviewPanel'
import { ShipDialog, shipBlockReason } from './ShipPanel'
import { CommentsStrip } from './CommentsStrip'

/** Revva's own lists are pickers, so "leave this alone" needs an option value of its own. */
const NONE = '__keep__'

/** The same utilities for started runs, Jira links and PR links. */
export function ConversationEnvironment({ work, children }: { work?: WorkSummary; children: ReactNode }): React.JSX.Element {
  const qc = useQueryClient()
  useEffect(() => {
    if (!work?.unread) return
    void window.revva.triage.markRead('work', work.id).then(() => qc.invalidateQueries({ queryKey: ['works'] }))
  }, [qc, work?.id, work?.unread])
  useEffect(() => {
    if (!work) return
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') return
      void qc.invalidateQueries({ queryKey: ['reviews', work.id] })
      void qc.invalidateQueries({ queryKey: ['ship-checks', work.id] })
      void qc.invalidateQueries({ queryKey: ['comments'] })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [qc, work?.id])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {work && <CommentsStrip workId={work.id} />}
      {children}
    </div>
  )
}

export function ConversationActions({ work }: { work: WorkSummary }): React.JSX.Element {
  const [shipOpen, setShipOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const running = work.state === 'REVIEW' || work.state === 'FIXING'
  const reviewBlocker = work.state === 'BUILDING' ? 'Wait for the main implementation run to finish before starting review.'
    : work.state === 'REWORK' ? 'Wait for rework to finish before starting review.'
    : running ? 'Stop the current review before starting another round.'
    : work.state === 'SHIPPED' ? 'Send a follow-up to begin a new change before reviewing shipped work.'
    : work.state === 'ABANDONED' ? 'This work was abandoned.'
    : undefined
  const shippingBlocker = shipBlockReason(work)
  return <>
    {/* The reviewer cards and the Agents panel already show progress and hold
        their own retry/stop controls, so the old Workflow popover only repeated
        them. What stays are the two entry points nothing else has: a manual
        full review cycle and shipping. */}
    {!work.prUrl && (reviewBlocker ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0"><ReviewRerunButton workId={work.id} disabled /></span>
        </TooltipTrigger>
        <TooltipContent>{reviewBlocker}</TooltipContent>
      </Tooltip>
    ) : (
      <ReviewRerunButton workId={work.id} />
    ))}
    {!work.prUrl && (shippingBlocker ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0"><Button size="sm" variant="outline" disabled ref={trigger}>{work.state === 'APPROVED' ? 'Ship…' : 'Push / PR…'}</Button></span>
        </TooltipTrigger>
        <TooltipContent>{shippingBlocker}</TooltipContent>
      </Tooltip>
    ) : (
      <Button size="sm" variant="outline" className="shrink-0" ref={trigger} onClick={() => setShipOpen(true)}>
        {work.state === 'APPROVED' ? 'Ship…' : 'Push / PR…'}
      </Button>
    ))}
    {work.blocker && (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0 cursor-default items-center text-status-warning"><CircleAlert className="size-4" /></span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-[11px]">{work.blocker}</TooltipContent>
      </Tooltip>
    )}
    <ShipDialog work={work} open={shipOpen} onClose={() => { setShipOpen(false); trigger.current?.focus() }} />
  </>
}

/** Secondary metadata lives here instead of competing with the conversation title. */
export function ConversationDetails({ sessionId, directory, work, children }: {
  sessionId: string; directory?: string; work?: WorkSummary; children: ReactNode
}): React.JSX.Element {
  const qc = useQueryClient()
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [worktree, setWorktree] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const model = useQuery({ queryKey: ['session-model', sessionId], queryFn: () => window.revva.session.model(sessionId), enabled: open })
  const models = useQuery({ queryKey: ['models'], queryFn: () => window.revva.inventory.models(), enabled: open })
  const modelName = model.data ? models.data?.find((item) => item.providerID === model.data?.providerID && item.id === model.data?.id)?.name || model.data.id : model.isError ? 'Unavailable' : model.isPending ? 'Loading…' : 'Service default'
  // Revva's own list, main checkouts included: a conversation may work in one. Cleanup
  // asks without them so that dialog can never offer the repository itself.
  const worktrees = useQuery({
    queryKey: ['worktrees', 'conversations'],
    queryFn: () => window.revva.worktrees.list({ includeMainCheckouts: true }),
    enabled: open
  })
  const here = work?.worktreeDir ?? directory ?? ''
  const picked = worktree ?? (here || null)
  // Opening these details re-reads git once against the conversation's live session —
  // for every attached run, not just the ones that anchored before their folder became
  // a checkout (the blank-branch case) — so the readouts and the pickers below always
  // tell the truth, even when the session moved while Revva was closed. Terminal rows
  // are excluded: main answers those with its own refusal or a no-op, never a re-read.
  const revalidatable = !!work && work.state !== 'SHIPPED' && work.state !== 'ABANDONED'
  const reanchor = useQuery({
    queryKey: ['conversation-context', sessionId, 'heal'],
    queryFn: async () => {
      const healed = await window.revva.work.conversationContext(sessionId)
      await qc.invalidateQueries({ queryKey: ['works'] })
      return healed
    },
    enabled: open && revalidatable,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false
  })
  // Only the case still worth a line gets one: a branch that has not resolved yet,
  // or a re-read that failed. Verification that changed nothing stays invisible.
  const anchorNote = !work || !revalidatable || work.branch
    ? null
    : reanchor.isError
      ? `Revva could not re-read this checkout: ${reanchor.error instanceof Error ? reanchor.error.message : String(reanchor.error)}`
      : 'Revva is re-reading this checkout…'
  const branches = useQuery({
    queryKey: ['worktree-branches', picked],
    queryFn: () => window.revva.worktrees.branches({ directory: picked ?? here }),
    enabled: open && !!picked
  })
  const repoRoot = branches.data?.repoDir
  const shown = (worktrees.data ?? []).filter((wt) => !repoRoot || wt.repoDir === repoRoot)
  const listed = shown.some((wt) => wt.directory === picked)
  // States where main refuses a move already (setCheckout guards): instead of two dead
  // disabled pickers plus insurance prose, one line says why and what unlocks it.
  // (ABANDONED is not locked: moving such a session simply anchors a fresh run.)
  const locked = work?.state === 'SHIPPED' ? 'This run shipped — it keeps the checkout it shipped from.'
    : work?.state === 'BUILDING' ? 'The conversation is implementing — stop the response before moving it.'
    : work?.state === 'REVIEW' || work?.state === 'FIXING' ? 'Review is running — stop it before moving this conversation.'
    : null
  const chooseWorktree = (value: string): void => {
    setWorktree(value === NONE ? null : value)
    setBranch(null)
    setError(null)
    setNote(null)
  }
  const apply = async (input: { directory?: string; branch?: string }): Promise<void> => {
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      const result = await window.revva.work.setCheckout(sessionId, input)
      setNote(result.note)
      setWorktree(null)
      setBranch(null)
      // The folder moved with the session, so anything anchored on it is stale.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['chats'] }),
        qc.invalidateQueries({ queryKey: ['works'] }),
        qc.invalidateQueries({ queryKey: ['worktrees'] }),
        qc.invalidateQueries({ queryKey: ['worktree-branches'] }),
        qc.invalidateQueries({ queryKey: ['conversation-context', sessionId] })
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button size="sm" variant="ghost" className="shrink-0" />}>
      <Info data-icon="inline-start" /><span className="hidden sm:inline">Details</span><span className="sr-only sm:hidden">Conversation details</span>
    </PopoverTrigger>
    <PopoverContent ref={popup} initialFocus={popup} align="end" className="max-h-[75vh] w-96 max-w-[calc(100vw-2rem)] gap-4 overflow-y-auto p-4">
      <PopoverTitle>Conversation details</PopoverTitle>
      <dl className="flex flex-col gap-3 text-sm">
        <div><dt className="text-muted-foreground">Model</dt><dd className="break-words">{modelName}{model.data?.variant ? ` · ${model.data.variant}` : ''}</dd></div>
        {work && <div><dt className="text-muted-foreground">Branch</dt><dd className="break-all">{work.branch || reanchor.data?.branch || 'Not selected'}</dd></div>}
        <div><dt className="text-muted-foreground">{work ? 'Review folder' : 'Folder'}</dt><dd className="break-all font-mono text-xs">{here || 'Unavailable'}</dd></div>
        <div><dt className="text-muted-foreground">Session</dt><dd>{children}</dd></div>
      </dl>
      <Separator />
      <div className="flex flex-col gap-3">
        <PopoverHeader className="gap-1">
          <PopoverTitle className="text-sm">Where this conversation works</PopoverTitle>
          <PopoverDescription>Move the conversation to one of Revva’s worktrees, or switch its branch. Nothing is created, renamed or deleted.</PopoverDescription>
        </PopoverHeader>
        {locked ? (
          <p className="text-xs text-muted-foreground">{locked}</p>
        ) : <>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor={`${sessionId}-worktree`}>Worktree</label>
          <select
            id={`${sessionId}-worktree`}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            value={picked ?? NONE}
            disabled={saving || (worktrees.isPending && !worktrees.data)}
            onChange={(event) => chooseWorktree(event.target.value)}
          >
            {!picked && <option value={NONE}>Loading…</option>}
            {picked && !listed && <option value={picked}>{here} — current</option>}
            {shown.map((wt) => (
              <option key={`${wt.repoDir}\u0000${wt.directory}`} value={wt.directory}>
                {wt.directory.split(/[\\/]/).filter(Boolean).pop() || wt.directory}
                {wt.branch ? ` — ${wt.branch}` : wt.detached ? ' — detached HEAD' : ''}
                {wt.directory === here ? ' · current' : wt.mainCheckout ? ' · main checkout' : wt.ticketKey ? ` · ${wt.ticketKey}` : ''}
              </option>
            ))}
          </select>
          {/* The folder is already the readout above; only what the select cannot say —
              this checkout is the repository itself, or git could not be read — earns a line. */}
          {branches.isError && <p className="text-xs text-muted-foreground">{branches.error instanceof Error ? branches.error.message : String(branches.error)}</p>}
          {branches.data?.mainCheckout && <p className="text-xs text-muted-foreground">The main checkout of this repository</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor={`${sessionId}-branch`}>Branch</label>
          {work?.prUrl ? (
            <p className="text-xs text-muted-foreground">This run is linked to a PR, so it stays on the PR’s branch. Pick its worktree, or start another conversation for a different branch.</p>
          ) : <select
            id={`${sessionId}-branch`}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            value={branch ?? NONE}
            disabled={saving || !branches.data}
            onChange={(event) => { setBranch(event.target.value === NONE ? null : event.target.value); setNote(null) }}
          >
            <option value={NONE}>{branches.data ? `Stay on ${branches.data.current || 'the current checkout'}` : branches.isError ? 'Git could not read this checkout' : 'Loading…'}</option>
            {(branches.data?.branches ?? []).map((item) => (
              <option key={`${item.remote ?? ''}\u0000${item.name}`} value={item.name} disabled={!!item.remotes || (!item.current && !!item.checkedOutIn)}>
                {item.name}
                {item.current ? ' · current' : item.checkedOutIn ? ` · checked out in ${item.checkedOutIn}` : item.remotes ? ` · on ${item.remotes.join(' and ')} — Revva will not guess` : item.remoteOnly ? ` · ${item.remote ?? 'remote'} only, starts a local branch` : ''}
              </option>
            ))}
          </select>}
        </div>
        </>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={saving || !!locked || (!worktree && !branch)} onClick={() => void apply({ directory: worktree ?? undefined, branch: branch ?? undefined })}>
            {saving && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {saving ? 'Working…' : 'Apply'}
          </Button>
          {branch && !locked && <span className="text-xs text-muted-foreground">Uncommitted changes are refused before git runs.</span>}
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {anchorNote && <p className="text-xs text-muted-foreground">{anchorNote}</p>}
        {error && <ActionError action="move this conversation" error={error} className="text-sm" onSent={() => setOpen(false)} />}
      </div>
    </PopoverContent>
  </Popover>
}
