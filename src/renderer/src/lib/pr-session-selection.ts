/**
 * Shared shape of the agent/model selection Revva remembers for PR sessions it
 * starts from a card or menu (the ones whose model is not a pipeline role).
 */
import type { RoleSel } from '@shared/types'
import { DEFAULT } from '@/views/RoleSelectors'
import { modelKeyOf } from '@/views/NewChatDialog'

export const PR_SESSION_SELECTION = 'prSession.selection'

/** A stored selection, normalised so a partial or legacy value still opens the pickers sanely. */
export function readSelection(value: unknown): RoleSel {
  const data = (value && typeof value === 'object' ? value : {}) as { agentID?: unknown; model?: unknown }
  const model = (data.model && typeof data.model === 'object' ? data.model : undefined) as
    | { providerID?: unknown; id?: unknown }
    | undefined
  const sel: RoleSel = {}
  if (typeof data.agentID === 'string' && data.agentID) sel.agentID = data.agentID
  if (typeof model?.providerID === 'string' && typeof model.id === 'string') {
    sel.model = { providerID: model.providerID, id: model.id }
  }
  return sel
}

/** The selection as the `RoleSelectors` pickers edit it (`DEFAULT` = inherit). */
export function selectionKeys(sel: RoleSel): { agentID: string; modelKey: string } {
  return {
    agentID: sel.agentID ?? DEFAULT,
    modelKey: sel.model ? modelKeyOf(sel.model.providerID, sel.model.id) : DEFAULT
  }
}
