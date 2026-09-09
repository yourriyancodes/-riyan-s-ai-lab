/**
 * The knowledge agent: turns tool outputs into a reply, using only what the tools
 * returned.
 *
 * This is the layer that lets RAVEN answer with no API key, no database and no network.
 * It composes sentences from records — it does not search for them and it does not
 * invent them. When the retrieved material cannot support an answer, this returns
 * `null` and the brain says so instead of filling the gap with prose.
 */
import type { Citation, IntentMatch, MemoryUpdate, ToolOutcome } from '../types'
import { type RetrievalResult, pick } from './research'

export type KnowledgeInput = {
  message: string
  intent: IntentMatch
  retrieval: RetrievalResult
  /** Result of the action agent, when this turn wrote something. */
  memory?: { stored: number; updates: MemoryUpdate[]; errors: string[]; driver: string } | null
  navigation?: { section: string; approved: boolean; targetPresent: boolean } | null
}

/**
 * `ungrounded` marks text that explains a *failure to answer*. It is deliberately not
 * `null` — the sentence is worth reading — but the brain must not dress it up as a
 * knowledge answer, because "I found nothing" is not knowledge.
 */
export type KnowledgeAnswer = { answer: string; citations: Citation[]; toolsUsed: string[]; note?: string; ungrounded?: boolean }

const BULLET = '\n- '
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

const listOf = (values: (string | undefined | null)[], joiner = ', '): string => values.filter((value): value is string => Boolean(value && value.trim())).join(joiner)

/** Reads a successful tool output, or returns null so the caller can be honest about it. */
const data = (retrieval: RetrievalResult, tool: string): Record<string, unknown> | null => {
  const outcome: ToolOutcome | undefined = retrieval.outcomes.get(tool)
  if (!outcome || outcome.status !== 'succeeded') return null
  const output = outcome.output
  if (output && typeof output === 'object' && !Array.isArray(output)) return output as Record<string, unknown>
  return { value: output }
}

