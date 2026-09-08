/**
 * Supabase PostgREST adapter — the zero-dependency route to a managed database.
 *
 * Why this exists next to the `pg` driver: a Next.js serverless function does not get
 * a long-lived connection pool, and "add `pg` and open a TCP socket" is the wrong
 * instruction for a portfolio project on a free tier. Supabase already exposes REST over
 * the same schema, so the brain talks to it with `fetch`, and the SQL schema stays the
 * one in db/schema.sql. Same adapter, same rows, no new dependency.
 */
import { TABLES } from './schema'
import type {
  AgentRunRecord,
  ConversationMessageRecord,
  ConversationRecord,
  DatabaseAdapter,
  DatabaseStatus,
  MemoryRecord,
  ToolRun,
} from '../types'
import type { RavenState } from '../types'
import { isRavenState } from '../states'

export type SupabaseRestOptions = {
  /** Project URL, e.g. https://xyz.supabase.co */
  url: string
  /** Server-side key only (service role, or an anon key when RLS permits). Never sent to the browser. */
  key: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type RecordedRequest = { method: string; path: string; body: unknown }

const rowsOf = (payload: unknown): Record<string, unknown>[] => (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : payload && typeof payload === 'object' ? [payload as Record<string, unknown>] : [])

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : new Date(0).toISOString())

