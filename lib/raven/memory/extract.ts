/**
 * Long-term memory policy: what is worth keeping forever.
 *
 * Storing every message is not memory, it is a log — it drowns the recall query in
 * greetings and it keeps personal text the user never meant to persist. So a candidate
 * has to pass a rule, carry an importance above the floor, and be short enough to be a
 * fact rather than a paragraph. Explicit "remember that…" beats an inferred preference,
 * which beats a passing self-description.
 */
import type { MemoryUpdate } from '../types'
import { normalize } from '../knowledge/search'

const IMPORTANCE_FLOOR = 0.45
const MAX_VALUE_CHARS = 220
const MAX_UPDATES_PER_TURN = 3

const slugKey = (raw: string, fallback: string): string => {
  const slug = normalize(raw)
    .split(' ')
    .filter((word) => word.length > 1)
    .slice(0, 4)
    .join('_')
    .slice(0, 48)
  return slug || fallback
}

const cleanValue = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/[.;,!?\s]+$/g, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .slice(0, MAX_VALUE_CHARS)

const QUESTION = /\?/
const NOISE = /^(hi|hello|hey|ok|okay|thanks|thank you|nice|cool|great|bye|yo|sup|what.?s up|no|yes|maybe|hmm+)[\s!.,]*$/i

type Pattern = {
  name: string
  regex: RegExp
  importance: number
  build: (match: RegExpMatchArray) => { key: string; value: string } | null
}