export function composeKnowledgeAnswer(input: KnowledgeInput): KnowledgeAnswer | null {
  const { intent, retrieval } = input
  const toolsUsed = [...retrieval.outcomes.keys()].filter((key) => !key.includes('#')).map((key) => key.split('#')[0]!)
  const citations = retrieval.citations

  const sentence = (parts: (string | null | undefined)[]): string =>
        parts
          .filter((part) => part && part.trim())
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          // The corpus sentences already end with punctuation; templates add another.
          .replace(/([.!?])\1+/g, '$1')
          .replace(/\s+([.!?])/g, '$1')
          .trim()

  switch (intent.intent) {
    case 'greeting': {
      const projects = data(retrieval, 'list_projects')
      const count = typeof projects?.count === 'number' ? projects.count : null
      return {
        answer: sentence([
          'RAVEN online.',
          count === null
            ? 'This answers come straight from the portfolio data in this repository — ask me about his projects, skills, experiments, or what I can actually do.'
            : `This page documents ${count} project(s), and I read them directly from the repository data. Ask me about the work, the skills, or what I can actually do.`,
        ]),
        citations,
        toolsUsed,
      }
    }

    case 'smalltalk':
      return {
        answer: 'Noted. Ask me something about the portfolio — projects, skills, experiments, or how this backend works.',
        citations: [],
        toolsUsed: [],
      }

    case 'identity.raven': {
      const record = data(retrieval, 'get_raven')
      if (!record) return null
      const capabilities = listOf((pick<string[]>(record, 'capabilities') ?? []).slice(0, 5), '; ')
      const limits = listOf((pick<string[]>(record, 'honestLimits') ?? []).slice(0, 3), '; ')
      return {
        answer: sentence([
          `${String(record.name)} is ${String(record.expansion)} — ${String(record.role)}.`,
          String(record.summary),
          capabilities ? `What I do: ${capabilities}.` : '',
          limits ? `What I will not pretend: ${limits}.` : '',
        ]),
        citations,
        toolsUsed,
      }
    }

    case 'identity.riyan': {
      const record = data(retrieval, 'get_profile')
      if (!record) return null
      const projects = data(retrieval, 'list_projects')
      const names = projects ? (pick<{ name: string }[]>(projects, 'projects') ?? []).map((project) => project.name).slice(0, 5) : []
      const roles = pick<string[]>(record, 'roles') ?? []
      const focus = pick<string[]>(record, 'focusAreas') ?? []
      return {
        answer: sentence([
          `${String(record.name)} — ${listOf(roles)}.`,
          String(record.intro),
          clip(String(record.about), 420),
          focus.length ? `Focus: ${listOf(focus.slice(0, 6))}.` : '',
          names.length ? `On the page: ${names.join(', ')}.` : '',
        ]),
        citations,
        toolsUsed,
      }
    }

    case 'capability.probe': {
      const status = data(retrieval, 'system_status')
      if (!status) return null
      const provider = pick<{ configured: boolean; label: string; model: string | null; failing?: boolean }>(status, 'provider')
      const database = pick<{ driver: string | null; reachable: boolean; detail: string }>(status, 'database')
      const knowledge = pick<{ documents: number; projects: number; skillNodes: number; glossaryEntries: number }>(status, 'knowledge')
      const lines = [
        provider?.configured
          ? `Provider: ${provider.label}${provider.model ? ` (${provider.model})` : ''} — configured${provider.failing ? ', but its recent calls have been refused, so this answer and the next few are local' : ' and used where it adds something'}.`
          : 'Provider: none configured — offline/local reasoning is active, and every answer here comes from the deterministic local engines.',
        `Database: ${database?.driver ?? 'unresolved'} — ${database?.reachable ? 'reachable' : 'not reachable'}${database?.detail ? ` (${clip(database.detail, 140)})` : ''}.`,
        knowledge
          ? `Knowledge corpus: ${knowledge.documents} documents, ${knowledge.projects} projects, ${knowledge.skillNodes} skill nodes, ${knowledge.glossaryEntries} glossary entries.`
          : '',
        `Tools registered: ${listOf((pick<string[]>(status, 'tools') ?? []).slice(0, 8))}${(pick<string[]>(status, 'tools') ?? []).length > 8 ? ', …' : ''}.`,
      ]
      return { answer: `Runtime state, measured now:${BULLET}${lines.filter(Boolean).join(BULLET)}`, citations, toolsUsed }
    }

    case 'portfolio.projects': {
      const record = data(retrieval, 'list_projects')
      if (!record) return null
      const entries = pick<{ number: string; name: string; status: string; technology: string; description: string }[]>(record, 'projects') ?? []
      if (!entries.length) return null
      const bullets = entries.map((project) => `${project.number} ${project.name} — ${clip(project.description, 150)} (${project.technology}, ${project.status})`)
      return { answer: `${entries.length} project(s) on this portfolio:${BULLET}${bullets.join(BULLET)}`, citations, toolsUsed }
    }

    case 'portfolio.project': {
      const record = data(retrieval, 'get_project')
      if (!record) return null
      if (record.found !== true) {
        const available = listOf(pick<string[]>(record, 'available') ?? [])
        return { answer: `The portfolio has no project matching "${String(record.ref)}".${available ? ` It documents: ${available}.` : ''}`, citations, toolsUsed }
      }
      const stack = listOf(pick<string[]>(record, 'stack') ?? [])
      const highlights = (pick<string[]>(record, 'highlights') ?? []).slice(0, 3)
      return {
        answer: sentence([
          `${String(record.name)} (${String(record.number)}) — ${String(record.technology)}, status ${String(record.status)}.`,
          String(record.overview ?? record.description),
          record.architecture ? `Architecture: ${clip(String(record.architecture), 320)}` : '',
          stack ? `Stack: ${stack}.` : '',
          highlights.length ? `Highlights:${BULLET}${highlights.map((line) => clip(line, 170)).join(BULLET)}` : '',
        ]),
        citations,
        toolsUsed,
      }
    }

    case 'portfolio.skills': {
      const record = data(retrieval, 'get_skills')
      if (!record) return null
      const nodes = pick<{ name: string; category: string; description: string }[]>(record, 'skillNodes') ?? []
      const focus = pick<string[]>(record, 'focusAreas') ?? []
      const bullets = nodes.slice(0, 6).map((node) => `${node.name} (${node.category}) — ${clip(node.description, 120)}`)
      return {
        answer: sentence([
          focus.length ? `Focus areas declared on the skills section: ${focus.join(', ')}.` : '',
          nodes.length ? `The skill graph carries ${nodes.length} nodes:${BULLET}${bullets.join(BULLET)}` : '',
        ]),
        citations,
        toolsUsed,
      }
    }

    case 'portfolio.contact': {
      const record = data(retrieval, 'get_contact')
      if (!record) return null
      const links = pick<{ label: string; url: string }[]>(record, 'links') ?? []
      if (!links.length) {
        return {
          answer: 'No contact link or email is published in the portfolio data yet (socialLinks is empty in data/siteConfig.ts). The page has a contact section to fill in; once a link exists there I will report it instead of guessing one.',
          citations,
          toolsUsed,
          note: 'refused to invent a contact channel',
        }
      }
      return { answer: `Published links:${BULLET}${links.map((link) => `${link.label}: ${link.url}`).join(BULLET)}`, citations, toolsUsed }
    }

    case 'portfolio.experiments': {
      const record = data(retrieval, 'get_experiments')
      if (!record) return null
      const entries = pick<{ name: string; status: string }[]>(record, 'experiments') ?? []
      if (!entries.length) return null
      return { answer: `Experiments listed on the page:${BULLET}${entries.map((entry) => `${entry.name} — ${entry.status}`).join(BULLET)}`, citations, toolsUsed }
    }

    case 'portfolio.sections': {
      const record = data(retrieval, 'get_sections')
      if (!record) return null
      const entries = pick<{ id: string; title: string; description?: string }[]>(record, 'sections') ?? []
      if (!entries.length) return null
      return {
        answer: `Sections on this page:${BULLET}${entries.map((section) => `#${section.id} — ${section.title}${section.description ? ` (${clip(section.description, 110)})` : ''}`).join(BULLET)}`,
        citations,
        toolsUsed,
      }
    }

    case 'memory.recall': {
      const record = data(retrieval, 'recall_memories')
      if (!record) return null
      const memories = pick<{ key: string; value: string; importance: number; source: string }[]>(record, 'memories') ?? []
      if (!memories.length) {
        return {
          answer: `I have nothing stored for this session yet (${String(record.source ?? 'no store')}). Say "remember that my favourite language is TypeScript" and it will persist across reloads.`,
          citations,
          toolsUsed,
        }
      }
      const bullets = memories.slice(0, 10).map((memory) => `${memory.key} — ${clip(memory.value, 140)} (importance ${memory.importance.toFixed(2)}, ${memory.source})`)
      return {
        answer: `${memories.length} durable fact(s) for this session, from the ${String(record.source)} store:${BULLET}${bullets.join(BULLET)}`,
        citations,
        toolsUsed,
      }
    }

    case 'memory.remember': {
      const memory = input.memory
      if (!memory) return null
      if (memory.errors.length && !memory.stored) {
        return { answer: `I could not write that down: ${clip(memory.errors[0]!, 200)}. Nothing was stored, so I will not claim it was.`, citations, toolsUsed }
      }
      const keys = memory.updates.map((update) => `${update.op === 'expire' ? 'forgot ' : ''}${update.key}`)
      return {
        answer: sentence([
          memory.stored ? `Stored ${memory.stored} item(s) in ${memory.driver} persistence: ${keys.join(', ')}.` : 'Nothing new needed storing from that message.',
          memory.updates.length ? `Policy: ${clip(memory.updates.map((update) => update.reason).join('; '), 160)}.` : '',
        ]),
        citations,
        toolsUsed,
      }
    }

    case 'action.navigate': {
      const navigation = input.navigation
      if (!navigation) return null
      const sections = pick<{ id: string; title: string }[]>(data(retrieval, 'get_sections') ?? {}, 'sections') ?? []
      const title = sections.find((section) => section.id === navigation.section)?.title ?? navigation.section
      if (!navigation.targetPresent) {
        return { answer: `There is no #${navigation.section} section on this page, so I did not scroll anywhere. Available: ${sections.map((section) => `#${section.id}`).join(', ') || 'none listed'}.`, citations, toolsUsed }
      }
      return {
        answer: navigation.approved
          ? `Scrolling to ${title} (#${navigation.section}) — the client performed it, I only proposed it.`
          : `I can move the page to ${title} (#${navigation.section}), but that needs your approval first: send context.approvedActions with "request_navigation".`,
        citations,
        toolsUsed,
      }
    }

    case 'explain.concept': {
      const concept = data(retrieval, 'lookup_concept')
      const search = data(retrieval, 'search_knowledge')
      const hits = pick<{ title: string; body: string }[]>(search ?? {}, 'hits') ?? []
      if (concept && concept.found === true) {
        return {
          answer: sentence([
            `${String(concept.term)}: ${clip(String(concept.definition), 420)}`,
            concept.relevance ? `Why it matters here: ${clip(String(concept.relevance), 220)}` : '',
            hits.length ? `In this portfolio: ${clip(hits[0]!.body.replace(/\n+/g, ' '), 220)}` : '',
          ]),
          citations,
          toolsUsed,
        }
      }
      if (hits.length) {
        // "The portfolio data does mention it" is a claim about the corpus, so it is only
        // allowed when the corpus contains the word. Lexical search happily returns the site
        // description for a question about quantum annealers — one shared particle is a match
        // to a scorer and a fabrication to a reader. Without this gate the agent shipped an
        // off-topic listing as a verified answer, which is the exact failure the whole
        // grounding layer exists to prevent.
        const asked = String(concept?.term ?? '').trim().toLowerCase()
        const mentioning = asked
          ? hits.filter((hit) => `${hit.title} ${hit.body}`.toLowerCase().includes(asked))
          : []
        if (!mentioning.length) {
          return {
            answer: `The glossary has no entry for "${asked || 'that term'}", and none of the ${hits.length} record(s) the search returned actually mention it.`,
            citations: [],
            toolsUsed,
            ungrounded: true,
            note: 'glossary missed and no corpus record contains the term; refused instead of listing near-misses',
          }
        }
        const bullets = mentioning.slice(0, 2).map((hit) => `${hit.title}: ${clip(hit.body.replace(/\n+/g, ' '), 260)}`)
        return {
          answer: `The glossary has no entry for that term, but the portfolio data does mention it:${BULLET}${bullets.join(BULLET)}`,
          citations,
          toolsUsed,
          note: `answered from ${mentioning.length} corpus record(s) that contain the term`,
        }
      }
      return null
    }

    case 'compare.evaluate':
    case 'plan.multistep':
    case 'unknown':
    default: {
      // These reach the composer only when the agentic path is unavailable; a corpus
      // answer is still better than a model guessing, and worse than nothing at all.
      if (intent.entities?.unanswerableByCorpus)
        // "Something outside the portfolio" and "an architecture for my next project" both point past
        // these records: the first at what is absent, the second at work that does not exist yet. A hit
        // that merely shares the word "portfolio" answers neither, so this returns null and the caller
        // refuses — no invented record, no listing dressed up as a reply. With a provider configured
        // the turn does not land here at all: the same `unknown` intent routes to `genai`, which
        // answers it and is labelled as synthesis.
        return null
      const search = data(retrieval, 'search_knowledge')
      const hits = (pick<{ title: string; body: string; score: number; phraseMatch?: boolean }[]>(search ?? {}, 'hits') ?? []).filter(
        // A generic question needs a real match: one shared word is not an answer,
        // however tidy the score looks after length normalization.
        (hit) => hit.phraseMatch === true || (hit.score >= 1.8 && (pick<string[]>(hit as never, 'matched') ?? []).length >= 2),
      )
      if (!hits.length) return null
      const bullets = hits.slice(0, 3).map((hit) => `${hit.title} — ${clip(hit.body.replace(/\n+/g, ' '), 240)}`)
      return {
        answer: `Closest matches in the portfolio data:${BULLET}${bullets.join(BULLET)}`,
        citations,
        toolsUsed,
      }
    }
  }
}
