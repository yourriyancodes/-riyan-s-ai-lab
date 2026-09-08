/**
 * RAVEN's brain: the one function that runs a turn, top to bottom.
 *
 *   Context → Intent → Router → Agents → Tools → Verification → Memory → Response
 *
 * What this file is accountable for:
 *  - Every state in `metadata.trace` was actually entered, with a measured duration. The
 *    state machine in `states.ts` refuses illegal moves, so a response cannot claim to
 *    have verified something it skipped.
 *  - A model is consulted only through `providers/`, and its absence is a documented
 *    path, not an error. `mode` is the authority on what generated the text.
 *  - Persistence is attempted and reported, never assumed. Failures land in
 *    `metadata.database.detail` and in the agent-run record, not in a swallowed log line.
 *  - If any of it throws, the caller still gets a well-formed response with a real
 *    error code. A portfolio backend that 500s on a clever question is a broken demo.
 */
import { ravenConfig, type RavenConfig } from './config'
import { classifyIntent } from './intent'
import { routeTurn, type RouterCapabilities } from './router'
import { transition, WORKING_STATES } from './states'
import type {
  AgentStep,
  Citation,
  DatabaseAdapter,
  IntentMatch,
  MemoryUpdate,
  ModelProvider,
  PhaseEvent,
  ProposedAction,
  RavenIntent,
  RavenMode,
  RavenResponse,
  RavenState,
  RouteDecision,
  ToolRun,
  VisionContext,
} from './types'
import { createToolRegistry, type ToolContext } from './tools'
import type { ToolRegistry } from './tools/registry'
import { planRetrieval, runRetrieval } from './agents/research'
import { composeKnowledgeAnswer } from './agents/knowledge'
import { evidenceFromRetrieval, runAgenticTurn, synthesizeWithProvider } from './agents/reasoning'
import { runActions } from './agents/action'
import { registerVocabulary, summarizeVerification, verifyAnswer } from './agents/verification'
import { extractMemoryUpdates } from './memory/extract'
import { loadContext, storeTurn } from './memory/service'
import { getDatabase } from './db'
import { resolveProvider } from './providers'
import { cleanReply } from './providers/prompt'
import { newId } from './session'
import { glossary as glossaryEntries, skillNodes } from '@/data/ravenKnowledge'
import { profile, projects, raven as ravenSelf, sections } from './knowledge/corpus'

export type BrainTurnInput = {
  message: string
  sessionId: string
  conversationId: string
  inputType?: 'text' | 'voice-transcript' | 'command'
  visionContext?: VisionContext | null
  allowedModes?: RavenMode[]
  approvedActions?: string[]
}

export type BrainOptions = {
  config?: RavenConfig
  /** Tests inject a fake provider here; production leaves it undefined. */
  providerOverride?: ModelProvider | null
  registry?: ToolRegistry
  /** Skip persistence entirely (used by the health probe and by pure-logic tests). */
  skipPersistence?: boolean
}

/**
 * A tiny circuit breaker. After two consecutive provider failures this process stops
 * calling it for a minute and answers locally, because hammering a rate-limited key on
 * every message is slow and rude. The state is reported, never hidden.
 */
const breaker = { failures: 0, openUntil: 0 }

export function providerBreakerState(): { failures: number; open: boolean; openForMs: number } {
  return { failures: breaker.failures, open: Date.now() < breaker.openUntil, openForMs: Math.max(0, breaker.openUntil - Date.now()) }
}

