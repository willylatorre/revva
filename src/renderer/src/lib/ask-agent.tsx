import { createContext, useContext, useState, type ReactNode } from 'react'
import { CircleCheck, Loader2, MessageSquareWarning } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * "Send this to the chat" — the fallback for every action inside a ticket or PR
 * conversation. Revva's buttons can fail for reasons only the agent can fix (a
 * pre-push hook rejecting lint, a dependency scan, a dirty tree, a failing test):
 * the error text itself is the brief. The provider is mounted by the conversation
 * that owns the buttons, so each control reports into the chat it belongs to
 * without threading a sender through every component.
 */
export type AskAgent = (text: string) => Promise<void>

const AskAgentContext = createContext<AskAgent | null>(null)

export function AskAgentProvider({ ask, children }: { ask?: AskAgent; children: ReactNode }): React.JSX.Element {
  return <AskAgentContext.Provider value={ask ?? null}>{children}</AskAgentContext.Provider>
}

/** The conversation's sender, or null when this surface has no writable chat (read-only reviewers). */
export function useAskAgent(): AskAgent | null {
  return useContext(AskAgentContext)
}

/** IPC rejections arrive wrapped in Electron's transport prefix; show the real sentence. */
export function cleanError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

/** The message a failed action sends: the error is the whole brief, plus what to do. */
export function fixRequest(action: string, error: string): string {
  const detail = cleanError(error).trim() || 'It failed without a message.'
  return [
    `Revva's "${action}" action failed while working on this ticket. Here is the exact error:`,
    '',
    '```',
    detail.slice(0, 6000),
    '```',
    '',
    'Please diagnose and fix the cause in this checkout — do not just retry. If the failure comes from a hook, a lockfile, a dependency scan or a test, make the code those checks are asking for. When you are done, say what changed so the action can be retried.'
  ].join('\n')
}

/**
 * Icon-only, deliberately recognizable fallback: the warning-bubble marks
 * "ask the agent to fix this" wherever an action failed. Renders nothing when the
 * surrounding chat cannot accept a message.
 *
 * `onSent` fires after delivery so the surface holding the stale error can get out
 * of the way — a dialog or popover left open on an error the agent is already
 * fixing just sits there lying.
 */
export function SendErrorToChatButton({ action, error, className, label, onSent }: {
  /** Human name of the failed control, e.g. "git push" — the agent needs to know what it is fixing. */
  action: string
  error: string
  className?: string
  label?: string
  onSent?: () => void
}): React.JSX.Element | null {
  const ask = useAskAgent()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  if (!ask) return null
  const send = (): void => {
    setState('sending')
    void ask(fixRequest(action, error))
      .then(() => {
        setState('sent')
        toast.success('Sent to the chat', { description: `The agent has the ${action} error and will work on a fix.` })
        onSent?.()
      })
      .catch((err: unknown) => {
        setState('idle')
        toast.error('Could not send the error to the chat', {
          description: err instanceof Error ? err.message : String(err)
        })
      })
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="warning"
          className={cn('shrink-0', className)}
          aria-label={label ?? `Send this ${action} error to the chat and ask for a fix`}
          disabled={state === 'sending' || state === 'sent'}
          onClick={send}
        >
          {state === 'sending' ? <Loader2 className="animate-spin" />
            : state === 'sent' ? <CircleCheck />
            : <MessageSquareWarning />}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-[11px]">
        {state === 'sent' ? `The ${action} error was sent to this conversation.` : `Send this ${action} error to the chat and ask the agent to fix it.`}
      </TooltipContent>
    </Tooltip>
  )
}

/** Error line + its fallback in one row — the shape almost every panel needs. */
export function ActionError({ action, error, className, onSent }: {
  action: string
  error: string
  className?: string
  /** Close the dialog/popover holding this error once the agent has it. */
  onSent?: () => void
}): React.JSX.Element {
  return (
    <div role="alert" className={cn('flex items-start gap-2 text-xs text-destructive', className)}>
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</p>
      <SendErrorToChatButton action={action} error={error} onSent={onSent} />
    </div>
  )
}
