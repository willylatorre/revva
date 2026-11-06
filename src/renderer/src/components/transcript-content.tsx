import { memo, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { EMPTY_STREAM, mergeTranscript, streamKey, type LiveTranscript } from '@/lib/transcript-stream'
import { stabilizeGroups, type TranscriptGroup } from '@/lib/transcript-groups'
import { MD_COMPONENTS } from '@/components/message-markdown'
import { AssistantMarkdown } from '@/components/assistant-markdown'
import type { ChatMessage, ChatToolCall } from '@shared/types'
import { BUILD_COMPLETION_INSTRUCTIONS } from '@shared/prompts'

// Preserve ordinary line breaks in user-written prompts while rendering Markdown.
export const USER_MD_COMPONENTS: typeof MD_COMPONENTS = {
  ...MD_COMPONENTS,
  p: ({ node: _node, ...props }) => <p className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      className="underline underline-offset-2"
      onClick={(e) => {
        e.preventDefault()
        if (props.href) void window.revva.shell.openExternal(props.href)
      }}
    />
  )
}
const USER_BUBBLE_MD_COMPONENTS: typeof MD_COMPONENTS = {
  ...USER_MD_COMPONENTS,
  pre: ({ node: _node, ...props }) => (
    <pre {...props} className="overflow-x-auto rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-2 text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0" />
  ),
  code: ({ node: _node, ...props }) => (
    <code {...props} className="rounded bg-primary-foreground/15 px-1 py-0.5 font-mono text-[11px]" />
  )
}

/* ---------- activity strip observation ---------- */

/**
 * One-way channel from the transcript's merged data to the footer strip.
 * Listeners wake only when the derived string actually changes, so appended
 * answer characters never rerender the composer's surrounding layout.
 */
export interface TranscriptActivityStore {
  subscribe: (listener: () => void) => () => void
  getText: () => string | null
  set: (text: string | null) => void
}

export function createTranscriptActivityStore(): TranscriptActivityStore {
  const listeners = new Set<() => void>()
  let text: string | null = null
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getText: () => text,
    set: (next) => {
      if (next === text) return
      text = next
      for (const listener of [...listeners]) listener()
    }
  }
}

const noActivity = (): string | null => null

/** Footer badge reading the merged activity string. Rerenders only when that
 *  string changes — not on every streamed character. */
export function TranscriptActivityStrip({ store }: { store: TranscriptActivityStore }): React.JSX.Element | null {
  const text = useSyncExternalStore(store.subscribe, store.getText, noActivity)
  if (text === null) return null
  return (
    <div className="shrink-0 px-3 py-1.5 sm:px-6" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-hidden">
        <Badge variant="secondary" className="shrink-0 text-[10px]">Thinking</Badge>
        <span className="truncate text-[11px] text-muted-foreground" title={text}>{text}</span>
      </div>
    </div>
  )
}

/* ---------- transcript content ---------- */

const EMPTY_HISTORY: ChatMessage[] = Object.freeze([]) as unknown as ChatMessage[]

/** Turn-count/tool/reasoning summary for the footer. Text growth alone keeps
 *  the previous string, so publishing it wakes nobody. */
function deriveActivity(running: boolean, groups: TranscriptGroup[]): string | null {
  if (!running) return null
  const currentTurn = groups.at(-1)?.kind === 'assistant' ? groups.at(-1) as Extract<TranscriptGroup, { kind: 'assistant' }> : null
  if (!currentTurn) return 'Preparing response…'
  const latestTool = currentTurn.msgs.flatMap((message) => message.tools ?? []).at(-1)
  return [
    `Step ${currentTurn.msgs.length}`,
    latestTool
      ? `${latestTool.state === 'error' ? 'Failed' : latestTool.state === 'completed' ? 'Last' : 'Running'}: ${latestTool.name}${latestTool.detail ? ` · ${latestTool.detail.split('\n')[0]}` : ''}`
      : currentTurn.msgs.at(-1)?.thinking ? 'Reasoning' : 'Generating response'
  ].filter(Boolean).join(' · ')
}

/**
 * The transcript scroll body: the only surface observing the full live session
 * stream. History arrives as props (no second HTTP loader); groups keep their
 * previous identities whenever member messages are unchanged, so memoized
 * cards for finished turns skip renders while a later turn streams.
 */
