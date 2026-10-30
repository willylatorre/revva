import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { MD_COMPONENTS } from '@/components/message-markdown'
import { remarkCachedMarkdownParse } from '@/lib/markdown-cache'
import { splitStreamingMarkdown } from '@/lib/streaming-markdown'

const PLAIN_REMARK_PLUGINS: PluggableList = [remarkGfm]
// Cache-enabled pipeline: the wrap sits after remark-gfm, whose extensions
// remark-parse reads at parse time, so GFM keeps applying on hits and misses.
const CACHED_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkCachedMarkdownParse]

/**
 * Pace Markdown parsing during streaming without delaying the completed message.
 * `cache` opts this exact source into the bounded completed-parse cache (plan
 * 020): only final documents and settled blocks qualify, never the mutable
 * tail or intermediate streaming prefixes.
 */
export const RenderedAssistantMarkdown = memo(function RenderedAssistantMarkdown({ text, cache = false }: { text: string; cache?: boolean }): React.JSX.Element {
  return <ReactMarkdown remarkPlugins={cache ? CACHED_REMARK_PLUGINS : PLAIN_REMARK_PLUGINS} components={MD_COMPONENTS}>{text}</ReactMarkdown>
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
        // Settled sources repeat verbatim across stream updates, so they are
        // cache-eligible; memo still skips their render while unchanged.
        <RenderedAssistantMarkdown key={i} text={block} cache />
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
  // parse reconciles whatever the streaming split was showing. The final
  // source is cache-eligible, so remounting a completed message later is a hit.
  if (!streaming) return <RenderedAssistantMarkdown text={text} cache />
  return <StreamedAssistantMarkdown text={rendered} />
})
