/**
 * The reasoning / agentic layer.
 *
 * A turn that needs more than one record is executed as a short, explicit loop:
 * observe what retrieval already found → decide the gaps → call the registered tools to
 * close them → synthesise → hand the text to verification. The planner is deterministic
 * (a table of gap rules, not a model), so the plan is the same on every run and can be
 * asserted in a test.
 *
 * A model is used for *phrasing and judgement* when one is configured, and only after
 * the evidence is in hand. If it is not configured, or it fails, or it is rate limited,
 * the same evidence is composed locally and `providerFailure` records exactly what
 * happened — the answer never quietly becomes a guess.
 */
import type { Citation, ConversationMessageRecord, IntentMatch, MemoryRecord, ProviderResult, RavenMode, ToolRun } from '../types'
import type { RavenConfig } from '../config'
import type { ModelProvider } from '../types'
import type { RetrievalResult } from './research'
import type { ToolContext, ToolRegistry } from '../tools/registry'
import { buildMessages, cleanReply, extractJsonObject } from '../providers/prompt'
import type { GroundingInput } from '../providers/prompt'
import type { RetrievedDocument } from '../knowledge'
import { searchKnowledge } from '../knowledge'
import { pick } from './research'

export type PlanStep = { tool: string; input: Record<string, unknown>; action?: string }

export type AgenticInput = {
  message: string
  intent: IntentMatch
  retrieval: RetrievalResult
  registry: ToolRegistry
  context: ToolContext
  config: RavenConfig
  provider: ModelProvider | null
  memories: MemoryRecord[]
  recent: ConversationMessageRecord[]
  /** Every tool run of the turn, shared with the brain's audit list. */
  onRun?: (run: ToolRun) => void
}

export type AgenticResult = {
  goal: string
  answer: string
  citations: Citation[]
  steps: { action: string; tool?: string; status: ToolRun['status']; ms: number; note?: string }[]
  runs: ToolRun[]
  toolsUsed: string[]
  synthesizedBy: 'provider' | 'deterministic'
  provider: { id: string; label: string; model: string; ms: number } | null
  providerFailure: { code: string; message: string } | null
  evidence: EvidenceDocument[]
}

/** Evidence in one shape, so prompt building and verification see the same thing. */
export type EvidenceDocument = { id: string; title: string; body: string; score: number; tags: string[]; citation: Citation }

