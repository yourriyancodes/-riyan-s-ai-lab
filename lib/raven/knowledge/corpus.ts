/**
 * The deterministic knowledge layer: what RAVEN is allowed to state as fact about
 * this portfolio, built from the repository data at module load.
 *
 * Two halves:
 *  - typed accessors (`listProjects`, `findProject`, …) used by the tool registry and
 *    the knowledge agent, so answers are assembled from records rather than from
 *    prose that was typed into a prompt;
 *  - a searchable document set for open-ended "find X in my portfolio" requests.
 *
 * No model, no randomness, no network: the same query produces the same hits
 * forever, which is what makes the knowledge layer a floor instead of a garnish.
 */
import { siteConfig } from '@/data/siteConfig'
import { focusAreas, glossary, projectDetails, ravenSelf, siteSections, skillNodes, type ProjectDetailEntry } from '@/data/ravenKnowledge'

export type KnowledgeDocument = {
  id: string
  title: string
  /** Space-separated searchable anchors: names, tags, technologies. */
  keywords: string
  body: string
  tags: string[]
  citation: { source: string; label: string; locator?: string }
}

export type ProjectRecord = {
  number: string
  name: string
  slug: string
  description: string
  technology: string
  status: string
  detail: ProjectDetailEntry | null
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const unique = <T,>(items: readonly T[]): T[] => Array.from(new Set(items))

/* ------------------------------------------------------------------ *
 * Typed records
 * ------------------------------------------------------------------ */

export const projects: ProjectRecord[] = siteConfig.projects.map((project) => ({
  number: project.number,
  name: project.name,
  slug: slugify(project.name),
  description: project.description,
  technology: project.technology,
  status: project.status,
  detail: projectDetails[project.name] ?? null,
}))

export type ProfileRecord = {
  name: string
  roles: string[]
  intro: string
  about: string
  journey: string[]
  focusAreas: string[]
}

export const profile: ProfileRecord = {
  name: siteConfig.name,
  roles: [...siteConfig.roles],
  intro: siteConfig.intro,
  about: siteConfig.about,
  journey: [...siteConfig.journey],
  focusAreas: [...focusAreas],
}

export type ContactRecord = {
  /** Only links that actually resolve to something. Empty by design, never invented. */
  links: { label: string; url: string }[]
  published: boolean
}

export const contact: ContactRecord = (() => {
  const links = Object.entries(siteConfig.socialLinks)
    .map(([label, url]) => ({ label, url: String(url ?? '').trim() }))
    .filter((entry) => /^https?:\/\//i.test(entry.url) || /^mailto:/i.test(entry.url))
  return { links, published: links.length > 0 }
})()

export const raven = {
  ...ravenSelf,
  /** The layers the site itself documents; quoted, not embellished. */
  layers: siteConfig.layers.map(([name, note]) => ({ name, note })),
} as const

export const experiments = siteConfig.experiments.map(([name, status]) => ({ name, status }))
export const sections = siteSections.map((section) => ({ ...section }))
export const systemStatus = siteConfig.systemStatus.map(([name, status]) => ({ name, status }))

export function findProject(reference: string): ProjectRecord | null {
  const needle = slugify(reference)
  if (!needle) return null
  const exact = projects.find((project) => project.slug === needle)
  if (exact) return exact
  const partial = projects.find((project) => project.slug.includes(needle) || needle.includes(project.slug))
  if (partial) return partial
  // Numbered reference, e.g. "03" or "project 3".
  const byNumber = projects.find((project) => project.number === needle.replace(/^0+/, '').padStart(2, '0') || project.number === needle)
  return byNumber ?? null
}

export function lookupGlossary(term: string) {
  const needle = term.toLowerCase().trim()
  if (!needle) return null
  const scored = glossary
    .map((entry) => {
      const candidates = [entry.term, ...entry.aliases].map((value) => value.toLowerCase())
      const exact = candidates.some((value) => value === needle)
      const contains = candidates.some((value) => value.includes(needle) || needle.includes(value))
      const words = needle.split(/\s+/).filter(Boolean)
      const wordOverlap = words.filter((word) => candidates.some((value) => value.includes(word))).length
      return { entry, score: exact ? 3 : contains ? 2 : wordOverlap >= 2 ? 1 : 0 }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return scored[0]?.entry ?? null
}

export function listGlossary() {
  return glossary.map((entry) => ({ id: entry.id, term: entry.term, tags: entry.tags }))
}

/* ------------------------------------------------------------------ *
 * Document set for retrieval
 * ------------------------------------------------------------------ */

function projectDocument(project: ProjectRecord): KnowledgeDocument {
  const detail = project.detail
  const body = [
    `${project.name} (${project.number}) — ${project.technology}, status ${project.status}.`,
    project.description,
    detail ? `Overview: ${detail.overview}` : '',
    detail ? `Architecture: ${detail.architecture}` : '',
    detail ? `Stack: ${detail.stack.join(', ')}` : '',
    detail ? `Highlights: ${detail.highlights.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return {
    id: `site.project.${project.slug}`,
    title: project.name,
    keywords: [project.name, project.technology, project.status, ...(detail?.stack ?? []), ...(detail ? [detail.architecture] : [])].join(' '),
    body,
    tags: ['project', project.status.toLowerCase(), ...unique((detail?.stack ?? []).map(slugify))],
    citation: { source: 'siteConfig.projects', label: `Portfolio project ${project.number}`, locator: `data/siteConfig.ts → projects[${projects.indexOf(project)}]` },
  }
}

function buildDocuments(): KnowledgeDocument[] {
  const documents: KnowledgeDocument[] = []

  documents.push({
    id: 'site.profile',
    title: `${profile.name} — ${profile.roles.join(', ')}`,
    keywords: [profile.name, ...profile.roles, ...profile.focusAreas, 'background', 'identity', 'who'].join(' '),
    body: [
      `${profile.name} is described in this portfolio as ${profile.roles.join(', ').toLowerCase()}.`,
      `Intro: ${profile.intro}`,
      `About: ${profile.about}`,
      `Focus areas: ${profile.focusAreas.join(', ')}.`,
      `Working loop: ${profile.journey.join(' → ')}.`,
    ].join('\n'),
    tags: ['profile', 'identity', 'about'],
    citation: { source: 'siteConfig', label: 'Portfolio identity data', locator: 'data/siteConfig.ts' },
  })

  documents.push({
    id: 'site.skills',
    title: 'Focus areas and capability matrix',
    keywords: [...focusAreas, ...skillNodes.map((node) => node.name), 'skills', 'technologies', 'stack'].join(' '),
    body: [
      `Focus constellation: ${focusAreas.join(', ')}.`,
      ...skillNodes.map((node) => `${node.name} [${node.category}] — ${node.description}`),
    ].join('\n'),
    tags: ['skills', 'stack', 'capabilities'],
    citation: { source: 'siteConfig + data/ravenKnowledge.ts', label: 'Skills / node matrix', locator: 'components/NeuralGraph.tsx (mirrored)' },
  })

  for (const node of skillNodes) {
    documents.push({
      id: `site.skill.${node.id}`,
      title: node.name,
      keywords: [node.name, node.category, node.description].join(' '),
      body: `${node.name} — ${node.description} (category: ${node.category})`,
      tags: ['skill', slugify(node.category)],
      citation: { source: 'data/ravenKnowledge.ts → skillNodes', label: 'Capability node', locator: node.id },
    })
  }

  documents.push({
    id: 'site.experiments',
    title: 'Active experiments and their status',
    keywords: [experiments.map((entry) => `${entry.name} ${entry.status}`).join(' '), 'experiment', 'research', 'prototype'].join(' '),
    body: experiments.map((entry) => `${entry.name}: ${entry.status}`).join('\n'),
    tags: ['experiments', 'status'],
    citation: { source: 'siteConfig.experiments', label: 'Experiment list', locator: 'data/siteConfig.ts → experiments' },
  })

  documents.push({
    id: 'site.journey',
    title: 'Working method',
    keywords: [...profile.journey, 'process', 'workflow', 'method'].join(' '),
    body: `The portfolio describes the loop as: ${profile.journey.join(' → ')}.`,
    tags: ['process'],
    citation: { source: 'siteConfig.journey', label: 'Journey', locator: 'data/siteConfig.ts → journey' },
  })

  documents.push({
    id: 'site.contact',
    title: 'Contact and social links',
    keywords: ['contact', 'email', 'github', 'linkedin', 'whatsapp', 'instagram', 'hire', 'reach'].join(' '),
    body: contact.published
      ? contact.links.map((link) => `${link.label}: ${link.url}`).join('\n')
      : 'No contact URLs are configured yet. data/siteConfig.ts → socialLinks holds empty strings for WhatsApp, Email, Instagram, GitHub and LinkedIn, and the site deliberately renders them disabled rather than as fake links.',
    tags: ['contact', 'links'],
    citation: { source: 'siteConfig.socialLinks', label: 'Contact links', locator: 'data/siteConfig.ts → socialLinks' },
  })

  documents.push({
    id: 'site.sections',
    title: 'Portfolio sections',
    keywords: [sections.map((section) => `${section.title} ${section.id} ${section.note}`).join(' '), 'page', 'sections', 'navigation'].join(' '),
    body: sections.map((section) => `${section.title} (#${section.id}) — ${section.note}`).join('\n'),
    tags: ['structure', 'page'],
    citation: { source: 'data/ravenKnowledge.ts → siteSections', label: 'Page sections' },
  })

  documents.push({
    id: 'raven.self',
    title: `${raven.name} — ${raven.expansion}`,
    keywords: ['raven', 'assistant', 'companion', 'what are you', 'who are you', 'identity', nexusKeywords()].join(' '),
    body: [
      `RAVEN is ${raven.expansion}. ${raven.role}`,
      raven.summary,
      `Capabilities: ${raven.capabilities.join(' ')}`,
      `Limits: ${raven.honestLimits.join(' ')}`,
    ].join('\n'),
    tags: ['raven', 'identity'],
    citation: { source: 'data/ravenKnowledge.ts → ravenSelf', label: 'RAVEN self-description' },
  })

  documents.push({
    id: 'raven.architecture',
    title: 'RAVEN runtime architecture',
    keywords: ['architecture', 'runtime', 'layers', 'brain', 'memory', 'tools', 'verification', 'orchestration'].join(' '),
    body: raven.layers.map((layer) => `${layer.name} — ${layer.note}`).join('\n'),
    tags: ['raven', 'architecture'],
    citation: { source: 'siteConfig.layers', label: 'Architecture layers', locator: 'data/siteConfig.ts → layers' },
  })

  for (const project of projects) documents.push(projectDocument(project))
  for (const entry of glossary) {
    documents.push({
      id: `glossary.${entry.id}`,
      title: entry.term,
      keywords: [entry.term, ...entry.aliases, ...entry.tags].join(' '),
      body: [entry.definition, entry.relevance ? `In this portfolio: ${entry.relevance}` : ''].filter(Boolean).join('\n'),
      tags: ['concept', ...entry.tags],
      citation: { source: 'data/ravenKnowledge.ts → glossary', label: `Curated definition: ${entry.term}`, locator: entry.id },
    })
  }

  return documents
}

function nexusKeywords() {
  return ['nexus', 'autonomous', 'virtual', 'engineering', 'digital human', '3d']
}

export const knowledgeDocuments: KnowledgeDocument[] = buildDocuments()

export function documentById(id: string): KnowledgeDocument | undefined {
  return knowledgeDocuments.find((doc) => doc.id === id)
}

export function corpusStats() {
  const tokens = knowledgeDocuments.reduce((total, doc) => total + doc.body.split(/\s+/).length, 0)
  return {
    documents: knowledgeDocuments.length,
    projects: projects.length,
    skillNodes: skillNodes.length,
    glossaryEntries: glossary.length,
    sections: sections.length,
    corpusTokens: tokens,
  }
}
