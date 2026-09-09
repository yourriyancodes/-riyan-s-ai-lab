/**
 * One line per turn, on stdout, built only from values that were actually measured.
 *
 * Everything here is already in the response `metadata`, so this is not a second source of
 * truth — it is the same numbers made visible when nobody is looking at a response body.
 * The fields are the ones worth having on a server: what was asked (as an intent, not as
 * text), how it was answered (mode), what ran (tools and their real statuses), whether a
 * provider was involved, whether the answer was verified, and how long it took.
 *
 * **No user text is ever logged.** Message content belongs in the conversation store, where
 * the user can see it and delete it, not in a log line that outlives both and gets shipped to
 * whatever aggregates stdout. Session and conversation ids are hashed to a short token: enough
 * to correlate the lines of one conversation, not enough to identify anyone.
 *
 * `RAVEN_LOG=0` silences it. The route is exercised in-process by the test suite, which sets
 * this so its output stays readable; production defaults to logging.
 */
import { createHash } from 'node:crypto'
import type { RavenMode, RavenState } from './types'

const enabled = () => process.env.RAVEN_LOG !== '0'

/** Stable, non-reversible, greppable. */
const token = (value: string): string => createHash('sha256').update(value).digest('base64url').slice(0, 8)

export type RavenTurnLog = {
  status: number
  sessionId: string
  conversationId: string
  inputType: string
  intent?: string | undefined
  intentConfidence?: number | undefined
  mode?: RavenMode | undefined
  state?: RavenState | undefined
  verified?: boolean | undefined
  steps?: number | undefined
  toolsUsed?: readonly string[] | undefined
  toolStatuses?: Readonly<Record<string, number>> | undefined
  provider?: string | null | undefined
  breakerOpen?: boolean | undefined
  dbDriver?: string | undefined
  memoryRetrieved?: number | undefined
  memoryStored?: number | undefined
  latencyMs: number
  inputChars?: number | undefined
  contextChars?: number | undefined
  truncated?: boolean | undefined
  degradedFrom?: string | undefined
  errorCode?: string | undefined
}

/** `a=1 b=2` with only the fields that exist, so a missing value is absent, not "undefined". */
const pairs = (entries: [string, string | number | boolean | undefined][]): string =>
  entries.filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}=${value}`).join(' ')

export function logTurn(event: RavenTurnLog): void {
  if (!enabled()) return
  const statuses = event.toolStatuses && Object.keys(event.toolStatuses).length ? Object.entries(event.toolStatuses).map(([status, count]) => `${status}:${count}`).join('/') : undefined
  const line = pairs([
    ['session', token(event.sessionId)],
    ['conv', token(event.conversationId)],
    ['via', event.inputType],
    ['status', event.status],
    ['intent', event.intent],
    ['conf', event.intentConfidence === undefined ? undefined : event.intentConfidence.toFixed(2)],
    ['mode', event.mode],
    ['state', event.state],
    ['verified', event.verified],
    ['steps', event.steps],
    ['tools', event.toolsUsed?.length ? event.toolsUsed.join('+') : undefined],
    ['toolruns', statuses],
    ['provider', event.provider === null ? 'none' : event.provider],
    ['breaker', event.breakerOpen === undefined ? undefined : event.breakerOpen ? 'open' : 'closed'],
    ['db', event.dbDriver],
    ['mem', event.memoryRetrieved === undefined && event.memoryStored === undefined ? undefined : `+${event.memoryStored ?? 0}/-${event.memoryRetrieved ?? 0}`],
    ['chars', event.inputChars],
    ['ctx', event.contextChars],
    ['truncated', event.truncated || undefined],
    ['degraded', event.degradedFrom],
    ['error', event.errorCode],
    ['ms', event.latencyMs],
  ])
  // A refused or failed turn is a warning; an answered one is information. That is the only
  // judgement this module makes, and it is derived from the status code, not from a guess.
  if (event.status >= 400) console.warn(`raven.turn ${line}`)
  else console.info(`raven.turn ${line}`)
}

/**
 * Rejections (bad body, empty message, oversized, rate-limited) never reach the brain, so
 * they have no intent or mode to report. They still get one line, because "the console is
 * acting up" and "the limiter is on" are different incidents and only distinguishable here.
 */
export function logRejection(reason: string, status: number, startedAt: number, detail?: string): void {
  if (!enabled()) return
  console.warn(`raven.reject ${pairs([['reason', reason], ['status', status], ['ms', Date.now() - startedAt], ['detail', detail]])}`)
}
