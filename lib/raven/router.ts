/**
 * The router: one place that decides which engine answers, given the classified intent
 * and what is actually available right now.
 *
 * Two rules make this file worth reading. First, availability is checked against real
 * state — a provider without a key is not "available", a database that failed to open
 * is not "configured". Second, every degradation is named: when the preferred mode was
 * unavailable, the decision records which mode was wanted and why it was skipped, and
 * that pair travels to the client instead of being smoothed over.
 */
import type { IntentMatch, RavenMode, RouteDecision } from './types'

export type RouterCapabilities = {
  /** A provider was resolvable *and* has credentials. */
  providerAvailable: boolean
  /** Always true today: the corpus is bundled, so knowledge never depends on a service. */
  knowledgeAvailable: boolean
  databaseAvailable: boolean
  /** Provider probe previously failed; used to prefer knowledge even when a key exists. */
  providerKnownFailing: boolean
}

/** Intents the deterministic layer answers completely on its own. */
const KNOWLEDGE_INTENTS = new Set([
  'greeting',
  'smalltalk',
  'identity.raven',
  'identity.riyan',
  'capability.probe',
  'portfolio.projects',
  'portfolio.project',
  'portfolio.skills',
  'portfolio.sections',
  'portfolio.experiments',
  'portfolio.contact',
  'memory.recall',
  'memory.remember',
  'action.navigate',
])

/** Intents that need multi-step reasoning over several records, tools included. */
const AGENTIC_INTENTS = new Set(['compare.evaluate', 'plan.multistep'])

/** Intents where a language model genuinely helps but is optional. */
const EXPLAIN_INTENTS = new Set(['explain.concept', 'unknown'])

export type RouteInput = {
  intent: IntentMatch
  capabilities: RouterCapabilities
  /** Restrict modes (tests, or a client that switched GenAI off). */
  allowedModes?: RavenMode[]
}

export function routeTurn({ intent, capabilities, allowedModes }: RouteInput): RouteDecision {
  const allowed = new Set<RavenMode>(allowedModes?.length ? allowedModes : ['knowledge', 'genai', 'agentic', 'offline'])
  const canUseProvider = capabilities.providerAvailable && !capabilities.providerKnownFailing && allowed.has('genai')
  const reasons: string[] = [`intent ${intent.intent} (confidence ${intent.confidence.toFixed(2)})`]
  if (!capabilities.providerAvailable) reasons.push('no provider credentials resolved')
  else if (capabilities.providerKnownFailing) reasons.push('provider previously failed this process; local engines preferred')
  if (allowedModes?.length) reasons.push(`modes restricted to ${[...allowed].join('+')}`)

  const decide = (mode: RavenMode, extra: { usedKnowledge?: boolean; usedProvider?: boolean; usedTools?: boolean; degradedFrom?: RavenMode; degradedBecause?: string }): RouteDecision => ({
    mode,
    usedKnowledge: extra.usedKnowledge ?? mode !== 'offline',
    usedProvider: extra.usedProvider ?? mode === 'genai',
    usedTools: extra.usedTools ?? mode === 'agentic',
    reasons,
    ...(extra.degradedFrom ? { degradedFrom: extra.degradedFrom } : {}),
    ...(extra.degradedBecause ? { degradedBecause: extra.degradedBecause } : {}),
  })

  if (KNOWLEDGE_INTENTS.has(intent.intent)) {
    // Memory and navigation intents still run tools; the mode stays "knowledge"
    // because the answer itself comes from local data.
    const usesTools = intent.intent === 'memory.remember' || intent.intent === 'memory.recall' || intent.intent === 'action.navigate'
    return decide('knowledge', { usedTools: usesTools })
  }

  if (AGENTIC_INTENTS.has(intent.intent)) {
    // Agentic planning is deterministic; a provider is used inside it when available.
    const decision = decide('agentic', { usedTools: true, usedProvider: canUseProvider, usedKnowledge: true })
    if (!capabilities.knowledgeAvailable) {
      return decide('offline', { degradedFrom: 'agentic', degradedBecause: 'no local corpus to plan against', usedTools: true })
    }
    if (canUseProvider) decision.reasons.push('provider will be used for synthesis only; every claim is still retrieved')
    return decision
  }

  if (EXPLAIN_INTENTS.has(intent.intent)) {
    if (canUseProvider) return decide('genai', { usedKnowledge: true })
    // Without a model, an explanation is only honest if the corpus defines the term; the
    // composer returns null when it does not, and the turn ends up in `offline`.
    return decide('knowledge', {
      ...(capabilities.providerAvailable && capabilities.providerKnownFailing
        ? { degradedFrom: 'genai' as RavenMode, degradedBecause: 'provider endpoint is failing; answering from the local glossary' }
        : {}),
    })
  }

  // 'unknown': no rule claimed it. Try knowledge retrieval, and only if that is empty
  // say so honestly rather than guessing.
  if (capabilities.knowledgeAvailable) {
    const decision = decide('knowledge', {})
    decision.reasons.push('no intent rule matched; retrieval will decide whether anything can be said')
    return decision
  }
  return decide('offline', { usedKnowledge: false, degradedBecause: 'no intent match and no local corpus' })
}

/** Whether the router expects the agentic pipeline to run — used by the trace. */
export function isAgentic(decision: RouteDecision): boolean {
  return decision.mode === 'agentic'
}
