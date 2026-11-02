import { siteConfig } from '../../data/siteConfig'
import type { RavenSource } from './types'

/**
 * Local knowledge retrieval.
 *
 * RAVEN answers are grounded in `data/siteConfig.ts`: the model only ever sees
 * these documents, so the assistant cannot invent projects, metrics or claims.
 * The same retrieval is used to label the tool that ran, keeping the
 * "local knowledge engine" behaviour that already existed in the UI.
 */

export type KnowledgeDocument = {
  id: string
  label: string
  /** Words used for matching only; never shown to the user. */
  keywords: string[]
  text: string
}

export type KnowledgeMatch = {
  document: KnowledgeDocument
  score: number
}

export type KnowledgeResult = {
  matches: KnowledgeMatch[]
  sources: RavenSource[]
  context: string
  toolUsed: string
}

const MAX_CONTEXT_CHARS = 3500

export function buildKnowledgeBase(): KnowledgeDocument[] {
  const projectLines = siteConfig.projects
    .map((p) => `${p.number}. ${p.name} — ${p.technology} — status ${p.status}: ${p.description}`)
    .join('\n')

  return [
    {
      id: 'identity',
      label: 'Identity & focus',
      keywords: [
        'who', 'riyan', 'pasha', 'about', 'background', 'identity', 'bio', 'yourself',
        'technologist', 'developer', 'builder', 'problem', 'solver', 'focus', 'intro',
      ],
      text: [
        `Name: ${siteConfig.name}`,
        `Roles: ${siteConfig.roles.join(', ')}`,
        `Intro: ${siteConfig.intro}`,
        `About: ${siteConfig.about}`,
        'Focus areas: AI, Agentic AI, Machine Learning, Deep Learning, Data Science, RAG, LLMs, Android, Software Engineering, Data, Automation, Intelligent Systems.',
      ].join('\n'),
    },
    {
      id: 'projects',
      label: 'Selected work',
      keywords: [
        'project', 'projects', 'work', 'built', 'build', 'portfolio', 'app', 'apps',
        'system', 'systems', 'case', 'study', 'akshara', 'sign', 'language', 'rag',
        'assistant', 'agentic', 'data', 'experiment',
      ],
      text: `Selected work:\n${projectLines}`,
    },
    {
      id: 'skills',
      label: 'Capabilities & stack',
      keywords: [
        'skill', 'skills', 'tech', 'technology', 'stack', 'language', 'languages',
        'tool', 'tools', 'capability', 'capabilities', 'ai', 'ml', 'llm', 'llms',
        'rag', 'android', 'kotlin', 'python', 'react', 'cloud', 'automation',
      ],
      text: [
        'Capabilities: AI and Machine Learning (agentic systems, RAG, LLMs, deep learning, data science).',
        'Engineering: Android development, software architecture, system automation, data engineering.',
        'Experiments: context windows, voice interfaces, small models, human feedback loops.',
      ].join('\n'),
    },
    {
      id: 'contact',
      label: 'Contact',
      keywords: ['contact', 'email', 'reach', 'hire', 'connect', 'github', 'linkedin', 'social', 'whatsapp'],
      text: (() => {
        const entries = Object.entries(siteConfig.socialLinks).filter(([, url]) => Boolean(url))
        if (entries.length === 0) {
          return 'Contact: the social links on the portfolio are currently left empty on purpose. RAVEN must not invent an email address, phone number or profile URL.'
        }
        return `Contact channels:\n${entries.map(([name, url]) => `${name}: ${url}`).join('\n')}`
      })(),
    },
    {
      id: 'raven',
      label: 'RAVEN architecture',
      keywords: ['raven', 'you', 'your', 'assistant', 'architecture', 'how', 'work', 'works', 'memory', 'model', 'gemini'],
      text: [
        'RAVEN is Riyan Pasha\'s Autonomous Virtual Engineering Nexus, the AI companion embedded in this portfolio.',
        'Runtime stages: understanding, grounding in local knowledge, planning, execution, verification, then speech.',
        'Grounding source: data/siteConfig.ts. Tool access is read-only; nothing is written or executed without approval.',
        `Configured infrastructure: ${siteConfig.systemStatus.map(([k, v]) => `${k}=${v}`).join(', ')}.`,
      ].join('\n'),
    },
    {
      id: 'journey',
      label: 'Approach',
      keywords: ['approach', 'journey', 'process', 'philosophy', 'method', 'how do you'],
      text: `Approach: ${siteConfig.journey.join(' → ')}. Layers: ${siteConfig.layers
        .map(([layer, description]) => `${layer} (${description})`)
        .join('; ')}`,
    },
  ]
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
}

function scoreDocument(doc: KnowledgeDocument, queryTokens: string[]): number {
  let score = 0
  for (const token of queryTokens) {
    if (doc.keywords.includes(token)) score += 3
    if (doc.text.toLowerCase().includes(token)) score += 1
  }
  return score
}

/**
 * Deterministic keyword retrieval. No network, no embeddings, no randomness —
 * the same question always produces the same grounding context.
 */
export function retrieveKnowledge(query: string, limit = 3): KnowledgeResult {
  const knowledgeBase = buildKnowledgeBase()
  const queryTokens = tokenize(query)

  const ranked = knowledgeBase
    .map((document) => ({ document, score: scoreDocument(document, queryTokens) }))
    .sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id))

  const hits = ranked.filter((entry) => entry.score > 0).slice(0, limit)
  const matches = hits.length > 0 ? hits : ranked.slice(0, 2)

  const matchesWithTool = matches.map((entry) => entry)
  const context = matchesWithTool
    .map(({ document }) => `[${document.id}] ${document.label}\n${document.text}`)
    .join('\n\n')
    .slice(0, MAX_CONTEXT_CHARS)

  return {
    matches: matchesWithTool,
    sources: matchesWithTool.map(({ document }) => ({ id: document.id, label: document.label })),
    context,
    toolUsed: `KnowledgeTool: ${matchesWithTool.map(({ document }) => document.id).join(', ')}`,
  }
}
