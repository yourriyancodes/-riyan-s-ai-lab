/**
 * Shared contracts for the RAVEN backend. This module is deliberately dependency
 * free (no Next, no React, no drivers) so the same types describe what runs in the
 * browser, in the route handler, and inside `scripts/check-brain.mjs`.
 */

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

/**
 * Canonical state names. `lib/raven/states.ts` owns the transition table for this
 * union; this file only names the states so both the client and the server can
 * import the type without pulling in server code.
 */
export type RavenState =
  | 'IDLE'
  | 'LISTENING'
  | 'UNDERSTANDING'
  | 'THINKING'
  | 'RESEARCHING'
  | 'REASONING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'SPEAKING'
  | 'VISION'
  | 'WAITING'
  | 'SUCCESS'
  | 'WARNING'
  | 'ERROR'
  | 'OFFLINE'

/** How the answer was produced. This is the honesty field the UI keys off. */
export type RavenMode = 'knowledge' | 'genai' | 'agentic' | 'offline'

export type RavenInputType = 'text' | 'voice' | 'vision' | 'system'

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export type VisionContext = {
  /** Anything the vision layer measured, passed through untouched and optional. */
  facePresent?: boolean
  depth?: { x: number; y: number }
  status?: string
  objects?: string[]
  [key: string]: unknown
}

export type RavenRequest = {
  message: string
  conversationId?: string
  sessionId?: string
  inputType?: RavenInputType
  context?: {
    visionContext?: VisionContext
    /** Client-declared preferences for this turn, e.g. verbosity. Never trusted for authority. */
    verbosity?: 'terse' | 'standard' | 'detailed'
    locale?: string
    /** Restrict which modes may run (used by tests and by the console's explicit switches). */
    allowedModes?: RavenMode[]
  }
}

/* ------------------------------------------------------------------ *
 * Intents and routing
 * ------------------------------------------------------------------ */

export type RavenIntent =
  | 'greeting'
  | 'identity.raven'
  | 'identity.riyan'
  | 'portfolio.projects'
  | 'portfolio.project'
  | 'portfolio.skills'
  | 'portfolio.contact'
  | 'portfolio.experiments'
  | 'portfolio.sections'
  | 'memory.recall'
  | 'memory.remember'
  | 'action.navigate'
  | 'capability.probe'
  | 'explain.concept'
  | 'compare.evaluate'
  | 'plan.multistep'
  | 'smalltalk'
  | 'unknown'

export type IntentMatch = {
  intent: RavenIntent
  /** 0..1. Rule-based, so it is reproducible rather than vibes. */
  confidence: number
  /** Keywords/anchors that fired, kept for the trace and for tests. */
  signals: string[]
  /** Normalized entities, e.g. a project name the user referred to. */
  entities: Record<string, string | number>
}

export type RouteDecision = {
  mode: RavenMode
  /** Which subsystems actually contributed, so "GENAI + KNOWLEDGE" is expressible. */
  usedKnowledge: boolean
  usedProvider: boolean
  usedTools: boolean
  reasons: string[]
  /** Deterministic fallback that was chosen instead, when a preferred mode was unavailable. */
  degradedFrom?: RavenMode
  degradedBecause?: string
}

/* ------------------------------------------------------------------ *
 * Knowledge
 * ------------------------------------------------------------------ */

export type CitationKind = 'siteConfig' | 'knowledge' | 'database' | 'provider' | 'tool' | 'memory'

export type Citation = {
  kind: CitationKind
  /** Machine id, e.g. `siteConfig.projects[3]` or `knowledge:rag`. */
  source: string
  label: string
  locator?: string
  /** Verbatim snippet the answer is grounded in, so a human can check it. */
  quote?: string
}

export type KnowledgeHit = {
  id: string
  title: string
  body: string
  score: number
  citation: Citation
  tags: string[]
}

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

export type ToolPermission = 'read' | 'compute' | 'action'

export type ToolRunStatus = 'succeeded' | 'failed' | 'rejected' | 'timeout' | 'skipped'

export type ToolRun = {
  id: string
  toolName: string
  input: unknown
  output: unknown
  status: ToolRunStatus
  ms: number
  error?: string
  startedAt: string
  finishedAt: string
  /** Present when the run happened inside an agent plan. Both ids are stored, never guessed. */
  agentRunId?: string | null
  conversationId?: string | null
}

/** Minimal JSON-Schema-ish descriptor; validated by `tools/validate.ts`. */
export type ToolParameterSpec = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  required?: boolean
  enum?: readonly (string | number | boolean)[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  itemType?: 'string' | 'number' | 'boolean'
}

export type ToolSpec = {
  name: string
  description: string
  permission: ToolPermission
  parameters: Record<string, ToolParameterSpec>
  /** Milliseconds; enforced by the registry, not by the tool. */
  timeoutMs?: number
  /**
   * `action` tools change something (write a memory, move the UI). They are only
   * executed when the request explicitly approved them.
   */
  requiresApproval?: boolean
}

export type ToolCall = { tool: string; input: Record<string, unknown> }

export type ToolOutcome = {
  tool: string
  status: ToolRunStatus
  /** A handler's own commentary ("nothing was persisted"), kept out of the audit row. */
  note?: string
  output?: unknown
  error?: string
  ms: number
  citations?: Citation[]
}

