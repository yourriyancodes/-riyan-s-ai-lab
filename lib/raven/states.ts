/**
 * RAVEN's execution states — one place, so a state name cannot mean two things.
 *
 * The list started life in `data/siteConfig.ts` (`ravenStates`) and in
 * `lib/ravenClient.ts` as a hand-written union, with a compile-time guard in
 * `lib/ravenStore.ts` asserting they agree. That guard still works, because this
 * union is a *superset*: every state the page already knows is legal here.
 *
 * `THINKING` and `VISION` are the two names the brain specification adds:
 * THINKING is a provider round-trip in flight, VISION is a camera-driven turn. A
 * state here must correspond to something that actually happens — see the
 * transition table below, which `states.ts` enforces rather than decorates.
 */
import type { RavenState } from './types'

/** Every state RAVEN can be in, in the canonical display order. */
export const RAVEN_STATES = [
  'IDLE',
  'LISTENING',
  'UNDERSTANDING',
  'THINKING',
  'RESEARCHING',
  'REASONING',
  'PLANNING',
  'EXECUTING',
  'VERIFYING',
  'SPEAKING',
  'VISION',
  'WAITING',
  'SUCCESS',
  'WARNING',
  'ERROR',
  'OFFLINE',
] as const satisfies readonly RavenState[]

/**
 * Allowed transitions. Empty array = terminal for this turn (only `IDLE` may
 * follow, which every path ends with). The point of the table is that a
 * response cannot claim to have verified something it never entered:
 * `VERIFYING` is only reachable from `EXECUTING`/`REASONING`.
 */
const TRANSITIONS: Record<RavenState, readonly RavenState[]> = {
  IDLE: ['LISTENING', 'UNDERSTANDING', 'THINKING', 'RESEARCHING', 'REASONING', 'VISION', 'OFFLINE', 'ERROR'],
  // A turn can carry a camera context alongside the utterance, so VISION belongs here;
  // VISION → UNDERSTANDING below is what keeps the chain legal either way.
  LISTENING: ['UNDERSTANDING', 'VISION', 'IDLE', 'ERROR', 'OFFLINE'],
  UNDERSTANDING: ['THINKING', 'RESEARCHING', 'REASONING', 'PLANNING', 'VERIFYING', 'SPEAKING', 'OFFLINE', 'WARNING', 'ERROR', 'IDLE'],
  THINKING: ['REASONING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'OFFLINE', 'WARNING', 'ERROR', 'IDLE'],
  // A turn can go straight from retrieval to verification: when nothing needed to be
  // executed there is nothing to execute, and forcing an EXECUTING phase would be theatre.
  RESEARCHING: ['REASONING', 'PLANNING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'OFFLINE', 'WARNING', 'ERROR', 'IDLE'],
  REASONING: ['PLANNING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'OFFLINE', 'WARNING', 'ERROR', 'IDLE'],
  PLANNING: ['EXECUTING', 'WAITING', 'REASONING', 'WARNING', 'ERROR', 'IDLE'],
  EXECUTING: ['VERIFYING', 'REASONING', 'WARNING', 'ERROR', 'IDLE'],
  VERIFYING: ['SPEAKING', 'REASONING', 'EXECUTING', 'WARNING', 'ERROR', 'IDLE'],
  SPEAKING: ['IDLE', 'SUCCESS', 'WARNING', 'ERROR'],
  VISION: ['UNDERSTANDING', 'REASONING', 'THINKING', 'IDLE', 'WARNING', 'ERROR'],
  WAITING: ['EXECUTING', 'REASONING', 'WARNING', 'ERROR', 'IDLE'],
  SUCCESS: ['IDLE'],
  WARNING: ['IDLE', 'SPEAKING', 'ERROR'],
  ERROR: ['IDLE', 'OFFLINE'],
  OFFLINE: ['IDLE', 'ERROR'],
}

/** States in which RAVEN is mid-turn; the console shows its working row for these. */
export const WORKING_STATES: ReadonlySet<RavenState> = new Set<RavenState>([
  'UNDERSTANDING',
  'THINKING',
  'RESEARCHING',
  'REASONING',
  'PLANNING',
  'WAITING',
  'EXECUTING',
  'VERIFYING',
])

export function isRavenState(value: unknown): value is RavenState {
  return typeof value === 'string' && (RAVEN_STATES as readonly string[]).includes(value)
}

export function canTransition(from: RavenState, to: RavenState): boolean {
  if (from === to) return true
  return TRANSITIONS[from].includes(to)
}

export function allowedNextStates(from: RavenState): readonly RavenState[] {
  return TRANSITIONS[from]
}

/**
 * Move `from` → `to`, falling back instead of lying.
 *
 * A refused transition never throws into the user's request: it returns the
 * nearest legal state and records why, because "RAVEN crashed while reasoning"
 * is a worse outcome than "RAVEN skipped a state it was not allowed to enter".
 */
export function transition(from: RavenState, to: RavenState): { state: RavenState; refused?: string } {
  if (canTransition(from, to)) return { state: to }
  const allowed = TRANSITIONS[from]
  if (allowed.includes('REASONING') && to !== 'REASONING') return { state: 'REASONING', refused: `${from} → ${to} is not legal; routed through REASONING` }
  if (allowed.includes('WARNING')) return { state: 'WARNING', refused: `${from} → ${to} is not legal; degraded to WARNING` }
  return { state: allowed[0] ?? 'IDLE', refused: `${from} → ${to} is not legal; moved to ${allowed[0] ?? 'IDLE'}` }
}
