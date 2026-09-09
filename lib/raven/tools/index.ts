/**
 * The registered tools. Each entry is a schema + handler pair, and the schema is the
 * contract the router validates against — so a plan produced by a model cannot ask for
 * a 40 kB query or an unregistered tool name and have it executed.
 *
 * Nothing here hits the network. `system_status` reports what the process already
 * knows. That keeps the agentic loop fast, deterministic, and testable, and it means an
 * action is only ever "executed" when a local effect genuinely happened.
 */
import { focusAreas, glossary, skillNodes } from '@/data/ravenKnowledge'
import { ToolRegistry, type ToolHandler } from './registry'
import { describeCapabilities } from '../config'
import { providerBreakerState } from '../breaker'
import { peekDatabaseHandle } from '../db'
import {
  contact,
  corpusStats,
  experiments,
  findProject,
  listGlossary,
  lookupGlossary,
  profile,
  projects,
  raven,
  sections,
  systemStatus,
} from '../knowledge/corpus'
import { searchKnowledge } from '../knowledge'
import type { Citation, ToolSpec } from '../types'

const siteCitation = (source: string, label: string, locator: string, quote?: string): Citation => ({
  kind: 'siteConfig',
  source,
  label,
  locator,
  ...(quote ? { quote: quote.length > 320 ? `${quote.slice(0, 317)}...` : quote } : {}),
})

const Q = (maxLength: number) => ({
  query: { type: 'string' as const, required: true, minLength: 2, maxLength, description: 'Words to look for; no operators needed.' },
})