export const TranscriptContent = memo(function TranscriptContent({
  sessionId,
  history,
  loading,
  error,
  running,
  emptyHint,
  stick,
  bottomRef,
  activity
}: {
  sessionId: string
  history: ChatMessage[] | undefined
  loading: boolean
  error: boolean
  running: boolean
  emptyHint: string
  /** Stick-to-bottom flag owned by the surrounding view's scroll listener. */
  stick: RefObject<boolean>
  bottomRef: RefObject<HTMLDivElement | null>
  activity: TranscriptActivityStore
}): React.JSX.Element {
  const live = useQuery<LiveTranscript>({
    queryKey: streamKey(sessionId),
    queryFn: () => EMPTY_STREAM,
    initialData: EMPTY_STREAM,
    structuralSharing: false,
    enabled: false
  })
  const rows = useMemo(() => mergeTranscript(history ?? EMPTY_HISTORY, live.data ?? EMPTY_STREAM), [history, live.data])
  /** Previous group objects survive while every member message is identical.
   *  Published only after commit: an aborted concurrent render must never become
   *  the stability baseline for the next one. */
  const previousGroups = useRef<TranscriptGroup[]>([])
  const groups = useMemo(() => stabilizeGroups(previousGroups.current, rows), [rows])
  useLayoutEffect(() => {
    previousGroups.current = groups
  }, [groups])

  // Stick-to-bottom: follow actual layout growth — paced Markdown re-renders
  // grow the document without any query-data change — and only while the user
  // is already at the bottom, so a manual scroll-up stays honored.
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const follow = (): void => {
      if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    const observer = new ResizeObserver(follow)
    observer.observe(content)
    return () => observer.disconnect()
  }, [stick, bottomRef])

  const activityText = deriveActivity(running, groups)
  // Publish before paint so the footer strip never shows a blank frame, and
  // only a changed string wakes the strip — appended characters do not.
  // The clear is a lifetime effect: an activity change publishes exactly the
  // next meaningful string, never an intermediate null.
  useLayoutEffect(() => {
    activity.set(activityText)
  }, [activity, activityText])
  useLayoutEffect(() => () => activity.set(null), [activity])

  return (
    <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-4 px-6 pb-5 pt-16">
      {loading && <Skeleton className="h-16 w-full" />}
      {!loading && !error && rows.length === 0 && !running && (
        <p className="mt-10 text-center text-sm text-muted-foreground">{emptyHint}</p>
      )}
      {groups.map((g, i) =>
        g.kind === 'user' ? (
          <MessageRow key={g.msg.id} message={g.msg} />
        ) : (
          <AssistantTurn
            key={g.msgs[0]?.id ?? i}
            messages={g.msgs}
            streaming={running && i === groups.length - 1}
          />
        )
      )}
      <div ref={bottomRef} />
    </div>
  )
})

/* ---------- turn cards ---------- */

/** One agent turn as a single card: thoughts and tool steps collapsed inside,
 *  the answer(s) visible. The step list stays collapsed unless the user opens it.
 *  Memoized: with stabilized groups a finished turn keeps the same array identity. */
