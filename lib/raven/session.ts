/**
 * Session and identity plumbing for the API layer.
 *
 * A portfolio site has no login, so "session" here means: a random, unguessable id the
 * browser keeps in localStorage, echoed back by the client, and — only when
 * `SESSION_SECRET` exists — also issued as an HttpOnly cookie with an HMAC so the
 * server can tell a genuine id from a forged one. Memory is scoped to that id, which is
 * why two visitors on the same deployment cannot read each other's facts.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'raven_session'
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/

const idPrefix = {
  conversation: 'conv',
  agentRun: 'run',
  toolRun: 'tool',
  message: 'msg',
  memory: 'mem',
} as const

export function newId(kind: keyof typeof idPrefix, hint?: string): string {
  const base = randomUUID().replace(/-/g, '').slice(0, 12)
  const suffix = hint ? `-${hint.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}` : ''
  return `${idPrefix[kind]}-${base}${suffix}`
}

/** Anything the client sends is validated before it reaches a query. */
export function readOpaqueId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return ID_PATTERN.test(trimmed) ? trimmed : null
}

export function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 32)
}

/** Constant-time comparison of the tag only; the payload is returned for the caller. */
export function verifySignedValue(signed: string | null | undefined, secret: string): string | null {
  if (!signed) return null
  const separator = signed.lastIndexOf('.')
  if (separator <= 0) return null
  const payload = signed.slice(0, separator)
  const tag = signed.slice(separator + 1)
  const expected = signValue(payload, secret)
  const a = Buffer.from(tag)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return readOpaqueId(payload)
}

export function sessionCookieValue(id: string, secret: string | null): string {
  return secret ? `${id}.${signValue(id, secret)}` : id
}

export function buildSessionCookie(id: string, options: { secret: string | null; maxAgeSeconds: number; secure: boolean }): string {
  return [
    `${SESSION_COOKIE}=${sessionCookieValue(id, options.secret)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(60, Math.floor(options.maxAgeSeconds))}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ')
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

/**
 * Resolve the session for a request, newest signal first: a valid signed cookie, then a
 * well-formed `x-raven-session` header or body field, then a fresh id. The returned
 * `issuedCookie` is set only when a new id was minted.
 */
export function resolveSession(input: {
  cookieHeader: string | null
  headerId?: string | null
  bodyId?: string | null
  secret: string | null
  maxAgeSeconds: number
  secure: boolean
}): { sessionId: string; issuedCookie: string | null; source: 'cookie' | 'header' | 'body' | 'generated' } {
  const fromCookie = verifySignedValue(parseCookies(input.cookieHeader)[SESSION_COOKIE] ?? null, input.secret ?? '')
  if (fromCookie) return { sessionId: fromCookie, issuedCookie: null, source: 'cookie' }
  const fromHeader = readOpaqueId(input.headerId)
  if (fromHeader) return { sessionId: fromHeader, issuedCookie: input.secret ? buildSessionCookie(fromHeader, input) : null, source: 'header' }
  const fromBody = readOpaqueId(input.bodyId)
  if (fromBody) return { sessionId: fromBody, issuedCookie: input.secret ? buildSessionCookie(fromBody, input) : null, source: 'body' }
  const generated = `ses-${randomUUID().replace(/-/g, '').slice(0, 20)}`
  return { sessionId: generated, issuedCookie: buildSessionCookie(generated, input), source: 'generated' }
}
