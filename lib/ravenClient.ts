/**
 * Browser-side client for the RAVEN brain.
 *
 * The types here are the *wire contract*, written out rather than imported from
 * `lib/raven/types.ts`: nothing in the browser bundle should be one refactor away from
 * pulling in a module that imports `node:fs`. `scripts/check-brain.mjs` asserts the two
 * stay in step.
 *
 * `askRaven` keeps the legacy `{ state, output, message, code }` fields alongside the
 * full response, so the existing console keeps working while the new capability fields
 * are available to anything that wants them.
 */

export type RavenState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'UNDERSTANDING'
  | 'RESEARCHING'
  | 'REASONING'
  | 'PLANNING'
  | 'WAITING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'SPEAKING'
  | 'VISION'
  | 'SUCCESS'
  | 'WARNING'
  | 'ERROR'
  | 'OFFLINE'

export type RavenMode = 'knowledge' | 'genai' | 'agentic' | 'offline'

export type RavenCitation = { kind: string; source: string; label: string; locator?: string; quote?: string }

export type RavenToolRun = {
  id: string
  toolName: string
  input: unknown
  output: unknown
  status: 'succeeded' | 'failed' | 'rejected' | 'timeout' | 'skipped'
  ms: number
  error?: string
}

export type RavenPhase = { state: RavenState; phase: string; atMs: number; ms: number; note?: string }

export type RavenProposedAction = {
  id: string
  tool: string
  input: Record<string, unknown>
  status: 'proposed' | 'executed' | 'rejected' | 'failed'
  result?: unknown
  note?: string
}

export type RavenMetadata = {
  trace: RavenPhase[]
  intent: string
  intentConfidence: number
  route: {
    mode: RavenMode
    usedKnowledge: boolean
    usedProvider: boolean
    usedTools: boolean
    reasons: string[]
    degradedFrom?: RavenMode
    degradedBecause?: string
  }
  steps: number
  toolsUsed: string[]
  toolRuns: RavenToolRun[]
  agentRunId: string | null
  provider: { id: string; label: string; model: string } | null
  memory: { driver: string; retrieved: number; stored: number }
  database: { driver: string; configured: boolean; reachable: boolean; detail: string }
  latencyMs: number
  contextChars: number
  inputChars: number
  truncated: boolean
  conversationSource: 'database' | 'file' | 'memory'
}

export type RavenReply = {
  /** Legacy fields, kept so existing console code keeps rendering. */
  state: RavenState
  output?: string
  code?: string
  message?: string
  /** Full brain response. */
  success: boolean
  response: string
  /** Canonical alias of `response`, and `provider`/`degraded` are the truth about who answered. */
  reply?: string
  provider?: string
  degraded?: { from: RavenMode; because: string } | null
  /** Hoisted copy of `metadata.trace`; the store prefers it and falls back to metadata. */
  trace?: RavenPhase[]
  mode: RavenMode
  conversationId: string
  citations: RavenCitation[]
  actions: RavenProposedAction[]
  memoryUpdates: { op: 'upsert' | 'expire'; key: string; value?: string; importance?: number; reason: string }[]
  verified: boolean
  error?: { code: string; message: string; retryAfterMs?: number }
  metadata?: RavenMetadata
}

export type RavenHealth = {
  service: string
  databaseConfigured: boolean
  databaseReachable: boolean
  providerConfigured: boolean
  providerReachable: boolean
  /**
   * Three separate facts, not two: an endpoint can answer HTTP fine and still refuse the
   * credential. `null` means nobody probed yet, which is why the console hides the chip
   * rather than showing it as a failure.
   */
  providerAuthorized?: boolean | null
  providerAdapterImplemented: boolean
  ownerAuthConfigured: boolean
  voiceConfigured: boolean
  status: 'OFFLINE' | 'PARTIALLY_READY' | 'READY'
  note?: string
  /** Added by the brain build: the measured detail behind the summary flags. */
  provider?: { id: string | null; label: string; model: string | null; baseUrl: string; breaker?: { open: boolean; failures: number }; probed?: { reachable: boolean; authorized: boolean | null; detail: string } | null }
  database?: { driver: string; detail: string; degradedFrom?: string[] }
  knowledge?: { documents: number; projects: number; skillNodes: number; glossaryEntries: number }
  tools?: { name: string; permission: string; requiresApproval: boolean }[]
  capabilities?: Record<string, unknown>
}

export type AskOptions = {
  conversationId?: string
  sessionId?: string
  inputType?: 'text' | 'voice-transcript' | 'command'
  /** Passed through untouched; the brain never claims to have analysed it. */
  visionContext?: Record<string, unknown> | null
  approvedActions?: string[]
  allowedModes?: RavenMode[]
  signal?: AbortSignal
}

