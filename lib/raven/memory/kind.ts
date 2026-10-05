/**
 * What kind of thing a stored memory is.
 *
 * Derived from the key and the value, never stored. A column for this would need a migration on
 * three drivers to hold a fact that is recomputable from the two columns it already has — and a
 * label that can drift from the row it describes is worse than no label, because it reads like
 * evidence. The rule is deterministic and public: the same row always gets the same kind, in every
 * process and on every driver, with no state in between.
 */
import type { MemoryRecord } from '../types'

export type MemoryKind = 'preference' | 'fact' | 'reference' | 'correction' | 'note'

const CORRECTION_KEY = /(^|\.)(correction|instead|wrong|not)\b/i
const PREFERENCE_KEY = /(^|\.)(prefer\w*|style|tone|length|format|language|answer\.\w+|wording)\b/i
const REFERENCE_KEY = /(^|\.)(contact|email|link|url|repo|github|profile|site|phone)\b/i
const PREFERENCE_VALUE = /^(i prefer|always|never|prefer|use\b|please\s)/i
const FACT_VALUE = /^(my|our|the|this|these)\s[\w\s.'/-]{1,40}?\s(is|are|was|were)\b/i

export function deriveMemoryKind(key: string, value: string): MemoryKind {
  const k = String(key ?? '')
  const v = String(value ?? '').trim()
  if (CORRECTION_KEY.test(k)) return 'correction'
  if (PREFERENCE_KEY.test(k) || PREFERENCE_VALUE.test(v)) return 'preference'
  if (REFERENCE_KEY.test(k) || /(https?:\/\/|mailto:|[\w.+-]+@[\w-]+\.[a-z]{2,})/i.test(v)) return 'reference'
  if (FACT_VALUE.test(v)) return 'fact'
  return 'note'
}

/** Fill in the kind for a row that came back without one, leaving a stored value alone if present. */
export function withMemoryKind<T extends Partial<MemoryRecord>>(record: T): T & { kind: MemoryKind } {
  const known = (record as { kind?: unknown }).kind
  const kind = typeof known === 'string' && ['preference', 'fact', 'reference', 'correction', 'note'].includes(known)
    ? (known as MemoryKind)
    : deriveMemoryKind(String((record as { key?: unknown }).key ?? ''), String((record as { value?: unknown }).value ?? ''))
  return { ...record, kind }
}
