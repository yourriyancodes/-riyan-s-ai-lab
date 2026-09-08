/**
 * Retrieval planning: turns a classified intent into concrete tool calls, executes them
 * through the registry, and hands the *tool outputs* to the composer.
 *
 * That indirection is the point. The knowledge agent never reaches into `siteConfig`
 * itself, so every sentence in an answer can be traced back to a recorded, timed,
 * schema-validated tool run — which is what makes `verified: true` mean something.
 */
import type { Citation, IntentMatch, ToolCall, ToolRun } from '../types'
import type { ExecutedTool, ToolContext, ToolRegistry } from '../tools/registry'
import { findProject } from '../knowledge/corpus'

export type RetrievalPlan = { calls: ToolCall[]; rationale: string[] }

/** Choose the tool calls that can answer this turn. Deterministic, and cheap to audit. */
export function planRetrieval(input: { intent: IntentMatch; message: string }): RetrievalPlan {
  const { intent, message } = input
  const calls: ToolCall[] = []
  const rationale: string[] = []
  const projectRef = typeof intent.entities.project === 'string' ? intent.entities.project : null
  const section = typeof intent.entities.section === 'string' ? intent.entities.section : null
  const push = (call: ToolCall, why: string) => {
    calls.push(call)
    rationale.push(why)
  }

  switch (intent.intent) {
    case 'identity.raven':
      push({ tool: 'get_raven', input: {} }, 'RAVEN self-description is a corpus record, not a model recollection')
      break
    case 'identity.riyan':
      push({ tool: 'get_profile', input: {} }, 'identity claims come from the portfolio profile record')
      push({ tool: 'list_projects', input: {} }, 'so the answer can say what the work is, not just who he is')
      break
    case 'capability.probe':
      push({ tool: 'system_status', input: {} }, 'capability answers are read from live runtime state')
      break
    case 'portfolio.projects':
      push({ tool: 'list_projects', input: { includeMetrics: false } }, 'project cards are the source of the list')
      break
    case 'portfolio.project':
      if (projectRef) {
        push({ tool: 'get_project', input: { ref: projectRef } }, `project resolved from the message: "${projectRef}"`)
      } else {
        push({ tool: 'list_projects', input: {} }, 'no specific project could be resolved, so the list is the honest answer')
      }
      break
    case 'portfolio.skills':
      push({ tool: 'get_skills', input: {} }, 'skills are read from the focus list and the skill-graph nodes')
      break
    case 'portfolio.contact':
      push({ tool: 'get_contact', input: {} }, 'only links that exist in the data are returned')
      break
    case 'portfolio.experiments':
      push({ tool: 'get_experiments', input: {} }, 'experiment labels come from the page data')
      break
    case 'portfolio.sections':
      push({ tool: 'get_sections', input: {} }, 'section ids and titles come from the section registry')
      if (section) push({ tool: 'request_navigation', input: { section } }, 'a section was named, so propose scrolling to it')
      break
    case 'memory.recall':
      push({ tool: 'recall_memories', input: { limit: 12 } }, 'recall is served from the store, never from a model memory')
      break
    case 'memory.remember':
      // The write itself is executed by the action agent from extracted candidates;
      // retrieval only needs to confirm what is now on record.
      push({ tool: 'recall_memories', input: { limit: 12 } }, 'confirm what the session already holds')
      break
    case 'action.navigate':
      if (section) push({ tool: 'request_navigation', input: { section } }, 'navigation is an action: proposed, then client-approved')
      else push({ tool: 'get_sections', input: {} }, 'no section could be resolved; show what exists instead of guessing')
      break
    case 'explain.concept': {
      const term = extractTerm(message)
      if (term) push({ tool: 'lookup_concept', input: { term } }, 'the local glossary is tried before any model is')
      push({ tool: 'search_knowledge', input: { query: message.slice(0, 200), limit: 3 } }, 'portfolio documents that mention the term')
      break
    }
    case 'compare.evaluate':
    case 'plan.multistep':
      push({ tool: 'list_projects', input: { includeMetrics: true } }, 'comparison needs every record, not the top hit')
      push({ tool: 'get_skills', input: {} }, 'and the capability list, so criteria are grounded')
      break
    case 'greeting':
    case 'smalltalk':
      break
    case 'unknown':
    default:
      push({ tool: 'search_knowledge', input: { query: message.slice(0, 200), limit: 4 } }, 'no rule matched, so the corpus gets the first chance to answer')
      break
  }

  // Never ask for a tool that does not exist: the planner is checked against the
  // registry by the caller, and unknown names are dropped here as a second line.
  return { calls, rationale }
}

