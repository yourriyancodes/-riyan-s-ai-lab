/**
 * Wire contract shared by the RAVEN API route and the browser client.
 * This module must stay dependency-free so it is safe in both runtimes.
 */

export const RAVEN_STATES = [
  'IDLE',
  'LISTENING',
  'UNDERSTANDING',
  'RESEARCHING',
  'REASONING',
  'PLANNING',
  'WAITING',
  'EXECUTING',
  'VERIFYING',
  'SPEAKING',
  'SUCCESS',
  'WARNING',
  'ERROR',
  'OFFLINE',
] as const

export type RavenState = (typeof RAVEN_STATES)[number]

/** Conversation turn kept in short-term memory. */
export type RavenTurn = {
  role: 'user' | 'raven'
  text: string
}

export type RavenUsage = {
  promptTokens?: number
  candidateTokens?: number
  totalTokens?: number
}

export type RavenSource = {
  id: string
  label: string
}

export type RavenSuccess = {
  state: 'SUCCESS'
  output: string
  provider: string
  model: string
  grounded: boolean
  sources: RavenSource[]
  toolUsed?: string
  usage?: RavenUsage
  trace: RavenState[]
}

export type RavenFailure = {
  state: Exclude<RavenState, 'SUCCESS'>
  code: string
  message: string
  availableStates?: readonly RavenState[]
  retryAfterSeconds?: number
}

export type RavenResponse = RavenSuccess | RavenFailure

export const RAVEN_MAX_INPUT = 4000
export const RAVEN_MAX_HISTORY_TURNS = 8
export const RAVEN_MAX_HISTORY_CHARS = 2000
export const RAVEN_MAX_OUTPUT_CHARS = 6000

export type ParsedRavenRequest =
  | { ok: true; input: string; history: RavenTurn[] }
  | { ok: false; code: string; message: string; status: number }

function readString(source: unknown, key: string): string {
  if (typeof source !== 'object' || source === null || !(key in source)) return ''
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Accepts the canonical `{ input, history }` body and the legacy `{ message }`
 * body that older clients sent, so a cached bundle cannot break the endpoint.
 * History is bounded so a client cannot inflate the prompt arbitrarily.
 */
export function parseRavenRequest(body: unknown): ParsedRavenRequest {
  const rawInput = readString(body, 'input') || readString(body, 'message')
  const input = rawInput.trim()

  if (!input) {
    return { ok: false, code: 'INPUT_REQUIRED', message: 'RAVEN needs an input.', status: 400 }
  }

  if (input.length > RAVEN_MAX_INPUT) {
    return {
      ok: false,
      code: 'INPUT_TOO_LONG',
      message: `Input is limited to ${RAVEN_MAX_INPUT} characters.`,
      status: 413,
    }
  }

  return { ok: true, input, history: sanitizeHistory(body) }
}

/** Keeps only well-formed turns, newest last, bounded by count and characters. */
export function sanitizeHistory(body: unknown): RavenTurn[] {
  if (typeof body !== 'object' || body === null || !('history' in body)) return []
  const raw = (body as Record<string, unknown>).history
  if (!Array.isArray(raw)) return []

  const turns: RavenTurn[] = []
  let usedChars = 0

  for (const entry of raw.slice(-RAVEN_MAX_HISTORY_TURNS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const role = (entry as Record<string, unknown>).role
    const text = (entry as Record<string, unknown>).text
    if ((role !== 'user' && role !== 'raven') || typeof text !== 'string') continue

    const clean = text.trim()
    if (!clean) continue
    if (usedChars + clean.length > RAVEN_MAX_HISTORY_CHARS) break

    usedChars += clean.length
    turns.push({ role, text: clean })
  }

  return turns
}