export function createSupabaseRestDatabase(options: SupabaseRestOptions): DatabaseAdapter & { requests: RecordedRequest[]; unreachableReason: () => string | null } {
  const base = `${options.url.replace(/\/+$/, '')}/rest/v1`
  const timeoutMs = options.timeoutMs ?? 8000
  const doFetch = options.fetchImpl ?? fetch
  const requests: RecordedRequest[] = []
  let checked = false
  let unreachableReason: string | null = null

  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const url = `${base}/${path}`
    requests.push({ method, path, body: body ?? null })
    const response = await doFetch(url, {
      method,
      headers: {
        apikey: options.key,
        authorization: `Bearer ${options.key}`,
        'content-type': 'application/json',
        prefer: method === 'POST' ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: Error) => {
      checked = true
      unreachableReason = `${error.name === 'TimeoutError' || error.name === 'AbortError' ? 'request timed out' : error.message}`.slice(0, 300)
      throw new Error(`supabase rest ${method} ${path.split('?')[0]} failed: ${unreachableReason}`)
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      checked = true
      unreachableReason = `${response.status} ${text.slice(0, 240)}`
      throw new Error(`supabase rest ${method} ${path.split('?')[0]} -> ${unreachableReason}`)
    }
    checked = true
    unreachableReason = null
    if (response.status === 204) return []
    const text = await response.text()
    if (!text) return []
    try {
      return JSON.parse(text) as unknown
    } catch {
      return []
    }
  }

  const select = async (table: string, query: string) => rowsOf(await call('GET', `${table}?${query}`))

  return {
    requests,
    unreachableReason: () => unreachableReason,
    status: (): DatabaseStatus => ({
      driver: 'postgres-rest',
      configured: true,
      reachable: checked && !unreachableReason,
      detail: unreachableReason ? `supabase rest: ${unreachableReason}` : 'supabase rest (PostgREST) transport',
    }),
    // PostgREST cannot create tables, so reachability is proven by a read instead;
    // a missing table is reported with the exact hint about running schema.sql.
    ensureSchema: async () => {
      try {
        await select(TABLES.conversations, 'select=id&limit=1')
      } catch (error) {
        throw new Error(`${(error as Error).message} — if the tables do not exist yet, apply db/schema.sql in the Supabase SQL editor`)
      }
    },
    upsertConversation: async (conversation: ConversationRecord) => {
      await call('POST', `${TABLES.conversations}?on_conflict=id`, [
        { id: conversation.id, session_id: conversation.sessionId, title: conversation.title, created_at: conversation.createdAt, updated_at: conversation.updatedAt },
      ])
    },
    appendMessage: async (entry: ConversationMessageRecord) => {
      await call('POST', TABLES.messages, [
        {
          id: entry.id,
          conversation_id: entry.conversationId,
          role: entry.role,
          content: entry.content,
          mode: entry.mode ?? null,
          state: entry.state ?? null,
          created_at: entry.createdAt,
        },
      ])
      await call('PATCH', `${TABLES.conversations}?id=eq.${encodeURIComponent(entry.conversationId)}`, { updated_at: entry.createdAt })
    },
    recentMessages: async (conversationId: string, limit: number) => {
      const rows = await select(TABLES.messages, `conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.desc,id.desc&limit=${limit}`)
      return rows.map((row) => ({
        id: String(row.id),
        conversationId: String(row.conversation_id),
        role: row.role === 'system' ? ('system' as const) : row.role === 'raven' ? ('raven' as const) : ('user' as const),
        content: String(row.content ?? ''),
        mode: row.mode == null ? null : (String(row.mode) as ConversationMessageRecord['mode']),
        state: isRavenState(row.state) ? (row.state as RavenState) : null,
        createdAt: iso(row.created_at),
      })).reverse()
    },
    listConversations: async (sessionId: string, limit: number) => {
      const rows = await select(TABLES.conversations, `session_id=eq.${encodeURIComponent(sessionId)}&order=updated_at.desc&limit=${limit}`)
      return rows.map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        title: String(row.title ?? ''),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      }))
    },
    remember: async (memory: MemoryRecord) => {
      await call('POST', `${TABLES.memories}?on_conflict=session_id,key`, [
        {
          id: memory.id,
          session_id: memory.sessionId,
          key: memory.key,
          value: memory.value,
          importance: memory.importance,
          source: memory.source,
          created_at: memory.createdAt,
          updated_at: memory.updatedAt,
        },
      ])
    },
    recallMemories: async (sessionId: string, limit: number) => {
      const rows = await select(TABLES.memories, `session_id=eq.${encodeURIComponent(sessionId)}&order=importance.desc,updated_at.desc&limit=${limit}`)
      return rows.map((row) => memoryFrom(row))
    },
    searchMemories: async (sessionId: string, terms: string[], limit: number) => {
      if (!terms.length) return []
      const or = terms.map((term) => `and(key.ilike.${wildcard(term)},value.ilike.${wildcard(term)})`).join(',')
      const rows = await select(TABLES.memories, `session_id=eq.${encodeURIComponent(sessionId)}&or=(${or})&order=importance.desc,updated_at.desc&limit=${limit}`)
      return rows.map((row) => memoryFrom(row))
    },
    expireMemory: async (sessionId: string, key: string) => {
      const result = await call('DELETE', `${TABLES.memories}?session_id=eq.${encodeURIComponent(sessionId)}&key=eq.${encodeURIComponent(key)}&select=id`, undefined)
      return rowsOf(result).length > 0 || result === undefined
    },
    startAgentRun: async (run: AgentRunRecord) => {
      await call('POST', `${TABLES.agentRuns}?on_conflict=id`, [
        {
          id: run.id,
          conversation_id: run.conversationId,
          goal: run.goal,
          mode: run.mode,
          status: run.status,
          steps: run.steps,
          tools_used: run.toolsUsed,
          verified: run.verified,
          result: run.result,
          started_at: run.startedAt,
          completed_at: run.completedAt ?? null,
        },
      ])
    },
    finishAgentRun: async (run: AgentRunRecord) => {
      await call('PATCH', `${TABLES.agentRuns}?id=eq.${encodeURIComponent(run.id)}`, {
        status: run.status,
        steps: run.steps,
        tools_used: run.toolsUsed,
        verified: run.verified,
        result: run.result,
        completed_at: run.completedAt ?? null,
      })
    },
    recordToolRun: async (run: ToolRun & { conversationId: string }) => {
      await call('POST', TABLES.toolRuns, [
        {
          id: run.id,
          agent_run_id: run.agentRunId ?? null,
          conversation_id: run.conversationId,
          tool_name: run.toolName,
          input: run.input,
          output: run.output,
          status: run.status,
          error: run.error ?? null,
          ms: run.ms,
          created_at: run.startedAt,
        },
      ])
    },
  }
}

const wildcard = (term: string) => `*${term.replace(/[,()]/g, '')}*`

function memoryFrom(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    key: String(row.key),
    value: String(row.value ?? ''),
    importance: Number(row.importance ?? 0.5),
    source: (['extracted', 'explicit', 'tool'] as const).includes(row.source as 'extracted') ? (row.source as MemoryRecord['source']) : 'extracted',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}
