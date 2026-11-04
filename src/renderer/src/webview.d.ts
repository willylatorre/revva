/**
 * Electron's `<webview>` as a JSX element.
 *
 * The renderer never loads Electron's Node-facing typings, so this declares the
 * small surface Revva actually uses instead of borrowing `Electron.WebviewTag`.
 * Events are attached with `addEventListener`, which is what the element really
 * supports; the payload types below describe the fields the component reads.
 */
import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react'

/** The parts of Electron's `<webview>` element Revva uses. */
export interface WebviewElement extends HTMLElement {
  src: string
  partition: string
  getURL(): string
  getTitle(): string
  reload(): void
  loadURL(url: string): Promise<void>
  addEventListener(type: 'did-finish-load' | 'render-process-gone', listener: () => void): void
  addEventListener(type: 'did-fail-load', listener: (event: WebviewLoadFailure) => void): void
  removeEventListener(type: 'did-finish-load' | 'render-process-gone', listener: () => void): void
  removeEventListener(type: 'did-fail-load', listener: (event: WebviewLoadFailure) => void): void
}

/** `did-fail-load` payload; a main-frame failure is the one worth reporting. */
export interface WebviewLoadFailure extends Event {
  errorCode: number
  errorDescription: string
  isMainFrame: boolean
}

type WebviewHTMLAttributes = DetailedHTMLProps<
  HTMLAttributes<WebviewElement> & {
    src?: string
    partition?: string
    allowpopups?: string
    ref?: Ref<WebviewElement>
  },
  WebviewElement
>

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewHTMLAttributes
    }
  }
}
