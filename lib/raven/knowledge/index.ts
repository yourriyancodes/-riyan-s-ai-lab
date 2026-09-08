/**
 * Public surface of the knowledge layer. Agents and tools import this module and
 * nothing below it, so retrieval stays behind one seam.
 */
import { knowledgeDocuments, type KnowledgeDocument } from './corpus'
import { buildIndex, searchIndex, type SearchIndex, type SearchOptions } from './search'
import type { Citation } from '../types'

export type { KnowledgeDocument }
export * from './corpus'

/** A retrieval hit: the document, why it matched, and what to cite for it. */
export type RetrievedDocument = {
  id: string
  title: string
  body: string
  score: number
  tags: string[]
  citation: Citation
  matched: string[]
  phraseMatch: boolean
}

let cached: SearchIndex | null = null

export function knowledgeIndex(): SearchIndex {
  if (!cached) cached = buildIndex(knowledgeDocuments)
  return cached
}

/** Test seam: rebuild lazily if the corpus is ever swapped at runtime. */
export function resetKnowledgeIndex(): void {
  cached = null
}

export function searchKnowledge(query: string, options: SearchOptions = {}): RetrievedDocument[] {
  return searchIndex(knowledgeIndex(), query, options).map((hit) => ({
    id: hit.doc.id,
    title: hit.doc.title,
    body: hit.doc.body,
    score: hit.score,
    tags: hit.doc.tags,
    citation: {
      // Glossary text is curated in this repo, not a portfolio claim; the kind is
      // carried through so an answer can distinguish the two.
      kind: hit.doc.id.startsWith('glossary.') ? 'knowledge' : 'siteConfig',
      source: hit.doc.citation.source,
      label: hit.doc.citation.label,
      locator: hit.doc.citation.locator,
      quote: hit.doc.body.length > 320 ? `${hit.doc.body.slice(0, 317)}...` : hit.doc.body,
    },
    matched: hit.matched,
    phraseMatch: hit.phraseMatch,
  }))
}

/** Documents carrying a tag, in corpus order — used by the projects/skills tools. */
export function documentsByTag(tag: string, limit = 20): KnowledgeDocument[] {
  return knowledgeDocuments.filter((doc) => doc.tags.includes(tag)).slice(0, limit)
}

export function getDocument(id: string): KnowledgeDocument | undefined {
  return knowledgeDocuments.find((doc) => doc.id === id)
}
