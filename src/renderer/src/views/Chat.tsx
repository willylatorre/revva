import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Check, ChevronDown, CircleAlert, Copy, Cpu, ExternalLink, FileWarning, FolderGit2, FolderOpen, GitBranch, ImageIcon, Loader2, Mic, Square, SquareTerminal, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ActionError, AskAgentProvider } from '@/lib/ask-agent'
import { beginTranscriptSnapshot, displayTranscript, finishTranscriptSnapshot, mergeHistory, transcriptReady, useTranscriptVisibility } from '@/lib/transcript-stream'
import { transcriptRequest } from '@/lib/transcript-requests'
import { SessionStats } from '@/components/session-stats'
import { AgentsPanel } from '@/components/agents-panel'
import { TranscriptActivityStrip, TranscriptContent, createTranscriptActivityStore } from '@/components/transcript-content'
import { Choice } from './NewChatDialog'
import type { AgentInfo, ChatMessage, DictationApp, FileHit, ModelRef, PromptImage, PromptRefs, QueuedMessage, SkillInfo, WorkSummary, TranscriptPage } from '@shared/types'
import { FormCard, PermissionCard, useInbox } from './InboxView'
import { PrConversationActions } from './PrConversationActions'
import { ConversationEnvironment, ConversationActions, ConversationDetails } from './ConversationEnvironment'
import { WorkAgentActivity } from './WorkAgentActivity'
import { WorkFollowUpQueue } from './WorkFollowUpQueue'
import { ChatReviewButton } from './ChatReviewButton'
import { OpenCodeConsole } from './OpenCodeConsole'

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
const MAX_IMAGES = 8
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function ChatRepoStatus({ sessionId, directory }: { sessionId: string; directory: string }): React.JSX.Element {
  const status = useQuery({
    queryKey: ['chat-repo-status', sessionId],
    queryFn: () => window.revva.chat.repoStatus(sessionId),
    refetchInterval: () => document.visibilityState === 'visible' ? 10_000 : false
  })
  const openVSCode = useMutation({ mutationFn: () => window.revva.chat.openVSCode(sessionId) })
  const repo = status.data?.repoName ?? (status.isPending ? 'Checking repo…' : status.isError ? 'Git status unavailable' : 'No Git repo')
  const branch = status.data?.repoDir ? status.data.branch ?? 'Detached HEAD' : null
  const fileCount = status.data?.changedFiles
  const workingDirectory = status.data?.directory ?? directory
  const folderParts = workingDirectory.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  const folderLabel = folderParts.slice(-2).join('/') || workingDirectory

  return <>
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1 rounded-md border px-2 py-1" title={status.data?.repoDir ?? undefined}>
        {status.isPending ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <FolderGit2 className="size-3.5 shrink-0" />}
        <span className="truncate">{repo}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1 rounded-md border px-2 py-1" title={`Working folder: ${workingDirectory}`}>
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="max-w-36 truncate">{folderLabel}</span>
      </span>
      {branch && <span className="flex min-w-0 items-center gap-1 rounded-md border px-2 py-1" title={branch}>
        <GitBranch className="size-3.5 shrink-0" /><span className="hidden max-w-36 truncate sm:inline">{branch}</span>
      </span>}
      {fileCount !== null && fileCount !== undefined && status.data?.repoDir && <span className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1" title={`${fileCount} changed files`}>
        <FileWarning className="size-3.5" /><span className="hidden sm:inline">{fileCount === 0 ? 'Clean' : `${fileCount} changed`}</span><span className="sm:hidden">{fileCount}</span>
      </span>}
    </div>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={openVSCode.isPending} onClick={() => openVSCode.mutate()}>
          {openVSCode.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : openVSCode.isError ? <CircleAlert data-icon="inline-start" /> : <ExternalLink data-icon="inline-start" />}
          <span className="hidden md:inline">{openVSCode.isError ? 'Open failed' : 'VS Code'}</span>
          <span className="sr-only md:hidden">Open folder in VS Code</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{openVSCode.isError
        ? `Could not open in VS Code: ${openVSCode.error instanceof Error ? openVSCode.error.message : String(openVSCode.error)}`
        : `Open ${status.data?.directory ?? 'this chat folder'} in VS Code`}</TooltipContent>
    </Tooltip>
  </>
}

/* ---------- composer dictation hint (Hex / Wispr Flow) ---------- */

const DICTATION_LABELS: Record<DictationApp, string> = { hex: 'Hex', 'wispr-flow': 'Wispr Flow' }

/**
 * Mic chip shown only when a global dictation app (Hex, Wispr Flow) is installed.
 * Those apps are triggered by the user's own global shortcut and paste/type into
 * the focused field, so the chip must not pretend to record: it opens a popover
 * that explains the flow, focuses the composer (so words land here), and offers
 * "Auto-send after paste" — a dictated message arrives as a text paste into an
 * empty box, which is exactly the signal to send it without the extra Cmd+Enter.
 */
function DictationHint({ container }: {
  container: React.RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const apps = useQuery({
    queryKey: ['dictation-apps'],
    queryFn: () => window.revva.dictation.detect(),
    staleTime: 5 * 60_000
  })
  const autoSend = useQuery({
    queryKey: ['settings', 'composer.autoSendPaste'],
    queryFn: () => window.revva.settings.get('composer.autoSendPaste')
  })
  const enabled = autoSend.data === true
  const setAutoSend = (next: boolean): void => {
    qc.setQueryData(['settings', 'composer.autoSendPaste'], next)
    void window.revva.settings.set('composer.autoSendPaste', next).then(() => {
      void qc.invalidateQueries({ queryKey: ['settings', 'composer.autoSendPaste'] })
    })
  }
  const names = (apps.data ?? []).map((app) => DICTATION_LABELS[app])
  if (names.length === 0) return null
  const label = names.join(' or ')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" size="icon-sm" variant="ghost" className={cn('text-muted-foreground', enabled && 'text-foreground')} aria-label={`${label} can dictate into this message box`} aria-pressed={enabled} />}
      >
        <Mic />
      </PopoverTrigger>
      <PopoverContent container={container} side="top" align="start" className="w-72 gap-2">
        <PopoverTitle>Dictate your message</PopoverTitle>
        <p className="text-xs text-muted-foreground">
          Click this box, hold your {label} shortcut, speak — the words paste straight in.
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-3 border-t pt-2 text-xs">
          <span>
            <span className="font-medium">Auto-send after paste</span>
            <span className="mt-0.5 block text-muted-foreground">Sends when a text paste lands in an empty box — your dictated message. Pasting into a draft never sends.</span>
          </span>
          <Switch size="sm" checked={enabled} onCheckedChange={setAutoSend} aria-label="Auto-send after paste" />
        </label>
      </PopoverContent>
    </Popover>
  )
}

