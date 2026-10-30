import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MD_COMPONENTS } from '@/components/message-markdown'
import { splitStreamingMarkdown } from '@/lib/streaming-markdown'

/** Pace Markdown parsing during streaming without delaying the completed message. */
export const RenderedAssistantMarkdown = memo(function RenderedAssistantMarkdown({ text }: { text: string }): React.JSX.Element {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
})

/**
 * Streaming render that re-parses only the mutable tail: settled top-level
 * blocks keep their source strings, so their memoized roots skip the parse
 * while text appends. Roots are flat keyed Fragment children — no DOM wrapper,
 * so first/last paragraph margins match a single-root parse. Whenever the
 * conservative scan finds no provable boundary (or returns null for
 * document-wide syntax), this degrades to exactly the whole-document parse.
 */
const StreamedAssistantMarkdown = memo(function StreamedAssistantMarkdown({ text }: { text: string }): React.JSX.Element {
  const split = useMemo(() => splitStreamingMarkdown(text), [text])
  if (!split || split.blocks.length === 0) return <RenderedAssistantMarkdown text={text} />
  return (
    <>
      {split.blocks.map((block, i) => (
        <RenderedAssistantMarkdown key={i} text={block} />
      ))}
      <RenderedAssistantMarkdown text={split.tail} />
    </>
  )
})

export const AssistantMarkdown = memo(function AssistantMarkdown({ text, streaming }: { text: string; streaming?: boolean }): React.JSX.Element {
  const latest = useRef(text)
  const [rendered, setRendered] = useState(text)
  useEffect(() => {
    latest.current = text
  }, [text])
  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => setRendered(latest.current), 150)
    return () => window.clearInterval(timer)
  }, [streaming])
  // Completion renders the whole document immediately — the authoritative
  // parse reconciles whatever the streaming split was showing.
  if (!streaming) return <RenderedAssistantMarkdown text={text} />
  return <StreamedAssistantMarkdown text={rendered} />
})