export type ProposedAction = {
  id: string
  tool: string
  input: Record<string, unknown>
  status: 'proposed' | 'executed' | 'rejected' | 'failed'
  result?: unknown
  note?: string
}

/* ------------------------------------------------------------------ *
 * Memory
 * ------------------------------------------------------------------ */

export type MemoryRecord = {
  id: string
  sessionId: string
  key: string
  value: string
  importance: number
  createdAt: string
  updatedAt: string
  source: 'extracted' | 'explicit' | 'tool'
}

export type MemoryUpdate = {
  op: 'upsert' | 'expire'
  key: string
  value?: string
  importance?: number
  /** Why this was worth keeping — shown in the trace, never invented. */
  reason: string
}

export type ConversationMessageRecord = {
  id: string
  conversationId: string
  role: 'user' | 'raven' | 'system'
  content: string
  mode: RavenMode | null
  state: RavenState | null
  createdAt: string
}

export type ConversationRecord = {
  id: string
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Agent runs
 * ------------------------------------------------------------------ */

export type AgentRunStatus = 'planned' | 'running' | 'verified' | 'failed' | 'partial'

export type AgentStep = {
  /** Short human-readable label, e.g. `retrieve projects`. */
  action: string
  tool?: string
  status: ToolRunStatus
  ms: number
  note?: string
}

export type AgentRunRecord = {
  id: string
  conversationId: string
  goal: string
  status: AgentRunStatus
  startedAt: string
  completedAt: string | null
  steps: AgentStep[]
  toolsUsed: string[]
  verified: boolean
  result: string
  mode: RavenMode
}

/* ------------------------------------------------------------------ *
 * Provider abstraction
 * ------------------------------------------------------------------ */

export type ProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ProviderRequest = {
  messages: ProviderMessage[]
  temperature?: number
  maxOutputTokens?: number
  /** Ask the provider to answer with JSON only. Providers that cannot, degrade. */
  json?: boolean
  signal?: AbortSignal
}

export type ProviderResult =
  | { ok: true; text: string; model: string; provider: string; usage?: { inputChars: number; outputChars: number; inputTokens?: number; outputTokens?: number }; ms: number }
  | {
      ok: false
      provider: string
      /** Stable code the UI and tests switch on. */
      code: 'no_provider' | 'rate_limited' | 'timeout' | 'network' | 'bad_response' | 'unavailable' | 'refused' | 'too_long'
      message: string
      retryAfterMs?: number
      ms: number
    }

export type ModelProvider = {
  id: string
  label: string
  /** Cheap reachability probe used by /api/health. May be a no-op for offline stubs. */
  probe(): Promise<{ reachable: boolean; detail: string }>
  generate(request: ProviderRequest): Promise<ProviderResult>
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export type PhaseEvent = {
  state: RavenState
  phase: string
  /** ms since the brain started this turn. */
  atMs: number
  /** ms the phase itself took. */
  ms: number
  note?: string
}

export type RavenMetadata = {
  /** Real measured timings, one entry per phase the brain entered. */
  trace: PhaseEvent[]
  intent: RavenIntent
  intentConfidence: number
  route: RouteDecision
  steps: number
  toolsUsed: string[]
  toolRuns: ToolRun[]
  agentRunId: string | null
  provider: { id: string; label: string; model: string } | null
  memory: { driver: string; retrieved: number; stored: number }
  database: { driver: string; configured: boolean; reachable: boolean; detail: string }
  latencyMs: number
  /** Character counts, never "token" counts we cannot measure. */
  contextChars: number
  inputChars: number
  truncated: boolean
  conversationSource: 'database' | 'file' | 'memory'
}

export type RavenError = { code: string; message: string; retryAfterMs?: number }

/** The stable contract. Success and failure share the same shape on purpose. */
export type RavenResponse = {
  success: boolean
  response: string
  mode: RavenMode
  state: RavenState
  conversationId: string
  citations: Citation[]
  actions: ProposedAction[]
  memoryUpdates: MemoryUpdate[]
  verified: boolean
  error?: RavenError
  metadata?: RavenMetadata
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

export type DatabaseDriver = 'postgres' | 'postgres-rest' | 'file' | 'memory'

export type DatabaseStatus = {
  driver: DatabaseDriver
  configured: boolean
  reachable: boolean
  detail: string
}

/**
 * The only database surface the brain may use. Everything above it is driver
 * agnostic, which is what keeps Postgres optional instead of aspirational.
 */
export interface DatabaseAdapter {
  status(): DatabaseStatus
  ensureSchema(): Promise<void>
  upsertConversation(conversation: ConversationRecord): Promise<void>
  appendMessage(message: ConversationMessageRecord): Promise<void>
  recentMessages(conversationId: string, limit: number): Promise<ConversationMessageRecord[]>
  listConversations(sessionId: string, limit: number): Promise<ConversationRecord[]>
  remember(memory: MemoryRecord): Promise<void>
  recallMemories(sessionId: string, limit: number): Promise<MemoryRecord[]>
  searchMemories(sessionId: string, terms: string[], limit: number): Promise<MemoryRecord[]>
  expireMemory(sessionId: string, key: string): Promise<boolean>
  startAgentRun(run: AgentRunRecord): Promise<void>
  finishAgentRun(run: AgentRunRecord): Promise<void>
  recordToolRun(run: ToolRun & { conversationId: string }): Promise<void>
}
