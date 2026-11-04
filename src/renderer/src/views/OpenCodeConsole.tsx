import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, RotateCw, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionError } from '@/lib/ask-agent'
import type { WebviewElement, WebviewLoadFailure, WebviewProcessGone } from '@/webview'

/**
 * OpenCode's own web interface, showing one session inside Revva.
 *
 * The page is a `<webview>` on a dedicated in-memory session: the pairing
 * cookie lives there, never on disk, and it shares no storage with Revva's
 * renderer. Navigation inside the guest is OpenCode's business — only the
 * initial load, a crash and a hard failure are reported here.
 */
export function OpenCodeConsole({ sessionId }: { sessionId: string }): React.JSX.Element {
  // A restarted service signs cookies with a new secret, so its error page can
  // sit on screen while the renderer still thinks everything is fine. Waiting
  // for the endpoint to change is not enough: the service usually comes back on
  // the same port. Instead, count reconnects and remount the guest on each one,
  // which also re-pairs the cookie in main.
  const [generation, setGeneration] = useState(0)
  const sawDisconnect = useRef(false)
  useEffect(() => window.revva.events.on((event) => {
    if (event.kind !== 'service') return
    if (event.status.state !== 'connected') {
      sawDisconnect.current = true
      return
    }
    if (!sawDisconnect.current) return
    sawDisconnect.current = false
    setGeneration((count) => count + 1)
  }), [])
  const target = useQuery({
    // Re-resolve the link after every reconnect: main verifies the stored
    // cookie and pairs again when the service replaced it.
    queryKey: ['opencode-ui', sessionId, generation],
    queryFn: () => window.revva.session.openCodeUi(sessionId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false
  })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Auto-remounting a guest that ends routinely must not become a reload loop.
  // A successful load resets the count, so only repeated death without a load
  // reaches the limit and stops trying.
  const autoReloads = useRef(0)
  const webviewRef = useRef<WebviewElement | null>(null)

  useEffect(() => {
    const node = webviewRef.current
    if (!node || !target.data) return
    setLoadError(null)
    setLoading(true)
    // `did-fail-load` covers the main frame and subframes; only the main frame's
    // failure leaves a blank page worth reporting. Never call `getURL()` or
    // `loadURL()` on this element: both throw until it has attached to the DOM
    // and emitted `dom-ready`, and that throw unmounts the whole chat.
    const onLoaded = (): void => {
      autoReloads.current = 0
      setLoading(false)
    }
    const onFailed = (event: WebviewLoadFailure): void => {
      if (!event.isMainFrame) return
      // -3 is ERR_ABORTED, emitted for ordinary in-page navigations.
      if (event.errorCode === -3) return
      setLoading(false)
      setLoadError(`OpenCode's interface did not load${event.errorDescription ? `: ${event.errorDescription}` : ''} (${event.errorCode}).`)
    }
    // The guest process ends for routine reasons too: the tab was closed, the
    // process was discarded under memory pressure, or it exited cleanly. Those
    // are not crashes, and showing an error panel for them leaves a dead panel
    // that only a manual retry clears. Remount instead, which reloads the same
    // session; only a real failure is reported, together with its reason.
    const onGone = (event: WebviewProcessGone): void => {
      if (event.reason === 'clean-exit' || event.reason === 'killed' || event.reason === 'memory-eviction') {
        if (autoReloads.current >= 3) {
          setLoading(false)
          setLoadError('OpenCode’s interface keeps stopping. Switch to OpenCode in the browser, or try again.')
          return
        }
        autoReloads.current += 1
        setLoadError(null)
        setLoading(true)
        setGeneration((count) => count + 1)
        return
      }
      setLoading(false)
      setLoadError(
        event.reason === 'oom'
          ? 'OpenCode’s interface ran out of memory. Close some other views and try again.'
          : `OpenCode’s interface stopped unexpectedly (${event.reason}${event.exitCode ? `, exit ${event.exitCode}` : ''}).`
      )
    }
    node.addEventListener('did-finish-load', onLoaded)
    node.addEventListener('did-fail-load', onFailed)
    node.addEventListener('render-process-gone', onGone)
    return () => {
      node.removeEventListener('did-finish-load', onLoaded)
      node.removeEventListener('did-fail-load', onFailed)
      node.removeEventListener('render-process-gone', onGone)
    }
    // `generation` remounts the element, so the listeners must re-attach to the
    // new one even though the resolved link is the same.
  }, [target.data, generation])

  const retry = (): void => {
    // One action, one path: the generation is part of the query key, so bumping
    // it refetches the link and remounts the element. Invalidating the query as
    // well would resolve the link twice for a single click.
    autoReloads.current = 0
    setLoadError(null)
    setLoading(true)
    setGeneration((count) => count + 1)
  }
  const openInBrowser = useMutation({
    mutationFn: async () => {
      if (!target.data) throw new Error('The OpenCode interface is not ready yet.')
      await window.revva.shell.openExternal(target.data.url)
    }
  })

  if (target.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" />
        Connecting to the OpenCode interface…
      </div>
    )
  }
  if (target.isError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-start gap-3">
          <ActionError action="open the OpenCode interface" error={target.error instanceof Error ? target.error.message : String(target.error)} className="text-sm" />
          <Button size="sm" variant="outline" onClick={() => void target.refetch()}>
            <RotateCw data-icon="inline-start" /> Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Electron sizes a <webview> poorly from flex alone, so it fills an
          absolutely positioned box. React does not know the tag either; the
          declaration in webview.d.ts types it without changing the element. */}
      <webview
        ref={webviewRef}
        // A reconnect keeps the same URL, so `src` alone cannot force a fresh
        // navigation. Remounting on the generation counter does, and that is
        // what picks up the re-paired cookie.
        key={generation}
        src={target.data.url}
        partition={target.data.partition}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'flex' }}
      />
      {loading && !loadError && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10" role="status">
          <span className="flex items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="size-3.5 animate-spin" /> Loading OpenCode…
          </span>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-6">
          <div className="flex max-w-md flex-col items-start gap-3">
            <ActionError action="open the OpenCode interface" error={loadError} className="text-sm" />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={retry}>
                <RotateCw data-icon="inline-start" /> Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openInBrowser.mutate()}>
                <SquareArrowOutUpRight data-icon="inline-start" /> Open in browser
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
