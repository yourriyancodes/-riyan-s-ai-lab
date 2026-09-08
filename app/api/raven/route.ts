/**
 * POST /api/raven — the single entry point into the brain.
 *
 * This handler is deliberately thin: parse, validate, rate-limit, resolve the session,
 * call `runBrainTurn`, serialize. No answering logic lives here, which is what keeps
 * the console, a future voice pipeline, and the test harness talking to the same brain.
 *
 * It always answers with the `RavenResponse` shape — success and failure alike — so a
 * client never has to branch on a body shape before it can show something.
 */
import { runBrainTurn, providerBreakerState } from '@/lib/raven/brain'
import { ravenConfig } from '@/lib/raven/config'
import { checkRateLimit } from '@/lib/raven/rateLimit'
import { resolveSession } from '@/lib/raven/session'
import type { RavenMode, RavenResponse, VisionContext } from '@/lib/raven/types'
import { isRavenState } from '@/lib/raven/states'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODES: readonly RavenMode[] = ['knowledge', 'genai', 'agentic', 'offline']

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })

/** A rejection still has to look like a response, so the console can render it. */
const rejection = (message: string, conversationId: string, code: string, extra: Record<string, unknown> = {}): RavenResponse & Record<string, unknown> => ({
  success: false,
  response: message,
  mode: 'offline',
  state: 'OFFLINE',
  conversationId,
  citations: [],
  actions: [],
  memoryUpdates: [],
  verified: false,
  error: { code, message, ...extra },
})

const clientKey = (request: Request): string => {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'local'
}

export async function POST(request: Request): Promise<Response> {
  const config = ravenConfig()
  const startedAt = Date.now()

  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > config.limits.maxBodyBytes) {
    return json(rejection(`Request body is ${declared} bytes; the limit is ${config.limits.maxBodyBytes}.`, 'none', 'body_too_large'), 413)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json(rejection('Body must be valid JSON.', 'none', 'invalid_json'), 400)
  }
  if (!payload || typeof payload !== 'object') return json(rejection('Body must be a JSON object.', 'none', 'invalid_json'), 400)
  const body = payload as Record<string, unknown>

  const rate = checkRateLimit(clientKey(request), config.limits.rateLimit)
  if (!rate.allowed) {
    return json(rejection(`Slow down: ${rate.used} requests in the last ${Math.round(config.limits.rateLimit.windowMs / 1000)}s (limit ${rate.limit}).`, String(body.conversationId ?? 'none'), 'rate_limited', { retryAfterMs: rate.retryAfterMs }), 429, { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) })
  }

  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) return json(rejection('A message is required.', String(body.conversationId ?? 'none'), 'empty_input'), 422)
  if (message.length > config.limits.maxMessageChars) {
    return json(rejection(`Message is ${message.length} characters; the limit is ${config.limits.maxMessageChars}.`, String(body.conversationId ?? 'none'), 'too_long'), 413)
  }

  const context = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>
  const allowedModes = Array.isArray(context.allowedModes) ? (context.allowedModes.filter((mode) => MODES.includes(mode as RavenMode)) as RavenMode[]) : undefined
  const visionContext = context.visionContext && typeof context.visionContext === 'object' ? (context.visionContext as VisionContext) : null
  const approvedActions = Array.isArray(context.approvedActions) ? context.approvedActions.filter((entry): entry is string => typeof entry === 'string').slice(0, 8) : []
  const inputType = body.inputType === 'voice-transcript' || body.inputType === 'command' ? body.inputType : 'text'

  const session = resolveSession({
    cookieHeader: request.headers.get('cookie'),
    headerId: request.headers.get('x-raven-session'),
    bodyId: typeof body.sessionId === 'string' ? body.sessionId : null,
    secret: config.session.secret,
    maxAgeSeconds: config.session.maxAgeSeconds,
    secure: new URL(request.url).protocol === 'https:',
  })

  // A conversation id is chosen by the client when it has one (reload continuity), and
  // by the server otherwise. Both are validated, so nothing arbitrary reaches a query.
  const conversationId =
    (typeof body.conversationId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.conversationId.trim()) ? body.conversationId.trim() : null) ??
    `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const result = await runBrainTurn({
    message,
    sessionId: session.sessionId,
    conversationId,
    inputType,
    visionContext,
    approvedActions,
    ...(allowedModes?.length ? { allowedModes } : {}),
  })

  const headers: Record<string, string> = {
    'x-raven-mode': result.mode,
    'x-raven-state': isRavenState(result.state) ? result.state : 'ERROR',
    'x-raven-latency-ms': String(Date.now() - startedAt),
  }
  if (session.issuedCookie) headers['set-cookie'] = `${session.issuedCookie}`
  if (result.error?.retryAfterMs) headers['retry-after'] = String(Math.ceil(result.error.retryAfterMs / 1000))
  if (result.metadata) headers['x-raven-breaker'] = providerBreakerState().open ? 'open' : 'closed'

  return json(result, result.success ? 200 : 502, headers)
}

/**
 * GET /api/raven — the console's capability read. Reports the same thing health does,
 * minus the provider probe, because the browser asks this often and probes cost quota.
 */
export async function GET(): Promise<Response> {
  const config = ravenConfig()
  return json(
    {
      ok: true,
      endpoints: { ask: 'POST /api/raven', health: 'GET /api/health' },
      providerConfigured: Boolean(config.provider.id && config.provider.apiKeyPresent),
      providerLabel: config.provider.label,
      model: config.provider.model,
      limits: { messageChars: config.limits.maxMessageChars, bodyBytes: config.limits.maxBodyBytes, rate: config.limits.rateLimit },
      breaker: providerBreakerState(),
      acceptedBody: { message: 'string', conversationId: 'optional [A-Za-z0-9_-]{6,64}', sessionId: 'optional', inputType: 'text | voice-transcript | command', context: { allowedModes: 'optional subset of knowledge|genai|agentic|offline', approvedActions: 'optional tool names', visionContext: 'optional object, passed through untouched' } },
    },
    200,
  )
}