const AssistantTurn = memo(function AssistantTurn({
  messages,
  streaming
}: {
  messages: ChatMessage[]
  streaming: boolean
}): React.JSX.Element | null {
  const tools = messages.flatMap((m) => m.tools ?? [])
  const thinking = messages.map((m) => m.thinking).filter(Boolean).join('\n\n')
  const texts = messages.map((m) => m.text).filter((t) => t.trim() !== '')
  const shown = texts
  const busy = streaming || tools.some((t) => t.state === 'running' || t.state === 'streaming')

  const [stepsOpen, setStepsOpen] = useState(false)

  // A turn with no real content yet (no text, no tools, no reasoning) gets no
  // card — the footer badge already says Thinking while the step spins up.
  if (shown.length === 0 && tools.length === 0 && !thinking) return null
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] flex-col gap-1.5 rounded-lg bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed">
        {thinking && <ThinkingBlock text={thinking} />}
        {tools.length > 0 && (
          <Collapsible open={stepsOpen} onOpenChange={setStepsOpen} className="group/collapsible">
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3 shrink-0 transition-transform group-data-[open]/collapsible:rotate-90" />
              <span>
                Worked through {tools.length} step{tools.length === 1 ? '' : 's'}
              </span>
              {busy && <span className="animate-pulse italic">running…</span>}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 flex flex-col">
                {tools.map((t) => (
                  <ToolCallRow key={t.id} tool={t} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {shown.map((text, i) => (
          <div key={i} className="min-w-0">
            <AssistantMarkdown text={text} streaming={streaming && i === shown.length - 1} />
            {streaming && i === shown.length - 1 && <span className="animate-pulse">▍</span>}
          </div>
        ))}
      </div>
    </div>
  )
})

export const MessageRow = memo(function MessageRow({ message, streaming }: { message: ChatMessage; streaming?: boolean }): React.JSX.Element {
  const isUser = message.role === 'user'
  const empty = message.text === ''
  const images = message.images ?? []
  const tools = message.tools ?? []
  const revvaInstructionsStart = isUser ? message.text.indexOf(BUILD_COMPLETION_INSTRUCTIONS) : -1
  const userText = revvaInstructionsStart < 0 ? message.text : message.text.slice(0, revvaInstructionsStart).trimEnd()
  const revvaInstructions = revvaInstructionsStart < 0 ? null : message.text.slice(revvaInstructionsStart)
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex min-w-0 max-w-[85%] flex-col gap-2 rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {images.length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5', tools.length === 0 && images.length === 1 && 'max-w-80')}>
            {images.map((img, i) => (
              <img
                key={i}
                 src={img.data}
                 loading="lazy"
                 decoding="async"
                alt={img.name ?? 'attachment'}
                className={cn(
                  'rounded-md border border-black/10 object-cover dark:border-white/10',
                  images.length === 1 ? 'max-h-64 max-w-full' : 'size-24'
                )}
              />
            ))}
          </div>
        )}
        {isUser ? (
          <>
            {userText && (
              <div className="min-w-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={USER_BUBBLE_MD_COMPONENTS}>{userText}</ReactMarkdown>
              </div>
            )}
            {revvaInstructions && (
              <Collapsible className="group/collapsible min-w-0">
                <CollapsibleTrigger className="flex items-center gap-1 text-xs opacity-75 hover:opacity-100">
                  <ChevronRight className="size-3 shrink-0 transition-transform group-data-[open]/collapsible:rotate-90" />
                  Revva workflow instructions
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 min-w-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={USER_BUBBLE_MD_COMPONENTS}>{revvaInstructions}</ReactMarkdown>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        ) : (
          <div className="min-w-0">
            {message.thinking && <ThinkingBlock text={message.thinking} />}
            {tools.map((t) => (
              <ToolCallRow key={t.id} tool={t} />
            ))}
            {!empty && (
              <>
                {tools.length > 0 && <div className="mt-1" />}
                <AssistantMarkdown text={message.text} streaming={streaming} />
              </>
            )}
            {streaming && <span className="animate-pulse">▍</span>}
          </div>
        )}
      </div>
    </div>
  )
})

/** Faded collapsible for the model's reasoning text. */
const ThinkingBlock = memo(function ThinkingBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <Collapsible className="group/collapsible mb-1.5 text-xs">
      <CollapsibleTrigger className="flex items-center gap-1 italic text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[open]/collapsible:rotate-90" />
        Thought for a moment
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap border-l border-black/15 pl-2.5 italic text-muted-foreground dark:border-white/15">
          {text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
})

const toolStateLabel: Record<ChatToolCall['state'], string> = {
  streaming: 'preparing…',
  running: 'running…',
  completed: '',
  error: 'failed'
}

/** One tool call as a compact collapsible step: name + input on the trigger, output inside.
 *  mergeTranscript rebuilds tool objects on the active message whenever any text
 *  grows, so compare every scalar field instead of relying on object identity. */
function sameToolCall(a: ChatToolCall, b: ChatToolCall): boolean {
  return a === b || (
    a.id === b.id &&
    a.name === b.name &&
    a.state === b.state &&
    a.detail === b.detail &&
    a.output === b.output &&
    a.inputLength === b.inputLength
  )
}

const ToolCallRow = memo(function ToolCallRow({ tool }: { tool: ChatToolCall }): React.JSX.Element {
  const status = toolStateLabel[tool.state]
  return (
    <Collapsible className="group/collapsible not-prose my-1 rounded-md border border-black/10 bg-black/[0.03] text-xs dark:border-white/10 dark:bg-white/[0.04]">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[open]/collapsible:rotate-90" />
        <span className="shrink-0 font-mono font-medium">{tool.name}</span>
        {tool.detail && (
          <span className="truncate font-mono text-muted-foreground" title={tool.detail}>
            {tool.detail.split('\n')[0]}
          </span>
        )}
        {status && (
          <span className={cn('ml-auto shrink-0 italic', tool.state === 'error' ? 'text-destructive' : 'text-muted-foreground', tool.state !== 'completed' && tool.state !== 'error' && 'animate-pulse')}>
            {status}
          </span>
        )}
      </CollapsibleTrigger>
      {tool.output && (
        <CollapsibleContent>
          <pre
            className={cn(
              'max-h-56 overflow-auto border-t border-black/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap dark:border-white/10',
              tool.state === 'error' && 'text-destructive'
            )}
          >
            {tool.output}
          </pre>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}, (prev, next) => sameToolCall(prev.tool, next.tool))