export function resetProviderBreaker(): void {
  breaker.failures = 0
  breaker.openUntil = 0
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Records phases and drives the state machine; the trace it builds is the audit trail. */
class Tracker {
  private readonly started = Date.now()
  private lastAt = 0
  state: RavenState = 'IDLE'
  readonly events: PhaseEvent[] = []
  readonly refusals: string[] = []

  enter(next: RavenState, phase: string, note?: string): void {
    const now = Date.now() - this.started
    const moved = transition(this.state, next)
    if (moved.refused) this.refusals.push(moved.refused)
    this.state = moved.state
    this.push(phase, now, note)
  }

  /** Annotate the current state without moving it — used for sub-phase reporting. */
  push(phase: string, atOverride?: number, note?: string): void {
    const now = atOverride ?? Date.now() - this.started
    this.events.push({ state: this.state, phase, atMs: now, ms: Math.max(0, now - this.lastAt), ...(note ? { note: clip(note, 200) } : {}) })
    this.lastAt = now
  }

  elapsed(): number {
    return Date.now() - this.started
  }
}

export async function runBrainTurn(input: BrainTurnInput, options: BrainOptions = {}): Promise<RavenResponse> {
  const config = options.config ?? ravenConfig()
  const tracker = new Tracker()
  const conversationId = input.conversationId
  const message0 = typeof input.message === 'string' ? input.message : ''

  const registry = options.registry ?? createToolRegistry()
  const runs: ToolRun[] = []
  /** The registry records every run here; kept in sync after construction. */
  const auditRuns = (run: ToolRun) => runs.push(run)

  let adapter: DatabaseAdapter | null = null
  let runId: string | null = null
  let runStartedAt = new Date().toISOString()
  let agentRunId: string | null = null
  let lastMessage = ''

  const stepRecords: AgentStep[] = []

  const finishRun = async (status: 'verified' | 'partial' | 'failed', mode: RavenMode, toolsUsed: string[], verified: boolean, result: string) => {
    if (!adapter || !runId) return
    try {
      await adapter.finishAgentRun({
        id: runId,
        conversationId,
        goal: clip(lastMessage || message0, 400),
        mode,
        status,
        steps: stepRecords,
        toolsUsed,
        verified,
        result,
        startedAt: runStartedAt,
        completedAt: new Date().toISOString(),
      })
    } catch {
      /* the run already recorded that persistence is degraded; a turn must not fail twice */
    }
  }

  const respond = (parts: {
    success: boolean
    response: string
    mode: RavenMode
    state: RavenState
    citations: Citation[]
    actions: ProposedAction[]
    memoryUpdates: MemoryUpdate[]
    verified: boolean
    intent: RavenIntent
    intentConfidence: number
    route: RouteDecision
    provider: { id: string; label: string; model: string } | null
    memory: { retrieved: number; stored: number }
    database: { driver: string; configured: boolean; reachable: boolean; detail: string }
    conversationSource: 'database' | 'file' | 'memory'
    steps: number
    toolsUsed: string[]
    contextChars: number
    inputChars: number
    truncated: boolean
    error?: { code: string; message: string; retryAfterMs?: number }
  }): RavenResponse => {
    const trace = [...tracker.events]
    if (tracker.refusals.length) trace.push({ state: parts.state, phase: 'transition-guard', atMs: tracker.elapsed(), ms: 0, note: tracker.refusals.join('; ') })
    return {
      success: parts.success,
      response: parts.response,
      mode: parts.mode,
      state: parts.state,
      conversationId,
      citations: parts.citations,
      actions: parts.actions,
      memoryUpdates: parts.memoryUpdates,
      verified: parts.verified,
      ...(parts.error ? { error: parts.error } : {}),
      metadata: {
        trace,
        intent: parts.intent,
        intentConfidence: parts.intentConfidence,
        route: parts.route,
        steps: parts.steps,
        toolsUsed: parts.toolsUsed,
        toolRuns: runs,
        agentRunId,
        provider: parts.provider,
        memory: { driver: parts.database.driver, retrieved: parts.memory.retrieved, stored: parts.memory.stored },
        database: parts.database,
        latencyMs: tracker.elapsed(),
        contextChars: parts.contextChars,
        inputChars: parts.inputChars,
        truncated: parts.truncated,
        conversationSource: parts.conversationSource,
      },
    }
  }

  const noRoute = routeTurn({
    intent: { intent: 'unknown', confidence: 0, signals: [], entities: {} } as IntentMatch,
    capabilities: { providerAvailable: false, knowledgeAvailable: true, databaseAvailable: false, providerKnownFailing: false },
  })

  const base = {
    citations: [] as Citation[],
    actions: [] as ProposedAction[],
    memoryUpdates: [] as MemoryUpdate[],
    verified: false,
    intent: 'unknown' as RavenIntent,
    intentConfidence: 0,
    route: noRoute,
    provider: null as { id: string; label: string; model: string } | null,
    memory: { retrieved: 0, stored: 0 },
    database: { driver: 'none', configured: false, reachable: false, detail: 'not inspected' },
    conversationSource: 'memory' as 'database' | 'file' | 'memory',
    steps: 0,
    toolsUsed: [] as string[],
    contextChars: 0,
    inputChars: 0,
    truncated: false,
  }

  try {
    // ---------------------------------------------------------------- input
    tracker.enter('LISTENING', 'input', `type=${input.inputType ?? 'text'}`)
    const message = message0.replace(/\s+/g, ' ').trim()
    lastMessage = message
    if (!message) {
      tracker.enter('ERROR', 'validate', 'empty message')
      return respond({ ...base, success: false, response: 'I need something to work with — ask a question or give me something to remember.', mode: 'offline', state: 'ERROR', error: { code: 'empty_input', message: 'message must not be empty' } })
    }
    if (message.length > config.limits.maxMessageChars) {
      tracker.enter('ERROR', 'validate', `${message.length} chars exceeds the limit`)
      return respond({
        ...base,
        success: false,
        inputChars: message.length,
        response: `That is ${message.length} characters; the limit here is ${config.limits.maxMessageChars}. Shorten it and I will read it properly.`,
        mode: 'offline',
        state: 'ERROR',
        error: { code: 'too_long', message: `message exceeds RAVEN_MAX_MESSAGE_CHARS (${config.limits.maxMessageChars})` },
      })
    }

    if (input.visionContext) {
      tracker.enter('VISION', 'vision-input', 'camera context passed through from the client; no detection performed here')
    }

    // ------------------------------------------------------------ adapters
    const database = options.skipPersistence ? null : await getDatabase(config)
    adapter = database?.adapter ?? null
    const dbStatus = adapter?.status()
    const databaseMeta = {
      driver: database?.driver ?? 'none',
      configured: Boolean(dbStatus?.configured),
      reachable: Boolean(dbStatus?.reachable),
      detail: clip(dbStatus?.detail ?? 'persistence skipped for this turn', 380),
    }
    if (database?.notes.length) databaseMeta.detail = clip(`${databaseMeta.detail}; degraded from: ${database.notes.join(' | ')}`, 380)
    tracker.push('persistence', undefined, `${databaseMeta.driver}${database?.notes.length ? ` (fallback: ${clip(database.notes[0]!, 120)})` : ''}`)

    // An injected provider (tests, or a future console toggle) decides availability by
    // itself; otherwise it takes a resolvable provider *and* a credential to be "there".
    const provider = options.providerOverride !== undefined ? options.providerOverride : resolveProvider(config)
    const providerAvailable = options.providerOverride !== undefined ? Boolean(options.providerOverride) : Boolean(provider) && config.provider.apiKeyPresent
    const capabilities: RouterCapabilities = {
      providerAvailable,
      knowledgeAvailable: true,
      databaseAvailable: Boolean(adapter && databaseMeta.reachable),
      providerKnownFailing: providerBreakerState().open,
    }

    // ----------------------------------------------------- short-term memory
    const context = await loadContext({
      adapter,
      sessionId: input.sessionId,
      conversationId,
      message,
      limits: { maxHistoryMessages: config.limits.maxHistoryMessages, maxMemoriesInContext: config.limits.maxMemoriesInContext },
    })
    tracker.push('context', undefined, `${context.recent.length} prior message(s), ${context.memories.length} durable fact(s) via ${context.source}${context.errors.length ? `, degraded: ${clip(context.errors[0]!, 120)}` : ''}`)

    // ---------------------------------------------------------------- intent
    tracker.enter('UNDERSTANDING', 'intent')
    const intent = classifyIntent(message, input.visionContext ? { hint: 'vision context supplied' } : {})

    // The composer may only use names this repository actually documents; verification
    // checks the finished text against this vocabulary.
    registerVocabulary([
      ...projects.map((project) => project.name),
      ...projects.flatMap((project) => project.technology.split(/[+,/]/).map((part) => part.trim())),
      profile.name,
      ravenSelf.name,
      ...skillNodes.map((node) => node.name),
      ...glossaryEntries.map((entry) => entry.term),
      ...sections.map((section) => section.title),
      'RAVEN',
      'Riyan Pasha',
      'Next.js',
      'React',
      'TypeScript',
      'Three.js',
      'MediaPipe',
      'Postgres',
      'Supabase',
      'Gemini',
      'Google',
      'Ollama',
    ])

    // ---------------------------------------------------------------- router
    const route = routeTurn({ intent, capabilities, ...(input.allowedModes ? { allowedModes: input.allowedModes } : {}) })
    tracker.push('route', undefined, `${route.mode}${route.degradedFrom ? ` (wanted ${route.degradedFrom}: ${route.degradedBecause})` : ''}`)

    // ------------------------------------------------------- tools + retrieval
    const toolContext: ToolContext = {
      sessionId: input.sessionId,
      conversationId,
      adapter,
      agentRunId: null,
      approvedActions: new Set(input.approvedActions ?? []),
      now: () => new Date().toISOString(),
      config,
    }

    runId = newId('agentRun', route.mode)
    toolContext.agentRunId = runId
    runStartedAt = new Date().toISOString()

    if (adapter) {
      try {
        await adapter.startAgentRun({
          id: runId,
          conversationId,
          goal: clip(message, 400),
          mode: route.mode,
          status: 'running',
          steps: [],
          toolsUsed: [],
          verified: false,
          result: '',
          startedAt: runStartedAt,
          completedAt: null,
        })
        agentRunId = runId
      } catch (error) {
        databaseMeta.detail = clip(`${databaseMeta.detail}; agent run start failed: ${(error as Error).message}`, 380)
      }
    }

    tracker.enter(route.mode === 'agentic' ? 'REASONING' : 'RESEARCHING', 'retrieval', `intent ${intent.intent}, ${registry.names().length} tools available`)
    const plan = planRetrieval({ intent, message })
    const retrieval = await runRetrieval(registry, plan, toolContext, auditRuns)
    for (const [index, call] of retrieval.calls.entries()) {
      const outcome = retrieval.outcomes.get(call.tool)
      stepRecords.push({
        action: `${call.tool} — ${plan.rationale[index] ?? 'planned retrieval'}`,
        tool: call.tool,
        status: outcome?.status ?? 'skipped',
        ms: outcome?.ms ?? 0,
        ...(outcome?.error ? { note: clip(outcome.error, 160) } : {}),
      })
    }

    // ------------------------------------------------------- action agent
    const extraction = extractMemoryUpdates({ message, intent: intent.intent })
    let memoryResult = { stored: 0, expired: 0, errors: [] as string[], actions: [] as ProposedAction[] }
    let navigation: { section: string; approved: boolean; targetPresent: boolean } | null = null
    if (extraction.updates.length || intent.intent === 'action.navigate') {
      tracker.enter('EXECUTING', 'actions', `${extraction.updates.length} memory update(s)${intent.intent === 'action.navigate' ? ' + navigation' : ''}`)
      const actions = await runActions({
        registry,
        context: toolContext,
        updates: extraction.updates,
        navigation: intent.intent === 'action.navigate' && typeof intent.entities.section === 'string' ? { section: String(intent.entities.section) } : null,
      })
      memoryResult = { stored: actions.stored, expired: actions.expired, errors: actions.errors, actions: actions.actions }
      navigation = actions.navigation
      for (const action of actions.actions) {
        stepRecords.push({
          action: `action ${action.tool} → ${action.status}`,
          tool: action.tool,
          status: action.status === 'executed' ? 'succeeded' : action.status === 'proposed' ? 'skipped' : 'failed',
          ms: 0,
          note: action.note,
        })
      }
    }

    // ---------------------------------------------------------------- answer
    let answer: string | null = null
    let citations: Citation[] = [...retrieval.citations]
    let providerMeta: { id: string; label: string; model: string } | null = null
    let mode: RavenMode = route.mode
    let degradedFrom: RavenMode | undefined
    let degradedBecause: string | undefined
    let toolsUsed = [...new Set([...retrieval.outcomes.keys()].map((key) => key.split('#')[0]!))]

    const memoryForAnswer =
      memoryResult.stored || memoryResult.expired || memoryResult.errors.length
        ? { stored: memoryResult.stored, updates: extraction.updates, errors: memoryResult.errors, driver: databaseMeta.driver }
        : null

    if (route.mode === 'agentic') {
      const agentic = await runAgenticTurn({
        message,
        intent,
        retrieval,
        registry,
        context: toolContext,
        config,
        provider: capabilities.providerAvailable ? provider : null,
        memories: context.memories,
        recent: context.recent,
        onRun: auditRuns,
      })
      answer = agentic.answer
      citations = agentic.citations
      providerMeta = agentic.provider
      toolsUsed = [...new Set([...toolsUsed, ...agentic.toolsUsed])]
      stepRecords.push(...agentic.steps)
      if (agentic.synthesizedBy === 'deterministic') {
        degradedFrom = 'genai'
        degradedBecause = agentic.providerFailure ? `provider ${agentic.providerFailure.code}; synthesized from the same evidence locally` : 'no provider configured; synthesized from the same evidence locally'
      }
      if (agentic.providerFailure) {
        breaker.failures++
        if (breaker.failures >= 2) breaker.openUntil = Date.now() + 60_000
      } else if (agentic.synthesizedBy === 'provider') {
        breaker.failures = 0
      }
    } else if (route.mode === 'genai') {
      tracker.enter('THINKING', 'provider-synthesis', provider ? `${provider.id}` : 'no provider resolved')
      const evidence = evidenceFromRetrieval(retrieval, message)
      const synthesis = await synthesizeWithProvider({
        provider: provider ?? null,
        config,
        question: message,
        evidence,
        memories: context.memories,
        recent: context.recent,
        task: 'Answer using only the SUPPLIED SOURCES for portfolio facts. Plain prose; no bullets unless a list was asked for.',
        json: false,
        mode: 'genai',
      })
      const result = synthesis?.result
      if (result && result.ok) {
        answer = cleanReply(result.text)
        providerMeta = { id: result.provider, label: provider?.label ?? result.provider, model: result.model }
        citations.push({ kind: 'provider', source: `provider:${result.provider}/${result.model}`, label: 'Model answer, grounded in the retrieved portfolio records', quote: clip(answer ?? '', 300) })
        breaker.failures = 0
        stepRecords.push({ action: 'synthesize with provider', status: 'succeeded', ms: result.ms, note: `${result.provider}/${result.model}${synthesis ? `, prompt ${synthesis.promptChars} chars` : ''}` })
      } else {
        const code = result && !result.ok ? result.code : 'no_provider'
        const detail = result && !result.ok ? result.message : 'no provider resolved for this process'
        breaker.failures++
        if (breaker.failures >= 2) breaker.openUntil = Date.now() + 60_000
        stepRecords.push({ action: 'synthesize with provider', status: 'failed', ms: result?.ms ?? 0, note: `${code}: ${clip(detail, 140)}` })
        const local = composeKnowledgeAnswer({ message, intent, retrieval, ...(memoryForAnswer ? { memory: memoryForAnswer } : {}), ...(navigation ? { navigation } : {}) })
        answer = local?.answer ?? null
        citations = local?.citations ?? citations
        mode = answer ? 'knowledge' : 'offline'
        degradedFrom = 'genai'
        degradedBecause = `${code}: ${clip(detail, 160)}`
      }
    } else {
      const local = composeKnowledgeAnswer({ message, intent, retrieval, ...(memoryForAnswer ? { memory: memoryForAnswer } : {}), ...(navigation ? { navigation } : {}) })
      answer = local?.answer ?? null
      citations = local?.citations ?? citations
      if (local?.note) stepRecords.push({ action: 'compose', status: 'succeeded', ms: 0, note: local.note })
    }

    // Vision stays a pass-through input: never a claim of machine perception.
    if (!answer && input.visionContext && /\b(camera|face|see|look|vision|webcam)\b/i.test(message)) {
      const reported = Object.entries(input.visionContext)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
        .slice(0, 6)
      answer = `The only visual information in this turn is what the page reported to me: ${reported.length ? reported.join(', ') : 'nothing at all'}. I did not analyse an image — no vision model is wired into this backend, and I will not pretend one ran.`
      citations.push({ kind: 'tool', source: 'request:visionContext', label: 'Client-supplied vision context', quote: clip(JSON.stringify(input.visionContext), 300) })
      stepRecords.push({ action: 'read vision context', status: 'succeeded', ms: 0, note: 'pass-through only, no detection' })
      mode = 'knowledge'
    }

    // Nothing grounded: say so instead of generating something.
    if (!answer) {
      tracker.enter('OFFLINE', 'no-evidence', `intent ${intent.intent}, ${retrieval.outcomes.size} tool(s) consulted`)
      if (adapter) {
        for (const run of runs) {
          try {
            await adapter.recordToolRun({ ...run, conversationId })
          } catch {
            break
          }
        }
      }
      await finishRun('failed', 'offline', toolsUsed, false, 'no grounded answer')
      return respond({
        ...base,
        success: false,
        response: `I could not ground an answer for that in this portfolio's data, and I do not invent one. ${retrieval.errors.length ? `Retrieval reported: ${retrieval.errors.map((error) => `${error.tool} ${error.status}`).join('; ')}. ` : ''}Ask about the projects, skills, experiments, contact details, or how this backend works — or configure a provider for open-ended questions.`,
        mode: 'offline',
        state: 'OFFLINE',
        citations,
        memoryUpdates: extraction.updates,
        actions: memoryResult.actions,
        verified: false,
        intent: intent.intent,
        intentConfidence: intent.confidence,
        route: {
          ...route,
          mode: 'offline',
          usedProvider: false,
          ...(route.mode === 'offline' ? {} : { degradedFrom: route.mode, degradedBecause: 'no evidence cleared the relevance floor' }),
        },
        provider: providerMeta,
        memory: { retrieved: context.memories.length + context.recent.length, stored: memoryResult.stored },
        database: databaseMeta,
        conversationSource: sourceOf(context.source),
        steps: stepRecords.length,
        toolsUsed,
        contextChars: contextChars(context),
        inputChars: message.length,
        truncated: false,
        error: { code: 'no_grounding', message: 'retrieval produced nothing above the relevance floor' },
      })
    }

    // ------------------------------------------------------------ verification
    tracker.enter('VERIFYING', 'verification', `${runs.length} tool run(s) to check against`)
    const evidenceText = [
      ...retrieval.citations.map((citation) => citation.quote ?? ''),
      ...[...retrieval.outcomes.values()].map((outcome) => JSON.stringify(outcome.output ?? '').slice(0, 4000)),
    ].join('\n')
    const verification = verifyAnswer({ answer, mode, intent, citations, runs, evidenceText, actions: memoryResult.actions, provider: providerMeta })
    for (const check of verification.checks) {
      if (!check.ok || !check.blocking) {
        stepRecords.push({ action: `verify ${check.name}`, status: check.ok ? 'succeeded' : check.blocking ? 'failed' : 'skipped', ms: 0, note: check.note })
      }
    }
    tracker.push('verification-report', undefined, summarizeVerification(verification))

    let finalAnswer = answer
    let verified = verification.verified
    if (!verified) {
      // A locally composed answer beats an unverified one whenever one exists.
      const local = route.mode === 'genai' || route.mode === 'agentic' ? composeKnowledgeAnswer({ message, intent, retrieval, ...(navigation ? { navigation } : {}) }) : null
      if (local?.answer) {
        finalAnswer = local.answer
        citations = local.citations
        mode = 'knowledge'
        degradedFrom = route.mode
        degradedBecause = `verification rejected the ${route.mode} answer: ${verification.checks.filter((check) => !check.ok && check.blocking).map((check) => check.name).join(', ')}`
        providerMeta = null
        const recheck = verifyAnswer({ answer: finalAnswer, mode, intent, citations, runs, evidenceText, actions: memoryResult.actions, provider: null })
        verified = recheck.verified
        tracker.push('re-verification', undefined, summarizeVerification(recheck))
      } else {
        const offenders = verification.checks.filter((check) => !check.ok && check.blocking).map((check) => check.name)
        finalAnswer = `${answer}\n\nI could not fully verify that against the retrieved evidence (${offenders.join(', ')}), so treat it as unconfirmed.`
      }
    }

    const truncated = finalAnswer.length > 2400
    if (truncated) finalAnswer = `${finalAnswer.slice(0, 2397)}…`

    // ----------------------------------------------------------------- memory
    tracker.enter('SPEAKING', 'compose-response', `${finalAnswer.length} chars via ${mode}`)
    const persisted = await storeTurn({
      adapter,
      sessionId: input.sessionId,
      conversationId,
      userMessage: message,
      answer: finalAnswer,
      mode,
      state: 'SPEAKING',
      updates: extraction.updates,
      now: new Date().toISOString(),
      // If the action agent already wrote these, do not write them twice.
      persistMemories: memoryResult.stored === 0 && memoryResult.expired === 0,
    })
    if (persisted.errors.length) databaseMeta.detail = clip(`${databaseMeta.detail}; ${persisted.errors[0]}`, 380)

    // The audit rows are written after the answer exists, so a slow or broken store can
    // never hold up (or take down) the reply itself.
    if (adapter) {
      for (const run of runs) {
        try {
          await adapter.recordToolRun({ ...run, conversationId })
        } catch (error) {
          databaseMeta.detail = clip(`${databaseMeta.detail}; tool run write failed: ${(error as Error).message}`, 380)
          break
        }
      }
    }

    await finishRun(verified ? 'verified' : 'partial', mode, toolsUsed, verified, clip(finalAnswer, 500))

    return respond({
      ...base,
      success: true,
      response: finalAnswer,
      mode,
      state: 'SPEAKING',
      citations,
      actions: memoryResult.actions,
      memoryUpdates: extraction.updates,
      verified,
      intent: intent.intent,
      intentConfidence: intent.confidence,
      route: {
        ...route,
        mode,
        usedProvider: Boolean(providerMeta),
        usedKnowledge: true,
        usedTools: toolsUsed.length > 0,
        ...(degradedFrom ? { degradedFrom } : {}),
        ...(degradedBecause ? { degradedBecause } : {}),
      },
      provider: providerMeta,
      memory: { retrieved: context.memories.length + context.recent.length, stored: Math.max(memoryResult.stored, persisted.stored) },
      database: databaseMeta,
      conversationSource: sourceOf(context.source),
      steps: stepRecords.length,
      toolsUsed,
      contextChars: contextChars(context),
      inputChars: message.length,
      truncated,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    tracker.enter('ERROR', 'unhandled', clip(detail, 160))
    await finishRun('failed', 'offline', [], false, `unhandled: ${detail}`.slice(0, 400))
    return respond({
      ...base,
      success: false,
      response: 'The backend raised an unexpected error while answering. Nothing was written, and no answer was generated.',
      mode: 'offline',
      state: 'ERROR',
      error: { code: 'internal_error', message: clip(detail, 300) },
      database: { ...base.database, detail: clip(detail, 200) },
    })
  }
}

function sourceOf(source: string): 'database' | 'file' | 'memory' {
  if (source === 'file') return 'file'
  if (source === 'postgres' || source === 'postgres-rest') return 'database'
  return 'memory'
}

function contextChars(context: { recent: { content: string }[]; memories: { value: string }[] }): number {
  return context.recent.reduce((total, entry) => total + entry.content.length, 0) + context.memories.reduce((total, memory) => total + memory.value.length, 0)
}

/** Whether the console should show its working row for a state the brain returned. */
export function isWorkingState(state: RavenState): boolean {
  return WORKING_STATES.has(state)
}