/* ---------- composer tokens: /skill, @file and #agent ---------- */

/** Which token the caret sits in right now (drives the autocomplete menu). */
interface ActiveToken {
  kind: 'skill' | 'file' | 'agent'
  query: string
  /** Index of the sigil in the input value. */
  start: number
}
function activeToken(value: string, caret: number): ActiveToken | null {
  const before = value.slice(0, caret)
  const agent = before.match(/(?:^|\s)#([\w./-]*)$/)
  if (agent) {
    const query = agent[1] ?? ''
    return { kind: 'agent', query, start: caret - query.length - 1 }
  }
  const skill = before.match(/(?:^|\s)\/([\w.:-]*)$/)
  if (skill) {
    const query = skill[1] ?? ''
    return { kind: 'skill', query, start: caret - query.length - 1 }
  }
  const file = before.match(/(?:^|\s)@([\w.~/+-]*)$/)
  if (file) {
    const query = file[1] ?? ''
    return { kind: 'file', query, start: caret - query.length - 1 }
  }
  return null
}

/** Tokenize the final text into OpenCode prompt refs (offsets are UTF-16 indices into text). */
function extractRefs(text: string, skills: SkillInfo[], agents: AgentInfo[] = []): PromptRefs {
  const byToken = new Map<string, SkillInfo>()
  for (const s of skills) {
    byToken.set(s.id.toLowerCase(), s)
    if (s.name) byToken.set(s.name.toLowerCase().replace(/\s+/g, '-'), s)
  }
  const refs: PromptRefs = { skills: [], files: [] }
  const byAgent = new Map(agents.map((agent) => [agent.id.toLowerCase(), agent]))
  for (const match of text.matchAll(/(?:^|\s)(#[\w./-]+)/g)) {
    const token = match[1] ?? ''
    const agent = byAgent.get(token.slice(1).toLowerCase())
    if (!agent || (refs.agents?.length ?? 0) >= 8) continue
    const start = (match.index ?? 0) + match[0].lastIndexOf(token)
    refs.agents ??= []
    refs.agents.push({ id: agent.id, start, end: start + token.length, text: token })
  }
  for (const m of text.matchAll(/(?:^|\s)(\/[\w.:-]+)/g)) {
    const token = m[1] ?? ''
    const s = byToken.get(token.slice(1).toLowerCase())
    if (!s || refs.skills.length >= 8) continue
    const start = (m.index ?? 0) + m[0].lastIndexOf(token)
    refs.skills.push({ id: s.id, name: s.name ?? s.id, start, end: start + token.length, text: token })
  }
  for (const m of text.matchAll(/(?:^|\s)(@[\w.~/+-]+)/g)) {
    // '@foo' with no path separator is chat-speak, not a file; also cap per schema.
    const token = m[1] ?? ''
    if (!token.includes('/') && !token.includes('.')) continue
    if (refs.files.length >= 12) continue
    const start = (m.index ?? 0) + m[0].lastIndexOf(token)
    refs.files.push({ path: token.slice(1), start, end: start + token.length, text: token })
  }
  return refs
}

/** Read image File objects into base64 payloads the main process can forward to OpenCode. */
async function filesToImages(files: File[]): Promise<PromptImage[]> {
  const allowed = IMAGE_ACCEPT.split(',') as PromptImage['mime'][]
  const out: PromptImage[] = []
  for (const file of files) {
    const mime = allowed.find((m) => m === file.type)
    if (!mime) continue
    if (file.size > MAX_IMAGE_BYTES) continue
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    out.push({ name: file.name || undefined, mime, data: btoa(binary) })
  }
  return out
}

/** Everything a transcript surface needs, so chats and ticket cockpit share one view. */
export interface TranscriptDrive {
  /** Shared transcript cache prefix: simultaneous surfaces coalesce HTTP work. */
  queryKey: readonly unknown[]
  load(sessionId: string, since?: string, requestId?: string): Promise<TranscriptPage>
  /** `queued` = session is busy; park the message in the inbox behind the running turn. */
  send(sessionId: string, text: string, images?: PromptImage[], queued?: boolean, refs?: PromptRefs, sentAt?: number): Promise<void | 'queued'>
  interrupt(sessionId: string): Promise<void>
}

export function SessionIdButton({ sessionId }: { sessionId: string }): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (status === 'idle') return
    const timer = window.setTimeout(() => setStatus('idle'), 3000)
    return () => window.clearTimeout(timer)
  }, [status])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="min-w-0 max-w-40 text-muted-foreground"
          aria-label={`Copy session ID ${sessionId}`}
          onClick={() => {
            void window.revva.session.copyId(sessionId).then(() => setStatus('copied'), () => setStatus('error'))
          }}
        >
          {status === 'copied' ? <Check /> : <Copy />}
          <span className="truncate font-mono">{status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : sessionId}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{status === 'error' ? 'Could not copy session ID. Try again.' : `Copy session ID: ${sessionId}`}</TooltipContent>
      <span role="status" className="sr-only">{status === 'copied' ? 'Session ID copied' : status === 'error' ? 'Could not copy session ID' : ''}</span>
    </Tooltip>
  )
}

