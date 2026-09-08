/**
 * A small lexical retrieval engine — the family of scoring BM25 belongs to, in
 * about a hundred lines and zero dependencies.
 *
 * Note what is *not* a stopword: `riyan`, `pasha` and `raven` are content words for
 * this corpus — they are the subject of the questions — so they are never dropped.
 *
 * embeddings: it is reproducible, inspectable in a test, and it cannot drift the way
 * a vector cache does when the corpus changes. The trade-off (no paraphrase
 * matching) is accepted on purpose, and the GenAI layer is where semantic phrasing
 * belongs.
 */
import type { KnowledgeDocument } from './corpus'

const STOPWORDS = new Set(
  ('a an the and or but if while of to in on for with without about into over after before is are was were be been being ' +
    'do does did done this that these those it its as at by from then than so such not no nor yes can could should would will ' +
    'may might must have has had him his he she they them their you your ours my me mine our who whom whose which what when ' +
    'where why how all any both each few more most other some only own same too very s t just also please hi hello hey ' +
    'tell show give want need looking interested question answer answers').split(' '),
)

/** Normalized, unstemmed words — used for phrase matching. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Light stem: plural/gerund/past folding, guarded so short words survive intact. */
export function stem(word: string): string {
  let w = word
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  return w
}

export function tokenize(text: string, options: { keepStopwords?: boolean } = {}): string[] {
  return normalize(text)
    .split(' ')
    .filter((word) => word.length > 1 && (options.keepStopwords || !STOPWORDS.has(word)))
    .map(stem)
    .filter(Boolean)
}

type IndexedDocument = {
  doc: KnowledgeDocument
  title: Map<string, number>
  keywords: Map<string, number>
  body: Map<string, number>
  bodyLength: number
  /** Normalized text for exact phrase checks. */
  phrases: string[]
}

export type SearchIndex = {
  documents: IndexedDocument[]
  /** How many documents contain each token. */
  documentFrequency: Map<string, number>
  total: number
}

const bump = (map: Map<string, number>, token: string) => map.set(token, (map.get(token) ?? 0) + 1)

export function buildIndex(documents: KnowledgeDocument[]): SearchIndex {
  const documentFrequency = new Map<string, number>()
  const indexed = documents.map((doc) => {
    const title = new Map<string, number>()
    const keywords = new Map<string, number>()
    const body = new Map<string, number>()
    const seen = new Set<string>()
    for (const token of tokenize(doc.title)) {
      bump(title, token)
      seen.add(token)
    }
    for (const token of tokenize(doc.keywords)) {
      bump(keywords, token)
      seen.add(token)
    }
    const bodyTokens = tokenize(doc.body)
    for (const token of bodyTokens) {
      bump(body, token)
      seen.add(token)
    }
    for (const token of doc.tags.map((tag) => stem(normalize(tag))).filter(Boolean)) seen.add(token)
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    const normalizedBody = normalize(doc.body)
    const normalizedTitle = normalize(doc.title)
    return {
      doc,
      title,
      keywords,
      body,
      bodyLength: bodyTokens.length,
      phrases: [normalizedTitle, normalizedBody, normalize(doc.keywords), ...doc.tags.map(normalize)].filter(Boolean),
    }
  })
  return { documents: indexed, documentFrequency, total: indexed.length }
}

export type SearchOptions = {
  limit?: number
  /** Only documents carrying all of these tags (e.g. `['project']`). */
  requireTags?: string[]
  /** Anything below this score is treated as "the corpus has nothing relevant". */
  minScore?: number
}

export type ScoredDocument = {
  doc: KnowledgeDocument
  score: number
  /** Which query tokens landed where — surfaced in the trace so retrieval is debuggable. */
  matched: string[]
  phraseMatch: boolean
}

/**
 * Score one document against a query.
 *
 * idf rewards rare-term matches, field weights keep titles decisive, coverage keeps
 * a partial accident below a full answer, and log-length normalization stops the
 * long documents from winning on volume alone.
 */
export function scoreDocument(index: SearchIndex, queryTokens: string[], rawQuery: string, candidate: IndexedDocument, options: SearchOptions = {}): ScoredDocument | null {
  if (options.requireTags?.length) {
    for (const tag of options.requireTags) if (!candidate.doc.tags.includes(tag)) return null
  }
  const uniqueQuery = Array.from(new Set(queryTokens))
  if (!uniqueQuery.length) return null
  let score = 0
  const matched: string[] = []
  for (const token of uniqueQuery) {
    const df = index.documentFrequency.get(token) ?? 0
    if (!df) continue
    const idf = Math.log(1 + (index.total - df + 0.5) / (df + 0.5))
    const inTitle = candidate.title.get(token) ?? 0
    const inKeywords = candidate.keywords.get(token) ?? 0
    const inBody = candidate.body.get(token) ?? 0
    if (!inTitle && !inKeywords && !inBody) continue
    matched.push(token)
    const tf = (count: number) => (count ? 1 + Math.log(count) : 0)
    score += idf * (3 * tf(inTitle) + 2 * tf(inKeywords) + 1 * tf(inBody))
    // A token that appears once in the whole corpus is a strong signal — but only in
    // proportion to how much of the question it actually covers, so one stray word
    // cannot answer a long question by accident.
    const coverageSoFar = (matched.length + 1) / uniqueQuery.length
    if (df === 1) score += idf * 1.6 * coverageSoFar
  }
  if (!matched.length) return null
  const normalizedQuery = normalize(rawQuery)
  const phraseMatch = normalizedQuery.split(' ').length >= 2 && candidate.phrases.some((phrase) => phrase.includes(normalizedQuery))
  if (phraseMatch) score += 4
  const coverage = matched.length / uniqueQuery.length
  const lengthNorm = 1 + Math.log(1 + candidate.bodyLength / 60)
  const final = (score * (0.55 + 0.45 * coverage)) / lengthNorm
  return { doc: candidate.doc, score: Number(final.toFixed(4)), matched, phraseMatch }
}

export function searchIndex(index: SearchIndex, query: string, options: SearchOptions = {}): ScoredDocument[] {
  const tokens = tokenize(query)
  const limit = options.limit ?? 5
  const minScore = options.minScore ?? 0.6
  const scored: ScoredDocument[] = []
  for (const candidate of index.documents) {
    const hit = scoreDocument(index, tokens, query, candidate, options)
    if (hit && hit.score >= minScore) scored.push(hit)
  }
  // Deterministic ordering: score first, then id, so ties never depend on input order.
  scored.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
  return scored.slice(0, limit)
}
