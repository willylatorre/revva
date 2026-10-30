/**
 * Live one-line activity for delegated children. Reviewers have the review
 * ledger with per-second activity strings; children only ever showed a static
 * "Running", so a quiet model with chatty tools looked stuck. This maps the
 * same events through the same text helper and pushes them coalesced to ~1/s.
 */
import { eventBus, runningSignal, type RawEvent } from './bus'
import { sessionIndex } from './session-index'
import { ActivityTracker } from './activity-text'
import { pushToWindows } from '../push'
import type { AgentActivity } from '@shared/types'

class AgentActivityMeter {
  private wired = false
  private trackers = new Map<string, ActivityTracker>()
  private latest = new Map<string, AgentActivity>()
  private dirty = new Set<string>()
  private timer: NodeJS.Timeout | undefined

  wire(): void {
    if (this.wired) return
    this.wired = true
    eventBus.on('event', (event: RawEvent) => this.onEvent(event))
  }

  /** Snapshot for surfaces that mount while agents are already running. */
  list(): AgentActivity[] {
    return [...this.latest.values()].filter((item) => item.activity)
  }

  forget(sessionId: string): void {
    this.trackers.delete(sessionId)
    if (this.latest.delete(sessionId)) this.dirty.add(sessionId)
    this.schedule()
  }

  private onEvent(event: RawEvent): void {
    const sessionId = event.data?.sessionID
    if (typeof sessionId !== 'string') return
    if (event.type === 'session.deleted') {
      this.forget(sessionId)
      return
    }
    // Reviewer/fixer sessions report through the review ledger instead.
    if (sessionIndex.kindOf(sessionId) !== 'agent') return
    if (runningSignal(event) === false) {
      // An empty entry clears the live line once the row itself shows its outcome.
      this.trackers.delete(sessionId)
      this.forget(sessionId)
      return
    }
    let tracker = this.trackers.get(sessionId)
    if (!tracker) {
      tracker = new ActivityTracker()
      this.trackers.set(sessionId, tracker)
    }
    const activity = tracker.describe(event)
    if (activity) {
      this.latest.set(sessionId, { sessionId, activity, lastActivityAt: Date.now() })
      this.dirty.add(sessionId)
      this.schedule()
    }
  }

  /** Coalesce streaming/tool bursts; the activity line need not redraw per token. */
  private schedule(): void {
    if (!this.dirty.size || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const items = [...this.dirty].map((id) => this.latest.get(id) ?? { sessionId: id })
      this.dirty.clear()
      if (items.length) pushToWindows({ kind: 'agent.activity', items })
    }, 1_000)
    this.timer.unref?.()
  }
}

export const agentActivityMeter = new AgentActivityMeter()