const PATTERNS: Pattern[] = [
  {
    name: 'explicit-remember',
    regex: /^(?:please\s+)?(?:also\s+)?remember\s+(?:that\s+|this\s*:?\s+)?(.{4,300})$/i,
    importance: 0.9,
    build: ([, raw]) => {
      const value = cleanValue(raw!)
      if (!value) return null
      const owned = value.match(/^my\s+([a-z][a-z -]{1,28}?)\s+(?:is|are|was|were)\s+(.+)$/i)
      if (!owned) return { key: `note.${slugKey(value.split(' ').slice(0, 4).join(' '), 'fact')}`, value }
      const attribute = owned[1]!
      // "my favourite X is Y" is a preference whether or not the user said "remember";
      // keying it the same way is what lets a later recall find it.
      const isPreference = /favorite|favourite|preferred|least/i.test(attribute)
      return {
        key: `${isPreference ? 'preference' : 'note'}.${slugKey(attribute, 'fact')}`,
        value: cleanValue(owned[2]!),
      }
    },
  },
  {
    name: 'explicit-forget',
    regex: /^(?:please\s+)?(?:forget|delete|remove|clear)\s+(?:my|about|the|that\s+)?([a-z][a-z -]{1,40})/i,
    importance: 0.9,
    build: ([, topic]) => (topic ? { key: slugKey(topic, ''), value: '' } : null),
  },
  {
    name: 'preference',
    regex: /\bmy\s+(favorite|favourite|preferred|preferred\s+|least\s+favorite|least\s+favourite)\s+([a-z][a-z +#.-]{1,30}?)\s+(?:is|are|was|would\s+be)\s+(.{2,160})/i,
    importance: 0.8,
    build: ([, kind, topic, value]) => {
      const label = String(kind ?? 'favorite').replace(/\s+/g, '_')
      return { key: `preference.${label}_${slugKey(String(topic), 'thing')}`, value: cleanValue(String(value)) }
    },
  },
  {
    name: 'profile-name',
    regex: /\b(?:my name is|call me|i am called)\s+([a-z][a-z .'-]{1,40})/i,
    importance: 0.85,
    build: ([, name]) => ({ key: 'profile.name', value: cleanValue(String(name)) }),
  },
  {
    name: 'profile-role',
    regex: /\bi am\s+(?:an?\s+)?([a-z][a-z /-]{2,40}?)\s+(?:at|from|in|doing|studying|working)\s+(.{2,80})/i,
    importance: 0.7,
    build: ([, role, place]) => ({ key: 'profile.role', value: `${cleanValue(String(role))} @ ${cleanValue(String(place))}` }),
  },
  {
    name: 'toolchain',
    regex: /\bi\s+(?:mostly\s+|usually\s+|generally\s+)?(?:use|work\s+with|build\s+with|code\s+in|am\s+learning)\s+([a-z0-9+#.][a-z0-9 +#.,/-]{1,60})/i,
    importance: 0.65,
    build: ([, tools]) => {
      const value = cleanValue(String(tools))
      if (!value || value.length < 2) return null
      return { key: `stack.${slugKey(value.split(',')[0]!.split(' ').slice(0, 2).join(' '), 'tools')}`, value }
    },
  },
  {
    name: 'goal',
    regex: /\bi\s+(?:want|am\s+trying|need)\s+to\s+([a-z][a-z 0-9-]{4,90})/i,
    importance: 0.6,
    build: ([, goal]) => ({ key: 'goal.current', value: cleanValue(String(goal)) }),
  },
]

export type ExtractInput = {
  message: string
  /** From the classifier; used to skip turns that are obviously not memory-bearing. */
  intent?: string
}

export type ExtractionResult = {
  updates: MemoryUpdate[]
  /** Every candidate and its fate, so the policy can be inspected in a trace. */
  rejected: { reason: string }[]
}

export function extractMemoryUpdates({ message, intent }: ExtractInput): ExtractionResult {
  const text = message.replace(/\s+/g, ' ').trim()
  const rejected: { reason: string }[] = []
  const updates: MemoryUpdate[] = []

  if (!text) return { updates, rejected: [{ reason: 'empty message' }] }
  if (QUESTION.test(text)) rejected.push({ reason: 'questions are not facts' })
  if (NOISE.test(text)) rejected.push({ reason: 'small talk is not stored' })
  if (intent === 'greeting' || intent === 'smalltalk') rejected.push({ reason: `social turn (${intent})` })
  if (text.length < 12) rejected.push({ reason: 'too short to be a durable fact' })
  if (rejected.length && !/^\s*(?:please\s+)?(?:forget|remember)/i.test(text)) return { updates, rejected }

  const seenKeys = new Set<string>()
  for (const pattern of PATTERNS) {
    const match = text.match(pattern.regex)
    if (!match) continue
    const built = pattern.build(match)
    if (!built) {
      rejected.push({ reason: `${pattern.name}: nothing left after cleanup` })
      continue
    }
    if (pattern.name === 'explicit-forget') {
      updates.push({ op: 'expire', key: built.key || slugKey(text, 'note'), reason: `user asked to forget "${built.key}"` })
      continue
    }
    if (!built.value || built.value.length < 2) {
      rejected.push({ reason: `${pattern.name}: value too short` })
      continue
    }
    if (seenKeys.has(built.key)) {
      rejected.push({ reason: `${pattern.name}: duplicate key ${built.key}` })
      continue
    }
    if (pattern.importance < IMPORTANCE_FLOOR) {
      rejected.push({ reason: `${pattern.name}: importance ${pattern.importance} below floor ${IMPORTANCE_FLOOR}` })
      continue
    }
    seenKeys.add(built.key)
    // An explicit "remember that …" states the whole fact; a second pattern re-reading
    // the same sentence would write a duplicate under another key.
    if (pattern.name === 'explicit-remember') return { updates: [
      {
        op: 'upsert' as const,
        key: built.key,
        value: built.value,
        importance: pattern.importance,
        reason: `${pattern.name} (importance ${pattern.importance})`,
      },
      // Anything already matched before this one stays, so a two-part message keeps both.
      ...updates.filter((update) => update.key !== built.key),
    ], rejected }
    updates.push({
      op: 'upsert',
      key: built.key,
      value: built.value,
      importance: pattern.importance,
      reason: `${pattern.name} (importance ${pattern.importance})`,
    })
    if (updates.length >= MAX_UPDATES_PER_TURN) break
  }

  if (!updates.length && !rejected.length) rejected.push({ reason: 'no memory pattern matched' })
  return { updates, rejected }
}
