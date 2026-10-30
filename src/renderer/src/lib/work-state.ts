import type { WorkState } from '@shared/types'

export const workStateLabels: Record<WorkState, string> = {
  READY: 'Ready',
  BUILDING: 'Building',
  REVIEW: 'In review',
  FIXING: 'Fixing',
  APPROVED: 'Approved',
  WAITING_HUMAN: 'Needs attention',
  REWORK: 'Reworking',
  SHIPPED: 'Shipped',
  ABANDONED: 'Abandoned'
}

const ACTIVE_WORK_STATES: ReadonlySet<WorkState> = new Set([
  'BUILDING', 'REVIEW', 'FIXING', 'REWORK', 'WAITING_HUMAN'
])

/** Ticket work shown as active in the app's sidebar and Inbox meter. */
export function isActiveWorkState(state: WorkState): boolean {
  return ACTIVE_WORK_STATES.has(state)
}

/** Compact state text shared with the sidebar's active-work chips. */
export function activeWorkLabel(state: WorkState): string {
  return state === 'WAITING_HUMAN' ? 'needs you' : state.toLowerCase()
}

/** State colors shared by the top bar's pipeline badge and the running-work list. */
export function workStateTone(state: WorkState): string {
  return state === 'BUILDING'
    ? 'border-sky-500/40 text-sky-700 dark:text-sky-400'
    : state === 'REVIEW'
      ? 'border-violet-500/40 text-violet-700 dark:text-violet-400'
      : state === 'FIXING'
        ? 'border-orange-500/40 text-orange-700 dark:text-orange-400'
        : state === 'REWORK'
          ? 'border-pink-500/40 text-pink-700 dark:text-pink-400'
          : state === 'WAITING_HUMAN'
            ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
            : 'text-muted-foreground'
}
