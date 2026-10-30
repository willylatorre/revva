import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Rename a conversation. The name is Revva's own (sidebar/header everywhere);
 * the main process mirrors it onto the OpenCode session best-effort so other
 * clients see the same title. Ticket keys are untouched — a rename changes
 * only the conversation's display name.
 */
export function RenameChatDialog({ open, onOpenChange, sessionId, currentTitle }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentTitle: string
}): React.JSX.Element {
  const qc = useQueryClient()
  const [title, setTitle] = useState(currentTitle)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle(currentTitle)
    // Select the whole name so the first keystroke replaces it.
    const timer = requestAnimationFrame(() => inputRef.current?.select())
    return () => cancelAnimationFrame(timer)
  }, [open, currentTitle])

  const save = (): void => {
    const next = title.trim()
    if (!next || busy) return
    setBusy(true)
    void window.revva.chat
      .rename(sessionId, next)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['chats'] })
        void qc.invalidateQueries({ queryKey: ['works'] })
        onOpenChange(false)
      })
      .catch((err) => alert(`Could not rename: ${(err as Error).message}`))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>The name Revva shows for this conversation. Ticket links are unchanged.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            aria-label="Conversation name"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
