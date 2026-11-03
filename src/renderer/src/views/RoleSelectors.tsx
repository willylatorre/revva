import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { ModelRef } from '@shared/types'
import { cn } from '@/lib/utils'
import { modelKeyOf, parseModelKey } from './NewChatDialog'

export const DEFAULT = '__default__'

/** Agent + model pickers for one pipeline role; 'Service default' = inherit. */
export function RoleSelectors({
  agentID,
  modelKey,
  variant,
  onAgent,
  onModel,
  onVariant
}: {
  agentID: string
  modelKey: string
  variant?: string
  onAgent: (v: string) => void
  onModel: (v: string) => void
  onVariant?: (v: string) => void
}): React.JSX.Element {
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => window.revva.inventory.agents() })
  const models = useQuery({ queryKey: ['models'], queryFn: () => window.revva.inventory.models() })
  const variants = models.data?.find((m) => modelKeyOf(m.providerID, m.id) === modelKey)?.variants ?? []
  return (
    <div className={cn('grid gap-2', onVariant && variants.length ? 'grid-cols-3' : 'grid-cols-2')}>
      <Select value={agentID} onValueChange={(v) => onAgent(v ?? DEFAULT)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>Agent: default</SelectItem>
          {(agents.data ?? []).map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name || a.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={modelKey} onValueChange={(v) => onModel(v ?? DEFAULT)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>Model: default</SelectItem>
          {(models.data ?? []).map((m) => (
            <SelectItem key={modelKeyOf(m.providerID, m.id)} value={modelKeyOf(m.providerID, m.id)} disabled={!!m.gated} title={m.gated}>
              {m.name || m.id}
              <span className="ml-1 text-muted-foreground">{m.providerID}</span>
              {m.gated && <span className="ml-1 text-[10px] text-amber-600">needs local endpoint</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {onVariant && variants.length > 0 && (
        <Select value={variant ?? DEFAULT} onValueChange={(v) => onVariant(v ?? DEFAULT)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Effort: model default</SelectItem>
            {variants.map((v) => (
              <SelectItem key={v} value={v}>
                Effort: {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export function selOrUndefined(agentID: string, modelKey: string, variant?: string): { agentID?: string; model?: ModelRef } | undefined {
  const out: { agentID?: string; model?: ModelRef } = {}
  if (agentID !== DEFAULT) out.agentID = agentID
  if (modelKey !== DEFAULT) {
    out.model = parseModelKey(modelKey)
    if (variant && variant !== DEFAULT) out.model.variant = variant
  }
  return Object.keys(out).length > 0 ? out : undefined
}