/** Turn recorded tool output into prompt-ready evidence. Nothing here is invented. */
export function evidenceFromRetrieval(retrieval: RetrievalResult, message: string): EvidenceDocument[] {
  const documents: EvidenceDocument[] = []
  const search = retrieval.outcomes.get('search_knowledge')
  for (const hit of pick<{ id: string; title: string; body: string; score: number; tags: string[] }[]>(search?.output ?? null, 'hits') ?? []) {
    documents.push({
      id: hit.id,
      title: hit.title,
      body: hit.body,
      score: hit.score,
      tags: hit.tags,
      citation: { kind: 'tool', source: `tool:search_knowledge → ${hit.id}`, label: hit.title, quote: hit.body.slice(0, 320) },
    })
  }
  for (const [tool, outcome] of retrieval.outcomes) {
    if (tool === 'search_knowledge' || outcome.status !== 'succeeded') continue
    for (const citation of outcome.citations ?? []) {
      if (!citation.quote) continue
      documents.push({ id: citation.source, title: citation.label, body: citation.quote, score: 1, tags: ['tool'], citation })
    }
  }
  if (!documents.length && message.trim().length > 2) {
    // Retrieval came back empty; say so with a scored retry rather than pretending the
    // corpus was consulted.
    for (const hit of searchKnowledge(message, { limit: 3 })) {
      documents.push({ id: hit.id, title: hit.title, body: hit.body, score: hit.score, tags: hit.tags, citation: hit.citation })
    }
  }
  const seen = new Set<string>()
  return documents.filter((document) => {
    const key = `${document.id}|${document.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Gap rules. Each entry can only ask for a tool that exists and has not already run,
 * which is what keeps a plan bounded without a model deciding how many steps to take.
 */
export function planAgentSteps(input: { intent: IntentMatch; message: string; alreadyRan: Set<string> }): { steps: PlanStep[]; notes: string[] } {
  const steps: PlanStep[] = []
  const notes: string[] = []
  const want = (step: PlanStep, why: string) => {
    if (input.alreadyRan.has(step.tool)) {
      notes.push(`skipped ${step.tool}: already executed this turn (${why})`)
      return
    }
    steps.push(step)
    notes.push(`${step.tool}: ${why}`)
  }

  if (input.intent.intent === 'compare.evaluate') {
    const ranked = searchKnowledge(input.message, { requireTags: ['project'], limit: 3 })
    if (!ranked.length) {
      want({ tool: 'list_projects', input: { includeMetrics: true } }, 'no project document matched the comparison terms, so all records are needed')
    }
    for (const hit of ranked.slice(0, 3)) {
      const slug = hit.id.replace(/^site\.project\./, '')
      if (slug.startsWith('site.') || slug === hit.id) continue
      want({ tool: 'get_project', input: { ref: slug } }, `compare needs the full record for "${hit.title}"`)
    }
    want({ tool: 'get_skills', input: {} }, 'criteria for "best" are read from the declared skill set' )
  } else if (input.intent.intent === 'plan.multistep') {
    want({ tool: 'search_knowledge', input: { query: input.message.slice(0, 200), limit: 4 } }, 'a plan has to start from what exists')
    want({ tool: 'list_projects', input: { includeMetrics: true } }, 'so the steps can point at real work rather than generic advice')
    want({ tool: 'get_skills', input: {} }, 'and at the skills this portfolio actually claims')
  } else {
    want({ tool: 'search_knowledge', input: { query: input.message.slice(0, 200), limit: 4 } }, 'retrieval found nothing usable; widen the search before answering')
  }

  return { steps: steps.slice(0, 8), notes }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/** Provider call with the failure paths made explicit. Shared with the genai mode. */
export async function synthesizeWithProvider(input: {
  provider: ModelProvider | null
  config: RavenConfig
  question: string
  evidence: EvidenceDocument[]
  memories: MemoryRecord[]
  recent: ConversationMessageRecord[]
  task: string
  json?: boolean
  mode: RavenMode
}): Promise<{ result: ProviderResult; promptChars: number } | null> {
  if (!input.provider) return null
  const sources: RetrievedDocument[] = input.evidence.map((document) => ({
    id: document.id,
    title: document.title,
    body: document.body,
    score: document.score,
    tags: document.tags,
    citation: document.citation,
    matched: [],
    phraseMatch: false,
  }))
  const grounding: GroundingInput = {
    question: input.question,
    sources,
    citations: input.evidence.map((document) => document.citation),
    recentMessages: input.recent,
    memories: input.memories,
    task: input.task,
    ...(input.json === undefined ? {} : { requireJson: input.json }),
  }
  const built = buildMessages(grounding, input.config.limits.contextCharBudget)
  const outcome = await input.provider.generate({
    messages: [{ role: 'system', content: built.system }, ...built.messages],
    temperature: input.config.provider.temperature,
    maxOutputTokens: input.config.provider.maxOutputTokens,
    ...(input.json ? { json: true } : {}),
  })
  return { result: outcome, promptChars: built.usedChars }
}

export async function runAgenticTurn(input: AgenticInput): Promise<AgenticResult> {
  const goal = `Answer "${clip(input.message, 110)}" using only retrieved portfolio evidence`
  const steps: AgenticResult['steps'] = []
  const runs: ToolRun[] = [...input.retrieval.runs]
  const citations: Citation[] = [...input.retrieval.citations]
  const toolsUsed = new Set<string>([...input.retrieval.outcomes.keys()].map((key) => key.split('#')[0]!))

  const alreadyRan = new Set(toolsUsed)
  const plan = planAgentSteps({ intent: input.intent, message: input.message, alreadyRan })
  const maxSteps = input.config.limits.agentMaxSteps

  for (const step of plan.steps.slice(0, maxSteps)) {
    const started = Date.now()
    if (!input.registry.has(step.tool)) {
      steps.push({ action: step.action ?? `call ${step.tool}`, tool: step.tool, status: 'rejected', ms: Date.now() - started, note: 'tool is not registered' })
      continue
    }
    const outcome = await input.registry.execute({ tool: step.tool, input: step.input }, input.context)
    runs.push(outcome.run)
    input.onRun?.(outcome.run)
    toolsUsed.add(step.tool)
    if (outcome.citations?.length) citations.push(...outcome.citations)
    steps.push({
      action: `${step.tool} for ${clip(Object.values(step.input)[0] === undefined ? 'portfolio evidence' : String(Object.values(step.input)[0]), 40)}`,
      tool: step.tool,
      status: outcome.status,
      ms: outcome.ms,
      ...(outcome.error ? { note: clip(outcome.error, 160) } : {}),
    })
  }

  const evidence = evidenceFromRetrieval({ ...input.retrieval, outcomes: input.retrieval.outcomes, citations }, input.message)

  // Optional synthesis by a model, never required for the turn to complete.
  let answer: string | null = null
  let provider: AgenticResult['provider'] = null
  let providerFailure: AgenticResult['providerFailure'] = null
  let synthesizedBy: AgenticResult['synthesizedBy'] = 'deterministic'

  if (input.provider) {
    const task =
      input.intent.intent === 'compare.evaluate'
        ? 'Compare the SUPPLIED SOURCES on the criteria visible in them (stack depth, documentation, status). Name the criteria in one line, rank the items, keep it under 90 words. Reply with {"answer": string}.'
        : input.intent.intent === 'plan.multistep'
          ? 'Produce at most four concrete next steps for this goal, each tied to a named record from the SUPPLIED SOURCES. Reply with {"answer": string}.'
          : 'Answer using only the SUPPLIED SOURCES. Reply with {"answer": string}.'
    const synthesis = await synthesizeWithProvider({
      provider: input.provider,
      config: input.config,
      question: input.message,
      evidence,
      memories: input.memories,
      recent: input.recent,
      task,
      json: true,
      mode: 'agentic',
    })
    const started = Date.now()
    if (synthesis) {
      const result = synthesis.result
      if (result.ok) {
        const parsed = extractJsonObject(result.text)
        const candidate = typeof parsed?.answer === 'string' ? parsed.answer : result.text
        answer = cleanReply(candidate)
        provider = { id: result.provider, label: input.provider.label, model: result.model, ms: result.ms }
        synthesizedBy = 'provider'
        citations.push({ kind: 'provider', source: `provider:${result.provider}/${result.model}`, label: 'Model synthesis over the retrieved evidence', quote: clip(answer ?? '', 300) })
        steps.push({ action: 'synthesize with provider', status: 'succeeded', ms: result.ms || Date.now() - started, note: `${result.provider}/${result.model}, prompt ${synthesis.promptChars} chars` })
      } else {
        providerFailure = { code: result.code, message: clip(result.message, 220) }
        steps.push({ action: 'synthesize with provider', status: 'failed', ms: result.ms || Date.now() - started, note: `${result.code}: ${clip(result.message, 140)}` })
      }
    }
  }

  if (!answer) {
    answer = composeDeterministically({ intent: input.intent, message: input.message, evidence, steps, providerFailure })
  }

  return {
    goal,
    answer,
    citations,
    steps,
    runs,
    toolsUsed: [...toolsUsed],
    synthesizedBy,
    provider,
    providerFailure,
    evidence,
  }
}

/**
 * The no-model synthesis path for multi-step questions: a lexical ranking with its
 * method stated, or a scaffold built from the records that were actually retrieved.
 */
function composeDeterministically(input: {
  intent: IntentMatch
  message: string
  evidence: EvidenceDocument[]
  steps: AgenticResult['steps']
  providerFailure: { code: string; message: string } | null
}): string {
  const bullet = '\n- '
  const prefix = input.providerFailure ? `No model was used (${input.providerFailure.code}), so this is assembled from the records themselves.` : 'Assembled from the retrieved records; no model was involved.'
  const titles = input.evidence.map((document) => document.title)
  const bodies = input.evidence.filter((document) => document.tags.includes('project') || document.id.startsWith('site.project.'))

  if (input.intent.intent === 'compare.evaluate') {
    const ranked = searchKnowledge(input.message, { requireTags: ['project'], limit: 4 })
    if (ranked.length) {
      const lines = ranked.map((hit, index) => `${index + 1}. ${hit.title} — match strength ${hit.score.toFixed(2)}${hit.phraseMatch ? ' (phrase match)' : ''}`)
      return `${prefix} Ranked by how directly each portfolio record matches your own words — a lexical measure, not a quality judgement.${bullet}${lines.join(bullet)}`
    }
    const projects = input.evidence.filter((document) => document.id.startsWith('siteConfig.projects'))
    return `${prefix} Nothing in the corpus matched the terms closely enough to rank. ${projects.length ? `The portfolio documents ${projects.length} project record(s); ask about one by name and I can go deeper.` : 'Ask about a specific project and I can go deeper.'}`
  }

  if (input.intent.intent === 'plan.multistep') {
    const anchors = (bodies.length ? bodies.map((document) => document.title) : titles).slice(0, 3)
    const lines = [
      anchors.length ? `Start from what is already documented: ${anchors.join(', ')}.` : 'Start by naming one artifact to build, since nothing in the portfolio matched.',
      'Keep the retrieval layer separate from the model layer — the local answer must work with no provider at all.',
      'Write the schema first; the memory layer is only trustworthy if what is stored is explicit.',
      'Verify each claim against a recorded tool run before saying it out loud.',
    ]
    return `${prefix} A scaffold, not a guess:${bullet}${lines.map((line, index) => `${index + 1}. ${line}`).join(bullet)}`
  }

  if (input.evidence.length) {
    const lines = input.evidence.slice(0, 3).map((document) => `${document.title} — ${clip(document.body.replace(/\n+/g, ' '), 220)}`)
    return `${prefix}${bullet}${lines.join(bullet)}`
  }
  return `${prefix} Retrieval returned nothing for this question, so there is no grounded answer to give.`
}