export function TranscriptView({
  sessionId,
  drive,
  header,
  emptyHint,
  readOnly,
  onNewSession,
  hideSessionDetails,
  hideChildAgents,
  work,
  body
}: {
  sessionId: string
  drive: TranscriptDrive
  header: ReactNode
  emptyHint: string
  /** Hides the composer (reviewer sessions are read-only). */
  readOnly?: boolean
  /** When set, sending exactly `/new` calls this instead. */
  onNewSession?: () => void
  /** Session details are shown elsewhere for ticket transcripts. */
  hideSessionDetails?: boolean
  /** Prevent nested child-output inspectors from recursively mounting themselves. */
  hideChildAgents?: boolean
  work?: WorkSummary
  /** Replaces the transcript + composer body, keeping this view's header bar. */
  body?: ReactNode
}): React.JSX.Element {
  const qc = useQueryClient()
  const pending = useInbox().filter((item) => item.sessionID === sessionId)
  const [sendingSession, setSendingSession] = useState<string | null>(null)
  const activity = useQuery({
    queryKey: ['session-activity'],
    queryFn: () => window.revva.session.active(),
    refetchOnMount: 'always',
    refetchInterval: (q) => q.state.status === 'error' ? 5000 : q.state.data?.length ? 10_000 : 60_000
  })
  const running = sendingSession === sessionId || (activity.data?.includes(sessionId) ?? false)
  const reviewing = work?.state === 'REVIEW' || work?.state === 'FIXING'
  /** Off until the user turns it on in the composer's dictation popover. */
  const autoSendPaste = useQuery({
    queryKey: ['settings', 'composer.autoSendPaste'],
    queryFn: () => window.revva.settings.get('composer.autoSendPaste')
  }).data === true
  const visible = useTranscriptVisibility()
  const [attachment, setAttachment] = useState<{ sessionId: string; ready: Promise<void> } | null>(null)
  useEffect(() => {
    const display = displayTranscript(qc, sessionId)
    setAttachment({ sessionId, ready: display.ready })
    return display.release
  }, [qc, sessionId])
  const messages = useQuery({
    queryKey: [...drive.queryKey, sessionId],
    queryFn: async ({ signal }) => {
      // Rapid A → B → A can leave React holding A's old attachment promise.
      // Await the current subscription, not a released surface's acknowledgement.
      await transcriptReady(sessionId)
      if (signal.aborted) throw signal.reason
      const old = qc.getQueryData<ChatMessage[]>([...drive.queryKey, sessionId]) ?? []
      const resetKey = ['transcript-reset', sessionId] as const
      const generation = qc.getQueryData<number>(resetKey) ?? 0
      // Keep unresolved earlier tools inside the overlap window as well as the
      // last persisted step. Optimistic ids aren't valid server cursors.
      const anchor = old.find((row) => row.tools?.some((tool) => tool.state === 'running' || tool.state === 'streaming'))
        ?? old.findLast((row) => !row.id.startsWith('pending-'))
      const authoritative = beginTranscriptSnapshot(sessionId)
      const page = await transcriptRequest(signal, (requestId) => drive.load(sessionId, generation || authoritative ? undefined : anchor?.id, requestId))
      if (signal.aborted) throw signal.reason
      if ((qc.getQueryData<number>(resetKey) ?? 0) !== generation) throw new Error('Transcript changed during snapshot; retrying.')
      const history = page.reset ? page.messages : mergeHistory(old, page.messages)
      if (!finishTranscriptSnapshot(qc, sessionId, history, page.missingPrefixes)) {
        qc.setQueryData<number>(resetKey, (old = 0) => old + 1)
        throw new Error('Transcript stream gap; retrying snapshot.')
      }
      if (generation && qc.getQueryData<number>(resetKey) === generation) qc.setQueryData(resetKey, 0)
      return history
    },
    enabled: visible && attachment?.sessionId === sessionId,
    refetchOnMount: 'always',
    refetchInterval: (q) => !visible ? false : q.state.status === 'error' ? 5000 : running ? 10_000 : false
  })
  useEffect(() => {
    if (visible) return
    void qc.cancelQueries({ queryKey: [...drive.queryKey, sessionId] })
    void qc.cancelQueries({ queryKey: ['session-context-usage', sessionId] })
  }, [visible, qc, drive, sessionId])
  /** The transcript body publishes its derived activity here; this view (and the
   *  composer) never observe the full session stream itself. */
  const [activityStore] = useState(createTranscriptActivityStore)
  const wasRunning = useRef(running)
  useEffect(() => {
    // Polling/focus recovery can discover a completion whose push was missed.
    // Fetch the final transcript before the running-only heartbeat stops.
    if (wasRunning.current && !running) {
      void qc.invalidateQueries({ queryKey: [...drive.queryKey, sessionId] })
      void qc.invalidateQueries({ queryKey: ['session-queue', sessionId] })
      void qc.invalidateQueries({ queryKey: ['session-context-usage', sessionId] })
    }
    wasRunning.current = running
  }, [running, sessionId, drive, qc])
  const model = useQuery({
    queryKey: ['session-model', sessionId],
    queryFn: () => window.revva.session.model(sessionId)
  })
  const models = useQuery({ queryKey: ['models'], queryFn: () => window.revva.inventory.models(), enabled: false })
  const modelLabel = model.data
    ? `${model.data.providerID}/${model.data.id}${model.data.variant ? ` · ${model.data.variant}` : ''}`
    : model.isError ? 'Unavailable' : model.isPending ? 'Loading…' : 'Service default'
  const shortModelLabel = model.data
    ? models.data?.find((item) => item.providerID === model.data?.providerID && item.id === model.data?.id)?.name || model.data.id
    : modelLabel
  const queue = useQuery({
    queryKey: ['session-queue', sessionId],
    queryFn: () => window.revva.session.queue(sessionId)
  })
  // Keep drafts in the renderer cache when a transcript unmounts or changes sessions.
  const draftKey = ['session-draft', sessionId] as const
  useQuery({
    queryKey: draftKey,
    queryFn: () => '',
    initialData: '',
    enabled: false,
    gcTime: Infinity
  })
  const [draft, setDraft] = useState(() => ({
    sessionId,
    text: qc.getQueryData<string>(draftKey) ?? ''
  }))
  const input = draft.sessionId === sessionId ? draft.text : qc.getQueryData<string>(draftKey) ?? ''
  const updateDraft = (text: string): void => {
    setDraft({ sessionId, text })
    qc.setQueryData(draftKey, text)
  }

  /** Images staged in the composer, waiting to be sent with the next message. */
  const [pendingImages, setPendingImages] = useState<PromptImage[]>([])
  /** Token under the caret (drives /skill, @file and #agent menus). */
  const [token, setToken] = useState<ActiveToken | null>(null)
  const [tokenIndex, setTokenIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** The composer form doubles as the popover portal target for the role pickers. */
  const composerRef = useRef<HTMLFormElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<HTMLElement>(null)
  const positionedSessionRef = useRef<string | null>(null)

  const skills = useQuery({
    queryKey: ['skills'],
    queryFn: () => window.revva.inventory.skills(),
    staleTime: 5 * 60_000,
    enabled: !readOnly
  })
  const agents = useQuery({
    queryKey: ['agents', sessionId], queryFn: () => window.revva.inventory.agents(sessionId),
    staleTime: 60_000, enabled: !readOnly && token?.kind === 'agent'
  })
  const skillMatches = useMemo(() => {
    if (!token || token.kind !== 'skill') return []
    const q = token.query.toLowerCase()
    const list = skills.data ?? []
    return (q ? list.filter((s) => `${s.id} ${s.name ?? ''}`.toLowerCase().includes(q)) : list).slice(0, 8)
  }, [token, skills.data])
  const fileHits = useQuery({
    queryKey: ['file-find', sessionId, token?.kind === 'file' ? token.query : null],
    queryFn: () => window.revva.file.find(sessionId, token?.query ?? ''),
    enabled: token?.kind === 'file' && (token.query.length >= 1),
    staleTime: 30_000
  })
  const fileMatches: FileHit[] = fileHits.data ?? []
  /** One row in the autocomplete menu; `run` items fire an action instead of inserting. */
  interface MenuItem {
    key: string
    insert: string
    hint?: string
    run?: () => void
  }
  const menuList: MenuItem[] = useMemo(() => {
    if (!token) return []
    if (token.kind === 'agent') {
      const q = token.query.toLowerCase()
      return (agents.data ?? []).filter((agent) => `${agent.id} ${agent.name ?? ''}`.toLowerCase().includes(q)).slice(0, 8)
        .map((agent) => ({ key: agent.id, insert: `#${agent.id}`, hint: agent.description ?? agent.mode }))
    }
    if (token.kind === 'file') {
      return fileMatches.map((f) => ({
        key: f.path,
        insert: `@${f.path}${f.type === 'directory' ? '/' : ''}`
      }))
    }
    const items: MenuItem[] = []
    const q = token.query.toLowerCase()
    if (onNewSession && 'new'.startsWith(q)) {
      items.push({ key: '__new', insert: '/new', hint: 'New session with project, model and links; default agent', run: onNewSession })
    }
    for (const s of skillMatches) items.push({ key: s.id, insert: `/${s.id}`, hint: s.description })
    return items.slice(0, 9)
  }, [token, skillMatches, fileMatches, agents.data, onNewSession])
  const menuItems = menuList.length

  useEffect(() => {
    setPendingImages([])
  }, [sessionId])

  // Main pushes queue/model changes for every session (bus forwards all sessions, so
  // the TUI and other clients are covered); these pushes are the update channel.
  useEffect(() => {
    return window.revva.events.on((event) => {
      if (event.kind === 'session.queue' && event.sessionId === sessionId) {
        void qc.invalidateQueries({ queryKey: ['session-queue', sessionId] })
      }
      if (event.kind === 'session.model' && event.sessionId === sessionId) {
        void qc.invalidateQueries({ queryKey: ['session-model', sessionId] })
      }
      if (event.kind === 'session.activity' && event.sessionId === sessionId && !event.running) {
        void qc.invalidateQueries({ queryKey: ['session-queue', sessionId] })
        void qc.invalidateQueries({ queryKey: ['session-model', sessionId] })
        void qc.invalidateQueries({ queryKey: ['session-context-usage', sessionId] })
      }
    })
  }, [sessionId, qc])

  // Stick-to-bottom: jump instantly (smooth animations restart per token and
  // fight the user), and only while the user is already at the bottom.
  // The per-content-change follow lives in TranscriptContent.
  const scrollWrapRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const viewport = scrollWrapRef.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
    if (!viewport) return
    const onScroll = (): void => {
      stick.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])
  // Switching chats: re-anchor at the bottom, then jump once messages arrive.
  useLayoutEffect(() => {
    positionedSessionRef.current = null
    stick.current = true
  }, [sessionId])
  useLayoutEffect(() => {
    if (!messages.data || positionedSessionRef.current === sessionId) return
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
    positionedSessionRef.current = sessionId
  }, [sessionId, messages.data])

  const addImages = async (files: File[]): Promise<void> => {
    const images = await filesToImages(files)
    if (images.length) setPendingImages((old) => [...old, ...images].slice(0, MAX_IMAGES))
  }

  const updateToken = (): void => {
    const el = textareaRef.current
    if (!el) return
    setToken(activeToken(el.value, el.selectionStart))
    setTokenIndex(0)
  }

  /** Replace the active token with a picked `/skill` or `@path`. */
  const acceptToken = (insert: string): void => {
    const el = textareaRef.current
    if (!token || !el) return
    const caret = el.selectionStart
    const next = input.slice(0, token.start) + insert + ' ' + input.slice(caret)
    updateDraft(next)
    const pos = token.start + insert.length + 1
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
      setToken(null)
    })
  }

  /** Accept the highlighted menu row: fire its action or insert its token. */
  const pickMenu = (item: MenuItem): void => {
    if (item.run) {
      updateDraft('')
      setToken(null)
      item.run()
    } else {
      acceptToken(item.insert)
    }
  }

  const send = useMutation({
    mutationFn: async ({ stopReview, text: textOverride }: { stopReview?: boolean; text?: string } = {}) => {
      const sentAt = Date.now()
      // A paste-autosend fires before the draft state commits, so it passes its text directly.
      const sentFrom = textOverride ?? input
      const text = sentFrom.trim()
      const images = pendingImages
      // '/new' on its own is a command, not a message.
      if (text === '/new' && images.length === 0 && onNewSession) {
        updateDraft('')
        setToken(null)
        onNewSession()
        return
      }
      if (!text && images.length === 0) return
      const mentionedAgents = /(?:^|\s)#[\w./-]+/.test(text)
        ? agents.data ?? await window.revva.inventory.agents(sessionId).catch(() => {
          throw new Error('Could not load agent profiles, so this message was not sent. Retry sending to resolve #agent references.')
        })
        : []
      const refs = extractRefs(text, skills.data ?? [], mentionedAgents)
      const messageKey = [...drive.queryKey, sessionId]
      const optimisticId = `pending-${crypto.randomUUID()}`
      if (!running && (!reviewing || stopReview)) {
        qc.setQueryData<ChatMessage[]>(messageKey, (old = []) => [...old, {
          id: optimisticId,
          role: 'user',
          text,
          images: images.length
            ? images.map((img) => ({ name: img.name, mime: img.mime, data: `data:${img.mime};base64,${img.data}` }))
            : undefined,
          createdAt: Date.now()
        }])
      }
      // Start before awaiting IPC: completion may arrive before prompt() resolves.
      if (!reviewing || stopReview) setSendingSession(sessionId)
      try {
        const result = stopReview && work
          ? await window.revva.work.promptNow(sessionId, text, images, refs)
          : await drive.send(sessionId, text, images.length ? images : undefined, running, refs, sentAt)
        if (result === 'queued') {
          // The pipeline may have become busy after the UI's activity snapshot.
          qc.setQueryData<ChatMessage[]>(messageKey, (old = []) => old.filter((message) => message.id !== optimisticId))
          if (work) void qc.invalidateQueries({ queryKey: ['work-queue', work.id] })
          else void qc.invalidateQueries({ queryKey: ['works'] })
        }
      } catch (error) {
        qc.setQueryData<ChatMessage[]>(messageKey, (old = []) => old.filter((message) => message.id !== optimisticId))
        throw error
      } finally {
        setSendingSession((current) => current === sessionId ? null : current)
        void qc.invalidateQueries({ queryKey: ['session-activity'] })
        if (work) void qc.invalidateQueries({ queryKey: ['work-queue', work.id] })
      }
      const draftNow = qc.getQueryData<string>(draftKey)
      if (textOverride !== undefined) {
        // The paste (or its onChange) may have landed in the draft while sending — clear it if it is still just what we sent.
        if (draftNow !== undefined && draftNow.trim() === text) {
          qc.setQueryData(draftKey, '')
          setDraft((current) => current.sessionId === sessionId && current.text.trim() === text ? { sessionId, text: '' } : current)
        }
      } else if (draftNow === input) {
        qc.setQueryData(draftKey, '')
        setDraft((current) => current.sessionId === sessionId && current.text === input ? { sessionId, text: '' } : current)
      }
      setPendingImages((current) => current.filter((image) => !images.includes(image)))
      setToken(null)
      if (running) {
        // Queued behind the running turn — it shows up in the queue strip, not the transcript.
        void qc.invalidateQueries({ queryKey: ['session-queue', sessionId] })
      }
    },
    onSettled: () => {
      // Refetch shortly after to reconcile server-side ids/order.
      setTimeout(() => void qc.invalidateQueries({ queryKey: [...drive.queryKey, sessionId] }), 400)
    }
  })

  const cancelQueued = useMutation({
    mutationFn: (inboxId: string) => window.revva.session.cancelQueued(sessionId, inboxId),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['session-queue', sessionId] })
  })

  const promoteQueued = useMutation({
    mutationFn: (inboxId: string) => window.revva.session.promoteQueued(sessionId, inboxId),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['session-queue', sessionId] })
  })

  const interrupt = useMutation({
    mutationFn: () => drive.interrupt(sessionId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['session-activity'] })
      void qc.invalidateQueries({ queryKey: [...drive.queryKey, sessionId] })
    }
  })

  const queued = queue.data ?? []
  const canSend = (input.trim().length > 0 || pendingImages.length > 0) && !send.isPending

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{header}</div>
        {!hideSessionDetails && (
          <>
            <SessionIdButton key={sessionId} sessionId={sessionId} />
            <Badge variant="outline" className="min-w-0 max-w-60 shrink text-[10px] font-normal" title={`Model: ${modelLabel}`}>
              <span className="truncate">Model: {shortModelLabel}</span>
            </Badge>
          </>
        )}
      </div>
      {body ?? <>
      <div ref={scrollWrapRef} className="relative flex min-h-0 flex-1 flex-col">
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2 sm:right-6">
          <SessionStats sessionId={sessionId} running={running} />
          {!readOnly && !hideChildAgents && <AgentsPanel key={`agents-${sessionId}`} sessionId={sessionId} work={work} renderTranscript={(child) => (
            <TranscriptView key={child.sessionId} sessionId={child.sessionId} drive={chatDrive} readOnly hideChildAgents hideSessionDetails
              emptyHint="This agent has not produced output yet." header={<><span className="min-w-0 flex-1 truncate text-xs">Agent output</span><SessionIdButton sessionId={child.sessionId} /></>} />
          )} />}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <TranscriptContent
            sessionId={sessionId}
            history={messages.data}
            loading={messages.isLoading}
            error={messages.isError}
            running={running}
            emptyHint={emptyHint}
            stick={stick}
            bottomRef={bottomRef}
            activity={activityStore}
          />
        </ScrollArea>
      </div>

      {!readOnly && pending.length > 0 && (
        <div className="shrink-0 border-t px-3 sm:px-6" role="status">
          <div className="mx-auto max-w-3xl">
            <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => {
              pendingRef.current?.scrollIntoView({ block: 'start' })
              pendingRef.current?.focus({ preventScroll: true })
            }}>Waiting on you ({pending.length}) · View requests</Button>
          </div>
        </div>
      )}
      <div className="min-h-0 max-h-[35vh] shrink overflow-y-auto">
      {work && <WorkAgentActivity key={work.id} work={work} />}
      {running && !reviewing && <TranscriptActivityStrip store={activityStore} />}

      {!readOnly && pending.length > 0 && (
        <section ref={pendingRef} tabIndex={-1} aria-label="Waiting on you" className="border-t bg-muted/30 px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Waiting on you ({pending.length})</p>
            {pending.map((item) =>
              item.kind === 'form' ? (
                <FormCard key={`${item.kind}:${item.id}`} item={item} />
              ) : (
                <PermissionCard key={`${item.kind}:${item.id}`} item={item} />
              )
            )}
          </div>
        </section>
      )}
      </div>

      {!readOnly && (
        <div className="shrink-0 border-t px-3 py-3 sm:px-6">
          <div className="max-h-[18vh] overflow-y-auto">
          {work && <WorkFollowUpQueue work={work} running={running} refsForText={async (text) => {
            const [knownSkills, knownAgents] = await Promise.all([
              skills.data ? Promise.resolve(skills.data) : window.revva.inventory.skills(),
              /(?:^|\s)#[\w./-]+/.test(text) ? (agents.data ? Promise.resolve(agents.data) : window.revva.inventory.agents(sessionId)) : Promise.resolve([])
            ])
            return extractRefs(text, knownSkills, knownAgents)
          }} />}
          {reviewing && <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">{work?.state === 'FIXING' ? 'Fixing' : 'Review'} in progress. Follow-ups run after this cycle, before shipping.</p>
            <Button type="button" size="xs" variant="outline" disabled={!canSend} onClick={() => send.mutate({ stopReview: true })}>{send.isPending ? 'Sending…' : 'Stop review and send now'}</Button>
          </div>}
          {queued.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-3xl flex-col gap-1">
              {queued.map((q, i) => (
                <QueuedRow
                  key={q.id}
                  item={q}
                  position={i + 1}
                  onCancel={() => cancelQueued.mutate(q.id)}
                  onSteer={() => promoteQueued.mutate(q.id)}
                  steering={promoteQueued.isPending && promoteQueued.variables === q.id}
                />
              ))}
            </div>
          )}
          </div>
          {send.error instanceof Error && (
            <p role="alert" className="mx-auto mb-2 max-w-3xl text-xs text-destructive">{send.error.message}</p>
          )}
          <form
            ref={composerRef}
            className="relative mx-auto max-w-3xl"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSend) send.mutate({})
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (files.some((f) => f.type.startsWith('image/'))) {
                e.preventDefault()
                void addImages(files)
                return
              }
              // Dictated messages arrive as a text paste into an empty box — with the hint's
              // auto-send on, that is the "release the hotkey and it's sent" flow. A paste
              // into an existing draft stays an ordinary paste.
              if (!autoSendPaste) return
              const pasted = e.clipboardData.getData('text/plain')
              if (!pasted.trim()) return
              const emptyBefore = input.length === 0 && pendingImages.length === 0 && !send.isPending
              // Let the paste land in the textarea first, then send exactly what is there.
              requestAnimationFrame(() => {
                const el = textareaRef.current
                const final = (el ? el.value : pasted).trim()
                if (emptyBefore && final && el && el.value.trim() === final) send.mutate({ text: el.value })
              })
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void addImages(Array.from(e.dataTransfer.files))
            }}
          >
            {token && menuItems > 0 && (
              <div className="absolute bottom-full left-0 z-10 mb-2 flex w-80 max-w-full flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
                <div className="border-b px-2.5 py-1 text-[10px] text-muted-foreground">
                  {token.kind === 'skill' ? 'Commands — Enter/Tab to insert' : token.kind === 'agent' ? 'Agents — Enter/Tab to reference' : 'Files — Enter/Tab to insert'}
                </div>
                {menuList.map((item, i) => (
                  <button
                    key={item.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMenu(item)}
                    className={cn(
                      'flex items-baseline gap-2 px-2.5 py-1.5 text-left text-xs',
                      i === tokenIndex && 'bg-muted'
                    )}
                  >
                    <span className="shrink-0 font-mono font-medium">{item.insert}</span>
                    {item.hint && <span className="truncate text-muted-foreground">{item.hint}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col rounded-xl border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              {pendingImages.length > 0 && (
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto px-3 pt-3">
                  {pendingImages.map((img, i) => (
                    <div key={i} className="relative shrink-0">
                      <img
                        src={`data:${img.mime};base64,${img.data}`}
                        alt={img.name ?? 'attachment'}
                        className="size-16 rounded-md border bg-muted object-contain"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${img.name || `image ${i + 1}`}`}
                        onClick={() => setPendingImages((old) => old.filter((_, j) => j !== i))}
                        className="absolute right-0.5 top-0.5 rounded-sm bg-background p-1 text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  updateDraft(e.target.value)
                  updateToken()
                }}
                onSelect={updateToken}
                onBlur={() => setToken(null)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (token && menuItems > 0) {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      setTokenIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % menuItems : (i - 1 + menuItems) % menuItems))
                      return
                    }
                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                      e.preventDefault()
                      const pick = menuList[tokenIndex]
                      if (pick) pickMenu(pick)
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setToken(null)
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (canSend) send.mutate({})
                  }
                }}
                placeholder={
                  reviewing
                    ? 'Queue a follow-up for after review/fixing…'
                    : running
                    ? 'Running — send to queue your message…'
                    : 'Message… @file attaches a file; #agent references a specialist.'
                }
                aria-label="Message"
                rows={2}
                className="max-h-48 min-h-16 resize-none rounded-none border-0 bg-transparent px-4 pb-2 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void addImages(Array.from(e.target.files ?? []))
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Attach images"
                  title="Attach, paste or drop images"
                  disabled={pendingImages.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon />
                </Button>
                <DictationHint container={composerRef} />
                <ComposerModelPickers key={sessionId} sessionId={sessionId} container={composerRef} />
                {running && (
                  <Button type="button" size="icon-sm" variant="outline" className="ml-auto" aria-label="Stop response" title="Stop response" onClick={() => interrupt.mutate()}>
                    <Square />
                  </Button>
                )}
                <Button type="submit" size="icon-sm" className={!running ? 'ml-auto' : undefined} aria-label={reviewing ? 'Queue follow-up' : running ? 'Queue message' : 'Send message'} title={reviewing ? 'Queue follow-up' : running ? 'Queue message' : 'Send message'} disabled={!canSend}>
                  <ArrowUp />
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
      </>}
    </div>
  )
}

/** One waiting inbox message with its position, a steer-now affordance for
 *  queued items, and a cancel button. Steered items show their injected state. */
function QueuedRow({ item, position, onCancel, onSteer, steering }: {
  item: QueuedMessage
  position: number
  onCancel: () => void
  onSteer: () => void
  steering: boolean
}): React.JSX.Element {
  const steered = item.delivery === 'steer'
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <span className="shrink-0 font-medium">
        {steered ? 'Steering into this turn' : `#${position} queued`}
      </span>
      <span className="truncate">{item.text || (item.imageCount > 0 ? `${item.imageCount} image(s)` : '(empty)')}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {!steered && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Steer the running agent with this message now"
                className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
                disabled={steering}
                onClick={onSteer}
              >
                {steering ? 'Steering…' : 'Steer now'}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              Send this message into the current run at the next step boundary instead of waiting for the queue.
            </TooltipContent>
          </Tooltip>
        )}
        <button type="button" aria-label="Remove queued message" className="rounded p-0.5 hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10" onClick={onCancel}>
          <X className="size-3" />
        </button>
      </div>
    </div>
  )
}

export { MessageRow } from '@/components/transcript-content'

export function RunningBadge({ running }: { running: boolean }): React.JSX.Element | null {
  if (!running) return null
  return (
    <Badge variant="secondary" className="ml-auto animate-pulse text-[10px]">
      running…
    </Badge>
  )
}

/* ---------- composer model/agent pickers ---------- */

/** Model + effort dropdowns in the composer footer: switch mid-conversation, applies
 *  to subsequent turns (OpenCode switchModel — history is untouched). The coordinator is
 *  chosen when the conversation starts, not here. */
function ComposerModelPickers({ sessionId, container }: {
  sessionId: string
  /** Composer element the menus portal into, so they stay anchored to it. */
  container: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const qc = useQueryClient()
  const [modelOpen, setModelOpen] = useState(false)
  const [search, setSearch] = useState('')
  const models = useQuery({ queryKey: ['models'], queryFn: () => window.revva.inventory.models(), staleTime: 60_000, enabled: modelOpen })
  const model = useQuery({ queryKey: ['session-model', sessionId], queryFn: () => window.revva.session.model(sessionId) })
  const switchModel = useMutation({
    mutationFn: (ref: ModelRef) => window.revva.session.setModel(sessionId, ref),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session-model', sessionId] })
  })
  const error = switchModel.error

  const currentModel = model.data
    ? models.data?.find((m) => m.providerID === model.data?.providerID && m.id === model.data?.id)?.name || model.data.id
    : 'Model: default'
  const effortVariants = model.data?.variants ?? []
  const currentEffort = model.data?.variant && effortVariants.includes(model.data.variant)
    ? model.data.variant
    : '__default__'
  const q = search.trim().toLowerCase()
  const modelMatches = (models.data ?? []).filter((m) => !q || `${m.name ?? ''} ${m.id} ${m.providerID}`.toLowerCase().includes(q))
  // Inventory already orders favorites first; group them under a heading so the
  // pick matches the star the user set in Setup.
  const favoriteModels = modelMatches.filter((m) => m.favorite)
  const otherModels = modelMatches.filter((m) => !m.favorite)
  const modelRow = (m: (typeof modelMatches)[number]): React.JSX.Element => {
    const active = model.data?.providerID === m.providerID && model.data?.id === m.id
    return (
      <Choice
        key={`${m.providerID}::${m.id}`}
        label={m.name || m.id}
        detail={m.gated || m.providerID}
        disabled={!!m.gated || active}
        selected={active}
        onClick={() => { switchModel.mutate({ providerID: m.providerID, id: m.id }); setModelOpen(false) }}
      />
    )
  }
  const busy = switchModel.isPending

  return (
    <>
      <Popover open={modelOpen} onOpenChange={(next) => { setModelOpen(next); if (!next) setSearch('') }}>
        <PopoverTrigger
          render={<Button type="button" size="xs" variant="ghost" className="min-w-0 max-w-44" aria-label="Switch model for this conversation" disabled={busy} />}
        >
          <Cpu data-icon="inline-start" />
          <span className="truncate">{currentModel}</span>
          <ChevronDown data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent container={container} align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-2 p-3">
          <PopoverTitle>Switch model</PopoverTitle>
          <p className="text-[11px] text-muted-foreground">Applies to the next turn; this conversation keeps its history.</p>
          <Input aria-label="Search models" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 text-xs" />
          <div className="max-h-64 overflow-y-auto">
            {favoriteModels.length > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Favorites</p>
                {favoriteModels.map(modelRow)}
              </>
            )}
            {otherModels.length > 0 && (
              <>
                {favoriteModels.length > 0 && (
                  <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">All models</p>
                )}
                {otherModels.map(modelRow)}
              </>
            )}
            {modelMatches.length === 0 && <p role={models.isError ? 'alert' : 'status'} className="px-2 py-1.5 text-xs text-muted-foreground">{models.isPending ? 'Loading models…' : models.isError ? 'Couldn’t load models. Close and reopen to retry.' : 'No models match.'}</p>}
          </div>
        </PopoverContent>
      </Popover>
      <Select
        value={currentEffort}
        onValueChange={(variant) => {
          if (!model.data) return
          switchModel.mutate({
            providerID: model.data.providerID,
            id: model.data.id,
            ...(variant && variant !== '__default__' ? { variant } : {})
          })
        }}
        disabled={!model.data || effortVariants.length === 0 || busy}
      >
        <SelectTrigger
          size="sm"
          aria-label="Set reasoning effort"
          title={effortVariants.length ? 'Set reasoning effort for this model' : 'This model exposes no effort options'}
          className="h-6 w-auto max-w-36 gap-1 border-transparent px-1 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
        >
          <span>Effort:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="__default__">Default</SelectItem>
          {effortVariants.map((variant) => (
            <SelectItem key={variant} value={variant}>{variant}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error instanceof Error && (
        <span role="alert" className="max-w-48 truncate text-[11px] text-destructive" title={error.message}>
          {error.message}
        </span>
      )}
    </>
  )
}

/* ---------- Concrete drives ---------- */

export const chatDrive: TranscriptDrive = {
  queryKey: ['chat-messages'],
  load: (id, since, requestId) => window.revva.chat.messages(id, since, requestId),
  send: (id, text, images, queued, refs, sentAt) => window.revva.chat.prompt(id, text, images, queued, refs, sentAt),
  interrupt: (id) => window.revva.chat.interrupt(id)
}

export const workDrive: TranscriptDrive = {
  queryKey: ['chat-messages'],
  load: (id, since, requestId) => window.revva.work.messages(id, since, requestId),
  send: (id, text, images, queued, refs, sentAt) => window.revva.work.prompt(id, text, images, queued, refs, sentAt),
  interrupt: (id) => window.revva.work.interrupt(id)
}

export function ChatView({ sessionId, onOpenChat, work: providedWork }: { sessionId: string; onOpenChat?: (sessionId: string) => void; work?: WorkSummary }): React.JSX.Element {
  const qc = useQueryClient()
  const [consoleMode, setConsoleMode] = useState(false)
  const chats = useQuery({ queryKey: ['chats'], queryFn: () => window.revva.chat.list() })
  const chat = chats.data?.find((c) => c.sessionId === sessionId)
  const works = useQuery({ queryKey: ['works'], queryFn: () => window.revva.work.list() })
  // Load ticket utilities for chats linked before they shared the cockpit.
  // Session identity is essential: another chat for the same ticket is NOT this run.
  const chatWork = providedWork ?? (works.data ?? []).find((w) => w.sessionId === sessionId && w.state !== 'ABANDONED')
  const attachment = useQuery({
    queryKey: ['conversation-context', sessionId],
    queryFn: async () => {
      const work = await window.revva.work.conversationContext(sessionId)
      void qc.invalidateQueries({ queryKey: ['works'] })
      return work
    },
    enabled: !!(chat?.ticketKey || chat?.prUrl) && !chatWork,
    retry: false,
    staleTime: Infinity
  })
  const ticketKeys = [...new Set([
    ...(works.data ?? []).filter((work) => !!work.ticketKey && work.state !== 'ABANDONED').map((work) => work.ticketKey),
    ...(chats.data ?? []).flatMap((item) => item.ticketKey ? [item.ticketKey] : [])
  ])].sort()
  const tag = useMutation({
    mutationFn: (ticketKey: string | null) => window.revva.chat.setTicket(sessionId, ticketKey),
    onSuccess: (_result, ticketKey) => {
      void qc.invalidateQueries({ queryKey: ['chats'] })
      void qc.invalidateQueries({ queryKey: ['works'] })
      if (ticketKey || chat?.prUrl) void qc.invalidateQueries({ queryKey: ['conversation-context', sessionId] })
      if (providedWork) onOpenChat?.(sessionId)
    }
  })
  const [customTicket, setCustomTicket] = useState('')
  const attachTypedTicket = (): void => {
    const key = customTicket.trim()
    if (!key) return
    tag.mutate(key, { onSuccess: () => setCustomTicket('') })
  }
  /** `/new` — fresh coordinator context, retaining the project/model/links. */
  const newSession = (): void => {
    if (!chat || !onOpenChat) return
    void window.revva.chat
      .create({
        directory: chat.directory,
        model: chat.providerID && chat.modelID ? { providerID: chat.providerID, id: chat.modelID } : undefined,
        ticketKey: chat.ticketKey,
        prUrl: chat.prUrl
      })
      .then((created) => {
        void qc.invalidateQueries({ queryKey: ['chats'] })
        onOpenChat(created.sessionId)
      })
      .catch((err) => console.error('[chat] /new failed:', err))
  }
  /** Every failed control in this conversation reports here: one chat, one sender. */
  const sendToChat = async (text: string): Promise<void> => {
    await (chatWork ? window.revva.work.prompt(sessionId, text) : window.revva.chat.prompt(sessionId, text))
    void qc.invalidateQueries({ queryKey: ['chat-messages', sessionId] })
    void qc.invalidateQueries({ queryKey: ['chats'] })
  }
  return (
    <AskAgentProvider ask={sendToChat}>
    <ConversationEnvironment work={chatWork}>
      {(chat?.ticketKey || chat?.prUrl) && !chatWork && <p role={attachment.isError ? 'alert' : 'status'} className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
        {attachment.error instanceof Error ? `Could not load conversation utilities: ${attachment.error.message}` : 'Loading conversation utilities…'}
        {attachment.isError && <Button size="sm" variant="outline" onClick={() => void attachment.refetch()}>Retry</Button>}
      </p>}
      {tag.error && <ActionError action="link ticket" error={tag.error instanceof Error ? tag.error.message : String(tag.error)} className="shrink-0 border-b px-4 py-2 text-sm" />}
    <TranscriptView
      key={sessionId}
      sessionId={sessionId}
      drive={chatWork ? workDrive : chatDrive}
      work={chatWork}
      hideSessionDetails
      emptyHint={chat?.ticketKey ? `Ask anything about ${chat.ticketKey}.` : 'Ask anything about this project — this chat is not attached to a ticket.'}
      onNewSession={onOpenChat && chat ? newSession : undefined}
      body={consoleMode ? <OpenCodeConsole key={sessionId} sessionId={sessionId} /> : undefined}
      header={
        <>
          {/* The conversation's name (and its rename affordance) lives in the
              app's top bar — repeating it here only duplicated the title. */}
          {chat && <ChatRepoStatus sessionId={sessionId} directory={chat.directory} />}
          {chat && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={tag.isPending} className="shrink-0">
                  <Tag data-icon="inline-start" /> {chat.ticketKey ?? 'Link ticket'} <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Move to ticket</DropdownMenuLabel>
                  {ticketKeys.map((key) => <DropdownMenuItem key={key} disabled={key === chat.ticketKey} onSelect={() => tag.mutate(key)}>{key}</DropdownMenuItem>)}
                  {ticketKeys.length === 0 && <DropdownMenuItem disabled>No ticket groups yet</DropdownMenuItem>}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/* Typed keys skip the group list — the main process normalizes and validates them. */}
                <div className="flex items-center gap-1.5 px-1.5 py-1" onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  <Input
                    value={customTicket}
                    onChange={(e) => setCustomTicket(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); attachTypedTicket() } }}
                    placeholder="CLN-1234"
                    aria-label="Ticket number"
                    className="h-6 w-28 text-[11px]"
                  />
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!customTicket.trim() || tag.isPending} onClick={attachTypedTicket}>
                    Link
                  </Button>
                </div>
                {chat.ticketKey && <DropdownMenuItem onSelect={() => tag.mutate(null)}>Remove ticket link</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {chatWork && <ConversationActions work={chatWork} />}
          {chat && !chatWork && <ChatReviewButton sessionId={sessionId} directory={chat.directory} />}
          {(chatWork?.prUrl || chat?.prUrl) && (
            <PrConversationActions
              prUrl={chatWork?.prUrl ?? chat?.prUrl}
              directory={chatWork?.worktreeDir ?? chat?.directory ?? ''}
              work={chatWork}
              onOpenChat={onOpenChat}
              onAskAgent={sendToChat}
            />
          )}
          <ConversationDetails sessionId={sessionId} directory={chat?.directory} work={chatWork}>
            <SessionIdButton sessionId={sessionId} />
          </ConversationDetails>
          {/* The transcript is Revva's rendering; OpenCode's own interface is one
              click away for people who prefer it. The session is the same one,
              so a message sent there appears here and vice versa. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={consoleMode ? 'secondary' : 'ghost'}
                size="sm"
                className="shrink-0"
                aria-pressed={consoleMode}
                onClick={() => setConsoleMode((on) => !on)}
              >
                <SquareTerminal data-icon="inline-start" />
                <span className="hidden md:inline">Console</span>
                <span className="sr-only md:hidden">OpenCode console</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {consoleMode ? "Show Revva's conversation view" : "Show this session in OpenCode's own interface"}
            </TooltipContent>
          </Tooltip>
        </>
      }
    />
    </ConversationEnvironment>
    </AskAgentProvider>
  )
}