const CONVERSATION_KEY = 'raven.conversationId'
const SESSION_KEY = 'raven.sessionId'

const safeStorage = (kind: 'local' | 'session'): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    // Private mode or a blocked cookie policy: memory simply does not persist.
    return null
  }
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Conversation and session identity, kept in `localStorage` so a reload resumes the
 * same conversation the server has on record — that is the entire continuity mechanism,
 * and it works with no database and no cookies at all.
 */
export function ravenConversationId(): string {
  const store = safeStorage('local')
  const existing = store?.getItem(CONVERSATION_KEY)
  if (existing && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) return existing
  const created = newId('conv')
  try {
    store?.setItem(CONVERSATION_KEY, created)
  } catch {
    /* storage full or blocked: the id stays for this page load only */
  }
  return created
}

export function ravenSessionId(): string {
  const store = safeStorage('local')
  const existing = store?.getItem(SESSION_KEY)
  if (existing && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) return existing
  const created = newId('ses')
  try {
    store?.setItem(SESSION_KEY, created)
  } catch {
    /* ignored, as above */
  }
  return created
}

export function resetRavenConversation(): void {
  try {
    safeStorage('local')?.removeItem(CONVERSATION_KEY)
  } catch {
    /* nothing to clean up */
  }
}

const fallback = (message: string, code: string, state: RavenState): RavenReply => ({
  state,
  output: message,
  message,
  code,
  success: false,
  response: message,
  mode: 'offline',
  conversationId: '',
  citations: [],
  actions: [],
  memoryUpdates: [],
  verified: false,
  error: { code, message },
})

/** One turn of the brain. Never throws: a transport failure becomes an offline reply. */
export async function askRaven(input: string, options: AskOptions = {}): Promise<RavenReply> {
  let response: Response
  try {
    response = await fetch('/api/raven', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.sessionId ? { 'x-raven-session': options.sessionId } : {}) },
      // `input` is kept as an alias for the historical request shape.
      body: JSON.stringify({
        message: input,
        input,
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.inputType ? { inputType: options.inputType } : {}),
        context: {
          ...(options.visionContext ? { visionContext: options.visionContext } : {}),
          ...(options.approvedActions?.length ? { approvedActions: options.approvedActions } : {}),
          ...(options.allowedModes?.length ? { allowedModes: options.allowedModes } : {}),
        },
      }),
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return fallback('Cancelled before the brain finished.', 'aborted', 'IDLE')
    return fallback('The backend is not reachable from this page, so nothing was answered.', 'network_error', 'OFFLINE')
  }

  const data = (await response.json().catch(() => null)) as (Partial<RavenReply> & Record<string, unknown>) | null
  if (!data) {
    return fallback(`The backend replied with ${response.status || 'no body'} and nothing readable.`, 'invalid_response', 'ERROR')
  }

  const reply: RavenReply = {
    state: (data.state as RavenState) ?? (response.ok ? 'SPEAKING' : 'ERROR'),
    output: typeof data.response === 'string' ? data.response : ((data.output as string | undefined) ?? (data.message as string | undefined)),
    message: typeof data.message === 'string' ? data.message : undefined,
    code: typeof data.code === 'string' ? data.code : ((data.error as { code?: string } | undefined)?.code ?? undefined),
    success: Boolean(data.success),
    // `response` first: it is the long-standing field. `reply` is the standardised name, and
    // either is enough, which lets the server rename a field without stranding this client.
    response: typeof data.response === 'string' ? data.response : (typeof data.reply === 'string' ? data.reply : (data.output as string | undefined) ?? ''),
    mode: (data.mode as RavenMode) ?? 'offline',
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : (options.conversationId ?? ''),
    citations: Array.isArray(data.citations) ? (data.citations as RavenCitation[]) : [],
    actions: Array.isArray(data.actions) ? (data.actions as RavenProposedAction[]) : [],
    memoryUpdates: Array.isArray(data.memoryUpdates) ? (data.memoryUpdates as RavenReply['memoryUpdates']) : [],
    verified: Boolean(data.verified),
    ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
    ...(data.degraded && typeof data.degraded === 'object' ? { degraded: data.degraded as RavenReply['degraded'] } : {}),
    ...(data.error ? { error: data.error as RavenReply['error'] } : {}),
    // Canonical top-level fields first; `metadata` remains the fallback for an older server.
    ...(Array.isArray(data.trace) ? { trace: data.trace as RavenPhase[] } : {}),
    ...(data.metadata ? { metadata: data.metadata as RavenMetadata } : {}),
  }
  return reply
}

export async function getRavenHealth(options: { probe?: boolean } = {}): Promise<RavenHealth> {
  const query = options.probe === false ? '?probe=0' : ''
  const response = await fetch(`/api/health${query}`, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Health check failed with status ${response.status}`)
  return (await response.json()) as RavenHealth
}