export const TOOL_SPECS: { spec: ToolSpec; handler: string }[] = [
  {
    spec: {
      name: 'search_knowledge',
      description: 'Lexical search over the bundled portfolio knowledge corpus. Returns ranked documents with ids you can quote.',
      permission: 'read',
      timeoutMs: 2000,
      parameters: {
        ...Q(240),
        limit: { type: 'number', minimum: 1, maximum: 10, description: 'Maximum hits (default 4).' },
        tag: { type: 'string', maxLength: 40, description: 'Restrict to one tag, e.g. "project".' },
      },
    },
    handler: 'search_knowledge',
  },
  {
    spec: {
      name: 'list_projects',
      description: 'All portfolio projects with number, status, technology and one-line description.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: { includeMetrics: { type: 'boolean', description: 'Include the metric strings shown on the cards.' } },
    },
    handler: 'list_projects',
  },
  {
    spec: {
      name: 'get_project',
      description: 'One project by name, slug or number, including architecture, highlights and stack when the portfolio documents them.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: { ref: { type: 'string', required: true, minLength: 1, maxLength: 80, description: 'Project name, slug, or number such as "03".' } },
    },
    handler: 'get_project',
  },
  {
    spec: {
      name: 'get_skills',
      description: 'Focus areas and skill graph nodes declared by the portfolio.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: { category: { type: 'string', maxLength: 40, description: 'Optional skill-node category filter.' } },
    },
    handler: 'get_skills',
  },
  {
    spec: {
      name: 'get_profile',
      description: 'Who Riyan Pasha is according to this portfolio: roles, intro, about, focus areas, working loop.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: {},
    },
    handler: 'get_profile',
  },
  {
    spec: {
      name: 'get_raven',
      description: 'RAVEN self-description: purpose, capabilities, architecture layers, and the limits it will not paper over.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: {},
    },
    handler: 'get_raven',
  },
  {
    spec: {
      name: 'get_contact',
      description: 'Contact links actually published in the portfolio. An empty result is the honest answer, not a failure.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: {},
    },
    handler: 'get_contact',
  },
  {
    spec: {
      name: 'get_experiments',
      description: 'Experiment list with the status labels shown on the page.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: {},
    },
    handler: 'get_experiments',
  },
  {
    spec: {
      name: 'get_sections',
      description: 'Page sections with their ids and headings.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: {},
    },
    handler: 'get_sections',
  },
  {
    spec: {
      name: 'lookup_concept',
      description: 'Explain a computer-science concept from the local glossary, including why it matters to this portfolio.',
      permission: 'read',
      timeoutMs: 1500,
      parameters: { term: { type: 'string', required: true, minLength: 2, maxLength: 60 } },
    },
    handler: 'lookup_concept',
  },
  {
    spec: {
      name: 'system_status',
      description: 'What this backend can currently do: provider, database, corpus, state machine, tool list.',
      permission: 'compute',
      timeoutMs: 1500,
      parameters: {},
    },
    handler: 'system_status',
  },
  {
    spec: {
      name: 'estimate_token_cost',
      description: 'Arithmetic estimate of what a prompt would cost against listed provider prices. An estimate, not a bill.',
      permission: 'compute',
      timeoutMs: 1000,
      parameters: {
        promptChars: { type: 'number', required: true, minimum: 1, maximum: 5_000_000 },
        completionChars: { type: 'number', minimum: 0, maximum: 5_000_000 },
        model: { type: 'string', maxLength: 40, enum: ['gemini-2.5-flash', 'gemini-2.5-pro', 'openai-compatible-local'], description: 'Which price sheet to use.' },
      },
    },
    handler: 'estimate_token_cost',
  },
  {
    spec: {
      name: 'recall_memories',
      description: 'Read durable facts stored for this session, optionally filtered by terms.',
      permission: 'read',
      timeoutMs: 2000,
      parameters: { terms: { type: 'array', itemType: 'string', maxLength: 6 }, limit: { type: 'number', minimum: 1, maximum: 40 } },
    },
    handler: 'recall_memories',
  },
  {
    spec: {
      name: 'remember_fact',
      description: 'Write one durable fact for this session. Used when the user explicitly asks RAVEN to remember something.',
      permission: 'action',
      timeoutMs: 2000,
      requiresApproval: false,
      parameters: {
        key: { type: 'string', required: true, minLength: 1, maxLength: 48 },
        value: { type: 'string', required: true, minLength: 1, maxLength: 220 },
        importance: { type: 'number', minimum: 0.1, maximum: 1 },
      },
    },
    handler: 'remember_fact',
  },
  {
    spec: {
      name: 'forget_fact',
      description: "Delete one durable fact for this session, when the user asks RAVEN to forget it.",
      permission: 'action',
      timeoutMs: 2000,
      requiresApproval: false,
      parameters: { key: { type: 'string', required: true, minLength: 1, maxLength: 48 } },
    },
    handler: 'forget_fact',
  },
  {
    spec: {
      name: 'request_navigation',
      description: 'Propose scrolling the page to a section. Executed only when the request approved it.',
      permission: 'action',
      timeoutMs: 1000,
      requiresApproval: true,
      parameters: { section: { type: 'string', required: true, enum: sections.map((section) => section.id) } },
    },
    handler: 'request_navigation',
  },
]