const QUESTION_WORDS = /^(what|whats|how|why|explain|define|tell|me|about|is|are|the|a|an|of|in|to|does|do|can|you|please|simply|terms|mean|means|work|works)\b/i

/** Strip the interrogative shell off "what is RAG" to get a lookup term. */
export function extractTerm(message: string): string | null {
  const cleaned = message
    .toLowerCase()
    .replace(/[?!.]+$/g, '')
    .replace(/\b(in simple terms|please|can you|could you|tell me|explain to me|what is|what are|what does|how does|how do|define|meaning of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || cleaned.length < 2) return null
  const words = cleaned.split(' ').filter((word) => word.length > 1 && !QUESTION_WORDS.test(word))
  const term = (words.length ? words.slice(0, 4).join(' ') : cleaned).trim()
  return term.length >= 2 ? term : null
}

export type RetrievalResult = {
  outcomes: Map<string, ExecutedTool>
  /** Every tool run behind this answer, in execution order. */
  runs: ToolRun[]
  citations: Citation[]
  calls: ToolCall[]
  /** Reasons the planner attached to each call, paired with the executed steps. */
  rationale: string[]
  errors: { tool: string; error: string; status: string }[]
  succeeded: number
  total: number
}

/** Execute a plan and collect what came back. Nothing here throws. */
export async function runRetrieval(registry: ToolRegistry, plan: RetrievalPlan, context: ToolContext, onRun?: (run: ToolRun) => void): Promise<RetrievalResult> {
  const outcomes = new Map<string, ExecutedTool>()
  const runs: ToolRun[] = []
  const citations: Citation[] = []
  const errors: RetrievalResult['errors'] = []
  const calls: ToolCall[] = []
  let succeeded = 0

  for (const [index, call] of plan.calls.entries()) {
    if (!registry.has(call.tool)) {
      errors.push({ tool: call.tool, error: 'not registered in the tool registry', status: 'rejected' })
      continue
    }
    calls.push(call)
    const outcome = await registry.execute(call, context)
    runs.push(outcome.run)
    onRun?.(outcome.run)
    outcomes.set(call.tool, outcome)
    if (outcome.citations?.length) citations.push(...outcome.citations)
    if (outcome.status === 'succeeded') succeeded++
    else errors.push({ tool: call.tool, error: outcome.error ?? outcome.status, status: outcome.status })
    // Keep the plan readable in the trace even when two calls hit the same tool.
    if (plan.calls.filter((entry) => entry.tool === call.tool).length > 1) {
      outcomes.set(`${call.tool}#${index}`, outcome)
    }
  }

  // De-duplicate citations by source+label: the same card should not appear three times.
  const seen = new Set<string>()
  const unique = citations.filter((citation) => {
    const key = `${citation.kind}:${citation.source}:${citation.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { outcomes, runs, citations: unique, calls, rationale: plan.rationale, errors, succeeded, total: plan.calls.length }
}

/** Read a nested field out of a tool output without asserting types we do not have. */
export function pick<T>(value: unknown, ...path: (string | number)[]): T | undefined {
  let current: unknown = value
  for (const key of path) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current === undefined ? undefined : (current as T)
}

/** Used by the composer to report "the tool said nothing" instead of inventing a line. */
export function outcomeFor(retrieval: RetrievalResult, tool: string): ExecutedTool | undefined {
  const direct = retrieval.outcomes.get(tool)
  if (direct) return direct
  for (const [key, value] of retrieval.outcomes) if (key.startsWith(`${tool}#`)) return value
  return undefined
}

export function resolveProjectReference(message: string): string | null {
  const named = findProject(message)
  return named?.name ?? null
}
