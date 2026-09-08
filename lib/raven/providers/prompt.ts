/**
 * The prompt boundary: what RAVEN's persona is, and what a provider is allowed to use
 * as evidence. This file holds no transport logic, which is what lets the knowledge
 * layer and the GenAI layer share one definition of "grounded".
 */
import type { Citation, ConversationMessageRecord, MemoryRecord } from '../types'
import type { RetrievedDocument } from '../knowledge'

export const RAVEN_PERSONA = `You are RAVEN — Riyan Pasha's Autonomous Virtual Engineering Nexus: a digital engineering
companion living inside Riyan Pasha portfolio site.

Voice: intelligent, calm, concise, technically precise, curious, professional, a
little futuristic. Plain sentences, no emoji, no marketing filler. Answer the question
that was asked first; add one useful follow-on observation at most.

Truthfulness rules, in force for every reply:
- State facts about Riyan, his projects, skills, experience, contact details or
  achievements ONLY when they appear in the SUPPLIED SOURCES below. If a fact is not in
  the sources, say that it is not in the portfolio. Never invent or "complete" one.
- Do not claim to have run code, called an API, saved anything, sent a message, visited
  a URL or changed the page unless the execution record says it happened in this turn.
- Do not narrate hidden reasoning. Give the conclusion and, when useful, the one-line
  reason it rests on.
- Do not re-introduce yourself except when asked who you are.
- If asked to compare or judge, name the criteria you used, keep them tied to the
  sources, and stay brief.

Format: prose plus at most one short bullet list. Under 120 words unless the question
needs more.`

export type GroundingInput = {
  question: string
  sources: RetrievedDocument[]
  citations: Citation[]
  recentMessages: ConversationMessageRecord[]
  memories: MemoryRecord[]
  /** Extra instruction for a specific mode, e.g. the JSON shape for synthesis. */
  task?: string
  requireJson?: boolean
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/**
 * Assemble the provider turn.
 *
 * Context is budgeted newest-first (recent messages are dropped from the oldest end,
 * then memory lines, then the least relevant source) so a long conversation cannot
 * silently push the evidence out of the window.
 */
export function buildMessages(input: GroundingInput, budgetChars: number): { system: string; messages: { role: 'user' | 'assistant'; content: string }[]; usedChars: number; truncated: boolean } {
  const blocks: string[] = []
  let used = 0
  const room = (text: string) => {
    if (used + text.length > budgetChars) return false
    used += text.length
    blocks.push(text)
    return true
  }

  if (input.task) room(`TASK\n${input.task}`)

  if (input.memories.length) {
    const lines = input.memories
      .slice(0, 8)
      .map((memory) => `- ${memory.key}: ${clip(memory.value, 160)}`)
      .join('\n')
    room(`USER FACTS RAVEN HAS STORED (from earlier sessions, not portfolio data)\n${lines}`)
  }

  if (input.recentMessages.length) {
    const lines: string[] = []
    let chars = 0
    for (const message of [...input.recentMessages].reverse()) {
      const line = `${message.role === 'user' ? 'User' : 'RAVEN'}: ${clip(message.content, 400)}`
      if (chars + line.length > Math.min(budgetChars * 0.4, 2400)) {
        lines.unshift('…older turns omitted…')
        break
      }
      chars += line.length
      lines.unshift(line)
    }
    room(`RECENT CONVERSATION\n${lines.join('\n')}`)
  }

  if (input.sources.length) {
    const header = 'SUPPLIED SOURCES — the only permitted evidence for portfolio claims'
    // The "trimmed" note is reserved for, not squeezed in afterwards: silently dropping
    // evidence is exactly the failure a context budget must never hide.
    const reserve = 90
    const sources: string[] = []
    let skipped = 0
    for (const [index, hit] of input.sources.entries()) {
      const block = `[${index + 1}] ${hit.title} (id: ${hit.id}; source: ${hit.citation.source})\n${clip(hit.body, 900)}`
      const tail = index < input.sources.length - 1 ? reserve : 0
      if (used + header.length + 2 + block.length + tail > budgetChars) {
        skipped = input.sources.length - index
        break
      }
      used += block.length + 2
      sources.push(block)
    }
    const block = `${header}\n${sources.join('\n\n')}${skipped ? `\n…${skipped} further source(s) trimmed for context budget…` : ''}`
    // Already budgeted token by token above, so this goes in directly rather than through
    // `room()`, which would re-measure against a total that includes these blocks twice.
    if (sources.length) {
      used += header.length + (skipped ? reserve : 0)
      blocks.push(block)
    }
  } else {
    room('SUPPLIED SOURCES\n(none: this question is not covered by the portfolio data)')
  }

  room(`QUESTION\n${input.question}`)

  const system = input.requireJson
    ? `${RAVEN_PERSONA}\n\nReply with a single JSON object and nothing else: {"answer": string}.`
    : RAVEN_PERSONA

  return { system, messages: [{ role: 'user', content: blocks.join('\n\n') }], usedChars: used, truncated: blocks.some((block) => block.includes('trimmed for context budget') || block.includes('older turns omitted')) }
}

/** Models wrap JSON in fences or lead-ins far more often than documentation admits. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const withoutFences = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const candidates = [withoutFences]
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(withoutFences.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      /* try the next shape */
    }
  }
  return null
}

export function cleanReply(text: string): string {
  return text
    .replace(/^\s*```(?:json|markdown)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^RAVEN:?\s*/i, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