const handlers: Record<string, ToolHandler> = {
  search_knowledge: (input) => {
    const hits = searchKnowledge(String(input.query), {
      limit: Number(input.limit ?? 4),
      ...(input.tag ? { requireTags: [String(input.tag)] } : {}),
    })
    return {
      output: {
        query: String(input.query),
        hits: hits.map((hit) => ({ id: hit.id, title: hit.title, score: hit.score, tags: hit.tags, body: hit.body, matched: hit.matched, phraseMatch: hit.phraseMatch })),
        total: hits.length,
      },
      citations: hits.map((hit) => hit.citation),
      ...(hits.length ? {} : { note: 'no document cleared the relevance floor' }),
    }
  },

  list_projects: (input) => ({
    output: {
      count: projects.length,
      projects: projects.map((project, index) => ({
        number: project.number,
        name: project.name,
        slug: project.slug,
        status: project.status,
        technology: project.technology,
        description: project.description,
        ...((input.includeMetrics ?? false) && project.detail ? { metrics: project.detail.highlights.slice(0, 3) } : {}),
        documented: Boolean(project.detail),
        index,
      })),
    },
    citations: [siteCitation('siteConfig.projects', 'Portfolio project list', 'data/siteConfig.ts → projects', projects.map((project) => `${project.number} ${project.name}`).join(', '))],
  }),

  get_project: (input) => {
    const project = findProject(String(input.ref))
    if (!project) {
      return {
        output: { found: false, ref: String(input.ref), available: projects.map((entry) => entry.name) },
        note: `no portfolio project matches "${String(input.ref)}"`,
      }
    }
    const detail = project.detail
    return {
      output: {
        found: true,
        number: project.number,
        name: project.name,
        slug: project.slug,
        status: project.status,
        technology: project.technology,
        description: project.description,
        ...(detail
          ? { overview: detail.overview, architecture: detail.architecture, highlights: detail.highlights, stack: detail.stack }
          : { overview: null, note: 'the portfolio card for this project has no detail entry' }),
      },
      citations: [
        siteCitation(
          'siteConfig.projects',
          `${project.name} card`,
          `data/siteConfig.ts → projects[${projects.indexOf(project)}]`,
          detail ? `${detail.overview}\nArchitecture: ${detail.architecture}` : project.description,
        ),
      ],
    }
  },

  get_skills: (input) => {
    const category = input.category ? String(input.category).toLowerCase() : null
    const nodes = skillNodes.filter((node) => !category || node.category.toLowerCase().includes(category) || node.name.toLowerCase().includes(category))
    return {
      output: {
        focusAreas: [...focusAreas],
        profileFocusAreas: profile.focusAreas,
        skillNodes: nodes,
        glossaryTopics: listGlossary().map((entry) => entry.term),
      },
      citations: [
        siteCitation('siteConfig.skills', 'Focus constellation list on the skills section', 'app/page.tsx → FOCUS + data/siteConfig.ts', focusAreas.join(', ')),
        siteCitation('NeuralGraph.skillNodes', 'Skill graph nodes', 'components/NeuralGraph.tsx → SKILL_NODES', nodes.map((node) => node.name).join(', ')),
      ],
    }
  },

  get_profile: () => ({
    output: {
      name: profile.name,
      roles: profile.roles,
      intro: profile.intro,
      about: profile.about,
      focusAreas: profile.focusAreas,
      journey: profile.journey,
    },
    citations: [siteCitation('siteConfig', 'Portfolio identity data', 'data/siteConfig.ts', `${profile.intro}\n${profile.about}`)],
  }),

  get_raven: () => ({
    output: {
      name: raven.name,
      expansion: raven.expansion,
      role: raven.role,
      summary: raven.summary,
      capabilities: raven.capabilities,
      honestLimits: raven.honestLimits,
      layers: raven.layers,
    },
    citations: [siteCitation('siteConfig.layers', 'RAVEN architecture layers', 'data/siteConfig.ts → layers', raven.layers.map((layer) => `${layer.name}: ${layer.note}`).join('; '))],
  }),

  get_contact: () => ({
    output: {
      published: contact.published,
      links: contact.links,
      ...(contact.published ? {} : { note: 'No contact URL or email is published in data/siteConfig.ts yet.' }),
    },
    citations: [siteCitation('siteConfig.socialLinks', 'Social links block', 'data/siteConfig.ts → socialLinks', contact.links.length ? contact.links.map((link) => `${link.label}: ${link.url}`).join(', ') : '(empty)')],
  }),

  get_experiments: () => ({
    output: { experiments },
    citations: [siteCitation('siteConfig.experiments', 'Experiment list', 'data/siteConfig.ts → experiments', experiments.map((entry) => `${entry.name} — ${entry.status}`).join(', '))],
  }),

  get_sections: () => ({
    output: { sections },
    citations: [siteCitation('siteSections', 'Page sections', 'data/ravenKnowledge.ts → siteSections', sections.map((section) => `${section.id}: ${section.title}`).join(', '))],
  }),

  lookup_concept: (input) => {
    const entry = lookupGlossary(String(input.term))
    if (!entry) {
      return {
        output: { found: false, term: String(input.term), known: glossary.map((item) => item.term) },
        note: `the glossary has no entry for "${String(input.term)}"`,
      }
    }
    return {
      output: { found: true, term: entry.term, definition: entry.definition, aliases: entry.aliases, relevance: entry.relevance },
      citations: [{ kind: 'knowledge', source: `glossary.${entry.id}`, label: `Glossary: ${entry.term}`, locator: 'data/ravenKnowledge.ts → glossary', quote: entry.definition }],
    }
  },

  system_status: (_input, context) => {
    const capabilities = describeCapabilities(context.config)
    const breaker = providerBreakerState()
    const handle = peekDatabaseHandle()
    const stats = corpusStats()
    return {
      output: {
        provider: {
          configured: capabilities.providerConfigured,
          id: capabilities.providerId,
          label: capabilities.providerLabel,
          model: capabilities.providerModel,
          // Reachability and authorization are measured by `GET /api/health`, which is the
          // route allowed to spend a probe. This tool never touches the network — so what it
          // reports is what *this process* observed: whether the endpoint has been refusing.
          failing: breaker.open,
          consecutiveFailures: breaker.failures,
        },
        database: handle
          ? { driver: handle.driver, reachable: handle.adapter.status().reachable, detail: handle.adapter.status().detail, degradedFrom: handle.notes }
          : { driver: null, reachable: false, detail: 'not resolved yet' },
        knowledge: stats,
        states: ['IDLE', 'LISTENING', 'THINKING', 'REASONING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'VISION', 'UNDERSTANDING', 'RESEARCHING', 'PLANNING', 'OFFLINE', 'ERROR'],
        tools: TOOL_SPECS.map((entry) => entry.spec.name),
        voice: { configured: capabilities.voiceConfigured },
        sessionSecret: capabilities.sessionSecretConfigured,
        systemStatusLabels: systemStatus,
      },
      citations: [{ kind: 'database', source: 'runtime:capabilities', label: 'Live backend capability report', quote: `provider=${capabilities.providerId ?? 'none'} database=${handle?.driver ?? 'unresolved'} corpus=${stats.documents} docs` }],
    }
  },

  estimate_token_cost: (input) => {
    const promptChars = Number(input.promptChars)
    const completionChars = Number(input.completionChars ?? 0)
    const model = String(input.model ?? 'gemini-2.5-flash')
    // List prices as published for the Gemini API tier this project targets. They are
    // quoted per 1M tokens and change; the tool says so instead of pretending to a bill.
    const priceSheet: Record<string, { input: number; output: number; label: string }> = {
      'gemini-2.5-flash': { input: 0.3, output: 2.5, label: 'Gemini 2.5 Flash, USD per 1M tokens (list price)' },
      'gemini-2.5-pro': { input: 1.25, output: 10, label: 'Gemini 2.5 Pro, USD per 1M tokens (list price)' },
      'openai-compatible-local': { input: 0, output: 0, label: 'Local OpenAI-compatible server (Ollama / LM Studio): no per-token cost' },
    }
    const price = priceSheet[model] ?? priceSheet['gemini-2.5-flash']
    const inputTokens = Math.ceil(promptChars / 4)
    const outputTokens = Math.ceil(completionChars / 4)
    const usd = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
    const rate = Number(process.env.RAVEN_USD_INR ?? 84) || 84
    return {
      output: {
        model,
        method: 'tokens ≈ ceil(chars / 4) — a character heuristic, not a tokenizer run',
        inputTokens,
        outputTokens,
        priceBasis: price.label,
        usd: Number(usd.toFixed(8)),
        inr: Number((usd * rate).toFixed(8)),
        usdToInrAssumed: rate,
        perMillionRunsEstimate: price.input + price.output > 0 ? Number((((price.input + price.output) / 1_000_000) * (inputTokens + outputTokens)).toFixed(4)) : 0,
      },
      note: 'Estimate only: providers bill their own token counts, and pricing pages change.',
    }
  },

  recall_memories: async (input, context) => {
    if (!context.adapter) return { output: { memories: [], source: 'none' }, note: 'no persistence adapter is available in this process' }
    const terms = Array.isArray(input.terms) ? (input.terms as string[]).map(String).slice(0, 6) : []
    const limit = Number(input.limit ?? 12)
    const found = terms.length ? await context.adapter.searchMemories(context.sessionId, terms, limit) : []
    const memories = found.length ? found : await context.adapter.recallMemories(context.sessionId, limit)
    return {
      output: {
        source: context.adapter.status().driver,
        count: memories.length,
        memories: memories.map((memory) => ({ key: memory.key, value: memory.value, importance: memory.importance, updatedAt: memory.updatedAt, source: memory.source })),
      },
      citations: [{ kind: 'memory', source: `database:${context.adapter.status().driver}`, label: 'Session memory', quote: memories.map((memory) => `${memory.key}=${memory.value}`).join('; ').slice(0, 300) }],
    }
  },

  remember_fact: async (input, context) => {
    if (!context.adapter) {
      return { output: { persisted: false, reason: 'no persistence adapter' }, note: 'RAVEN has nowhere durable to write in this process' }
    }
    const key = String(input.key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48)
    const value = String(input.value).replace(/\s+/g, ' ').slice(0, 220)
    const now = context.now()
    await context.adapter.remember({
      id: `mem-${context.sessionId.slice(-8)}-${key}`,
      sessionId: context.sessionId,
      key,
      value,
      importance: Number(input.importance ?? 0.75),
      source: 'explicit',
      createdAt: now,
      updatedAt: now,
    })
    return {
      output: { persisted: true, key, value, driver: context.adapter.status().driver },
      citations: [{ kind: 'memory', source: `database:${context.adapter.status().driver}`, label: 'Stored fact', quote: `${key}=${value}` }],
    }
  },

  forget_fact: async (input, context) => {
    if (!context.adapter) return { output: { persisted: false, reason: 'no persistence adapter' }, note: 'nothing was deleted: this process has no durable store' }
    const key = String(input.key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48)
    const removed = await context.adapter.expireMemory(context.sessionId, key)
    return {
      output: { removed, key, driver: context.adapter.status().driver },
      note: removed ? `forgot "${key}"` : `no stored fact under "${key}"`,
      citations: [{ kind: 'memory', source: `database:${context.adapter.status().driver}`, label: 'Memory write', quote: removed ? `deleted ${key}` : `nothing matched ${key}` }],
    }
  },

  request_navigation: (input, context) => {
    const section = String(input.section)
    const approved = context.approvedActions.has('request_navigation') || context.approvedActions.has('navigate')
    return {
      output: {
        section,
        // The server never scrolls a browser: it records the intent, the client acts.
        executed: false,
        proposed: true,
        approved,
        targetPresent: sections.some((entry) => entry.id === section),
      },
      note: approved ? `navigation to #${section} approved; the client performs the scroll` : `navigation to #${section} requires client approval`,
    }
  },
}

export function createToolRegistry(onRun?: (run: import('../types').ToolRun) => void, limits?: { stepTimeoutMs?: number }): ToolRegistry {
  const registry = new ToolRegistry({
    // `limits.stepTimeoutMs` is `RAVEN_AGENT_STEP_TIMEOUT_MS`, read from the config by the caller.
    // It arrives as a ceiling rather than a default because every tool here already declares its
    // own number: an env var that only applied to tools too lazy to choose one would be a knob that
    // looks configurable and is not.
    defaults: { timeoutMs: limits?.stepTimeoutMs ?? 3000, maxOutputChars: 12_000, ...(limits?.stepTimeoutMs ? { maxTimeoutMs: limits.stepTimeoutMs } : {}) },
    limits: { maxStringChars: 400 },
    ...(onRun ? { onRun } : {}),
  })
  for (const entry of TOOL_SPECS) {
    const handler = handlers[entry.handler]
    if (!handler) throw new Error(`tool "${entry.spec.name}" references a missing handler "${entry.handler}"`)
    registry.register(entry.spec, handler)
  }
  return registry
}

/** Tool names a plan may use without approval, for the planner's guardrails. */
export const READ_ONLY_TOOLS = TOOL_SPECS.filter((entry) => entry.spec.permission !== 'action').map((entry) => entry.spec.name)

export type { ToolContext, ToolHandler } from './registry'
