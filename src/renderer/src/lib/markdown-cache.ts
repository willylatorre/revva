/**
 * Bounded parse-result cache for settled assistant Markdown (plan 020).
 *
 * react-markdown re-parses its source on every mount, so switching back to a
 * conversation re-parses every completed document. This cache stores the mdast
 * tree the remark-parse parser produced for an exact source, attached through
 * the public unified plugin protocol as a wrap around the registered parser —
 * parsing stays owned by remark-parse, and only the parse phase is skipped on
 * a hit. Run transforms and react-markdown's own rendering (URL safety,
 * MD_COMPONENTS) still execute per render.
 *
 * Renderer-memory only: transcripts are never persisted. Entry identity is the
 * source string plus a fixed config version covering the parse pipeline
 * (parser, plugins, options); rendering components are deliberately NOT part
 * of the key because no rendered output is cached. Bump CONFIG_VERSION
 * whenever the parse pipeline changes.
 *
 * Eligibility is explicit: callers attach the plugin only to final documents
 * and settled streaming blocks — never to the mutable tail or intermediate
 * streaming prefixes — so no prefix history accumulates. Trees are deep-cloned
 * on store and on read, so a cached entry is never handed to two renders and
 * can never be poisoned by downstream mutation.
 */
import type {Processor} from 'unified'

/** Fixed config version of the parse pipeline, not an arbitrary plugin key. */
const CONFIG_VERSION = 'react-markdown@10.1.0+remark-parse@11+remark-gfm@4+v1'

const MAX_ENTRIES = 256
/**
 * Estimated byte budget for retained parse results. The estimate counts the
 * UTF-16 source plus a structural walk of the AST's string fields with a flat
 * per-node/per-array overhead — an estimate, not a measured RSS figure.
 */
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const SIZE_FIELD_BYTES = 16
/** Deeper subtrees (pathological nesting) fall back to a JSON-size estimate. */
const MAX_DEPTH = 100

interface CacheEntry {
  tree: unknown
  bytes: number
}

/** Insertion-ordered Map: a hit delete+set-refreshes it, so eviction is true LRU. */
const entries = new Map<string, CacheEntry>()
let totalBytes = 0

function byteLength(value: string): number {
  return value.length * 2 // UTF-16 estimate
}

function estimateNodeBytes(node: unknown, depth: number): number {
  if (typeof node !== 'object' || node === null) return byteLength(String(node))
  const record = node as Record<string, unknown>
  let bytes = byteLength(String(record.type)) + SIZE_FIELD_BYTES
  for (const field of ['value', 'lang', 'meta', 'url', 'title', 'alt']) {
    const value = record[field]
    if (typeof value === 'string') bytes += byteLength(value)
  }
  const children = record.children
  if (Array.isArray(children)) {
    bytes += SIZE_FIELD_BYTES
    for (const child of children) {
      bytes += depth < MAX_DEPTH ? estimateNodeBytes(child, depth + 1) : byteLength(JSON.stringify(child))
    }
  }
  return bytes
}

function estimateEntryBytes(source: string, tree: unknown): number {
  return byteLength(CONFIG_VERSION) + byteLength(source) + estimateNodeBytes(tree, 0)
}

function evictOverflow(): void {
  // Newest entries sit at the back of the Map, so evicting from the front can
  // never drop the entry just inserted while more than one entry remains.
  while (entries.size > MAX_ENTRIES || (totalBytes > MAX_TOTAL_BYTES && entries.size > 1)) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) break
    const evicted = entries.get(oldestKey)
    if (evicted) {
      totalBytes -= evicted.bytes
      entries.delete(oldestKey)
    }
  }
}

/**
 * Parse through the cache: a hit returns a fresh deep copy of the stored tree
 * (refreshing recency); a miss parses, stores a copy when the entry fits the
 * full budget (oversize sources bypass without disturbing other entries), and
 * returns the fresh tree. Cache machinery must never break rendering, so any
 * unexpected failure degrades to a plain parse.
 */
export function parseCachedMarkdown<Tree>(source: string, parseFresh: () => Tree): Tree {
  const key = `${CONFIG_VERSION}\u0000${source}`
  try {
    const hit = entries.get(key)
    if (hit) {
      entries.delete(key)
      entries.set(key, hit)
      return structuredClone(hit.tree) as Tree
    }
  } catch {
    return parseFresh()
  }
  const tree = parseFresh()
  try {
    const bytes = estimateEntryBytes(source, tree)
    if (bytes <= MAX_TOTAL_BYTES) {
      const existing = entries.get(key)
      if (existing) {
        totalBytes -= existing.bytes
        entries.delete(key)
      }
      entries.set(key, {tree: structuredClone(tree), bytes})
      totalBytes += bytes
      evictOverflow()
    }
  } catch {
    // A failed store only costs a future cache hit.
  }
  return tree
}

/**
 * Public plugin-protocol wrap (plan 020): attach after remark-parse; at freeze
 * it captures the parser registered by remark-parse and replaces it with one
 * that consults the cache first. remark-parse's parser reads processor data at
 * call time, so GFM extensions attached after this plugin still apply, and the
 * returned trees flow through the rest of the pipeline unchanged.
 */
export function remarkCachedMarkdownParse(this: Processor): void {
  const self = this
  const registered = self.parser
  if (!registered) return // nothing to wrap: silently stay uncached
  self.parser = (source, file) => parseCachedMarkdown(source, () => registered.call(self, source, file))
}
