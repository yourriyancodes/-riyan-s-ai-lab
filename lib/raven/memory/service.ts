/**
 * Short- and long-term memory access for one turn.
 *
 * Short term = the last N messages of this conversation, read from the adapter, used
 * for continuity ("what did I just ask?"). Long term = durable facts keyed by session,
 * retrieved by the words in the current question plus a top-importance fallback, so a
 * recall question still lands when the phrasing does not match a key.
 *
 * Both are best-effort by design: every path here swallows adapter failures into
 * `errors`, because losing memory must downgrade the answer, never break it.
 */
import type { ConversationMessageRecord, DatabaseAdapter, MemoryRecord, MemoryUpdate, RavenMode, RavenState } from '../types'
import { tokenize } from '../knowledge/search'

export type ContextBundle = {
  conversationId: string
  recent: ConversationMessageRecord[]
  memories: MemoryRecord[]
  source: 'postgres' | 'postgres-rest' | 'file' | 'memory' | 'none'
  errors: string[]
}

export type MemoryLimits = { maxHistoryMessages: number; maxMemoriesInContext: number }

const STOPWORD_SET = new Set(['the', 'and', 'you', 'your', 'are', 'was', 'what', 'when', 'with', 'that', 'this', 'have', 'has'])

export function recallTerms(message: string, limit = 6): string[] {
  const unique: string[] = []
  for (const token of tokenize(message)) {
    if (token.length < 4 || STOPWORD_SET.has(token)) continue
    if (!unique.includes(token)) unique.push(token)
    if (unique.length >= limit) break
  }
  return unique
}

export async function loadContext(input: {
  adapter: DatabaseAdapter | null
  sessionId: string
  conversationId: string
  message: string
  limits: MemoryLimits
}): Promise<ContextBundle> {
  const errors: string[] = []
  const none: ContextBundle = { conversationId: input.conversationId, recent: [], memories: [], source: 'none', errors }
  if (!input.adapter) {
    errors.push('no persistence adapter available')
    return none
  }
  const source = input.adapter.status().driver
  let recent: ConversationMessageRecord[] = []
  let memories: MemoryRecord[] = []
  try {
    recent = await input.adapter.recentMessages(input.conversationId, input.limits.maxHistoryMessages)
  } catch (error) {
    errors.push(`conversation read failed: ${(error as Error)?.message ?? 'unknown'}`.slice(0, 240))
  }
  try {
    const terms = recallTerms(input.message)
    const found = terms.length ? await input.adapter.searchMemories(input.sessionId, terms, input.limits.maxMemoriesInContext) : []
    memories = found
    if (!found.length) {
      // Fallback: the most important facts the session owns, so "hi" still carries the
      // context of who the user told RAVEN they are.
      memories = await input.adapter.recallMemories(input.sessionId, Math.max(3, Math.floor(input.limits.maxMemoriesInContext / 2)))
    }
  } catch (error) {
    errors.push(`memory read failed: ${(error as Error)?.message ?? 'unknown'}`.slice(0, 240))
  }
  return { conversationId: input.conversationId, recent, memories, source, errors }
}

/** Recall intent: answer "what do you remember" from the store, not from a model. */
export async function listMemories(adapter: DatabaseAdapter | null, sessionId: string, limit = 12): Promise<{ memories: MemoryRecord[]; error: string | null; source: ContextBundle['source'] }> {
  if (!adapter) return { memories: [], error: 'no persistence adapter available', source: 'none' }
  try {
    return { memories: await adapter.recallMemories(sessionId, limit), error: null, source: adapter.status().driver }
  } catch (error) {
    return { memories: [], error: (error as Error)?.message?.slice(0, 240) ?? 'read failed', source: adapter.status().driver }
  }
}

export type TurnToStore = {
  adapter: DatabaseAdapter | null
  sessionId: string
  conversationId: string
  userMessage: string
  answer: string
  mode: RavenMode
  state: RavenState
  updates: MemoryUpdate[]
  now: string
  /** Persisted only on explicit user requests, so the console can show the outcome. */
  persistMemories: boolean
}

export type StoreResult = { stored: number; messagesWritten: number; errors: string[] }

export async function storeTurn(turn: TurnToStore): Promise<StoreResult> {
  const errors: string[] = []
  if (!turn.adapter) return { stored: 0, messagesWritten: 0, errors: ['persistence unavailable (no adapter)'] }
  const adapter = turn.adapter
  let stored = 0
  let messagesWritten = 0
  try {
    await adapter.upsertConversation({
      id: turn.conversationId,
      sessionId: turn.sessionId,
      title: turn.userMessage.replace(/\s+/g, ' ').slice(0, 80),
      createdAt: turn.now,
      updatedAt: turn.now,
    })
  } catch (error) {
    errors.push(`conversation write failed: ${(error as Error)?.message ?? 'unknown'}`.slice(0, 240))
  }
  for (const [role, content] of [
    ['user', turn.userMessage],
    ['raven', turn.answer],
  ] as const) {
    try {
      await adapter.appendMessage({
        id: `${turn.conversationId}-${role}-${Date.now().toString(36)}-${messagesWritten}`,
        conversationId: turn.conversationId,
        role,
        content,
        mode: role === 'raven' ? turn.mode : null,
        state: turn.state,
        createdAt: turn.now,
      })
      messagesWritten++
    } catch (error) {
      errors.push(`message write failed: ${(error as Error)?.message ?? 'unknown'}`.slice(0, 240))
      break
    }
  }
  if (turn.persistMemories) {
    for (const update of turn.updates) {
      try {
        if (update.op === 'expire') {
          await adapter.expireMemory(turn.sessionId, update.key)
          stored++
          continue
        }
        await adapter.remember({
          id: `mem-${turn.sessionId.slice(-8)}-${update.key}`,
          sessionId: turn.sessionId,
          key: update.key,
          value: update.value ?? '',
          importance: Math.max(0.1, Math.min(1, update.importance ?? 0.5)),
          createdAt: turn.now,
          updatedAt: turn.now,
          source: 'extracted',
        })
        stored++
      } catch (error) {
        errors.push(`memory write failed (${update.key}): ${(error as Error)?.message ?? 'unknown'}`.slice(0, 240))
      }
    }
  }
  // A file-backed store flushes in the background; awaiting keeps a dev-server restart
  // from losing the last turn.
  const flushable = adapter as unknown as { flush?: () => Promise<void> }
  if (typeof flushable.flush === 'function') {
    try {
      await flushable.flush()
    } catch {
      /* already reported through status() */
    }
  }
  return { stored, messagesWritten, errors }
}
