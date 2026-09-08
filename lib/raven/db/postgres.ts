/**
 * Postgres adapter for `DATABASE_URL` (self-hosted, Neon, or Supabase's pooled
 * connection string).
 *
 * `pg` is deliberately NOT a dependency of this project: an optional driver should not
 * be installed — or bundled — when nobody configured a database. It is resolved at
 * runtime through an indirect dynamic import, and if it is missing the brain falls back
 * and says so. The adapter takes any object with a `query` method, which is what lets
 * the SQL be asserted in tests without a server.
 */
import { SCHEMA_STATEMENTS, TABLES } from './schema'
import { isRavenState } from '../states'
import type {
  ConversationMessageRecord,
  ConversationRecord,
  DatabaseAdapter,
  DatabaseStatus,
  MemoryRecord,
} from '../types'

export type PgQueryResult = { rows: Record<string, unknown>[]; rowCount?: number }
export type PgQueryable = { query: (sql: string, params?: readonly unknown[]) => Promise<PgQueryResult> }

export type PostgresAdapterOptions = {
  /** Run the schema statements on first use. Idempotent (CREATE ... IF NOT EXISTS). */
  ensureSchema?: boolean
  detail?: string
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : new Date(0).toISOString())

function conversation(row: Record<string, unknown>): ConversationRecord {
  return { id: String(row.id), sessionId: String(row.session_id), title: String(row.title ?? ''), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

function message(row: Record<string, unknown>): ConversationMessageRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role === 'system' ? 'system' : row.role === 'raven' ? 'raven' : 'user',
    content: String(row.content ?? ''),
    mode: row.mode == null ? null : (String(row.mode) as ConversationMessageRecord['mode']),
    state: isRavenState(row.state) ? row.state : null,
    createdAt: iso(row.created_at),
  }
}

function memory(row: Record<string, unknown>): MemoryRecord {
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

function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/**
 * Build the adapter. `executed` accumulates `{sql, params}` pairs so a test can assert
 * the exact statements — the same list a reviewer would read in a migration file.
 */
export function createPostgresDatabase(client: PgQueryable, options: PostgresAdapterOptions = {}): DatabaseAdapter & { executed: { sql: string; params: unknown[] }[] } {
  const executed: { sql: string; params: unknown[] }[] = []
  let schemaReady: Promise<void> | null = null

  const run = async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params })
    const result = await client.query(sql, params)
    return result
  }

  const ensureSchema = async () => {
    if (!options.ensureSchema) return
    if (!schemaReady) {
      schemaReady = (async () => {
        for (const statement of SCHEMA_STATEMENTS) await run(statement, [])
      })().catch((error: Error) => {
        schemaReady = null
        throw error
      })
    }
    await schemaReady
  }

  return {
    executed,
    status: (): DatabaseStatus => ({
      driver: 'postgres',
      configured: true,
      reachable: true,
      detail: options.detail ?? 'postgres via DATABASE_URL',
    }),
    ensureSchema,
    upsertConversation: async (conversation) => {
      await ensureSchema()
      await run(
        `INSERT INTO ${TABLES.conversations} (id, session_id, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at`,
        [conversation.id, conversation.sessionId, conversation.title, conversation.createdAt, conversation.updatedAt],
      )
    },
    appendMessage: async (entry) => {
      await ensureSchema()
      await run(
        `INSERT INTO ${TABLES.messages} (id, conversation_id, role, content, mode, state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [entry.id, entry.conversationId, entry.role, entry.content, entry.mode ?? null, entry.state ?? null, entry.createdAt],
      )
      await run(`UPDATE ${TABLES.conversations} SET updated_at = $2 WHERE id = $1`, [entry.conversationId, entry.createdAt])
    },
    recentMessages: async (conversationId, limit) => {
      await ensureSchema()
      const result = await run(
        `SELECT * FROM ${TABLES.messages} WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [conversationId, limit],
      )
      return result.rows.map(message).reverse()
    },
    listConversations: async (sessionId, limit) => {
      await ensureSchema()
      const result = await run(`SELECT * FROM ${TABLES.conversations} WHERE session_id = $1 ORDER BY updated_at DESC LIMIT $2`, [sessionId, limit])
      return result.rows.map(conversation)
    },
    remember: async (record) => {
      await ensureSchema()
      await run(
        `INSERT INTO ${TABLES.memories} (id, session_id, key, value, importance, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (session_id, key) DO UPDATE
           SET value = EXCLUDED.value,
               importance = GREATEST(raven_memories.importance, EXCLUDED.importance),
               source = EXCLUDED.source,
               updated_at = EXCLUDED.updated_at`,
        [record.id, record.sessionId, record.key, record.value, record.importance, record.source, record.createdAt, record.updatedAt],
      )
    },
    recallMemories: async (sessionId, limit) => {
      await ensureSchema()
      const result = await run(`SELECT * FROM ${TABLES.memories} WHERE session_id = $1 ORDER BY importance DESC, updated_at DESC LIMIT $2`, [sessionId, limit])
      return result.rows.map(memory)
    },
    searchMemories: async (sessionId, terms, limit) => {
      await ensureSchema()
      if (!terms.length) return []
      const clauses = terms.map((_, index) => `(key ILIKE $${index + 2} OR value ILIKE $${index + 2})`)
      const result = await run(
        `SELECT * FROM ${TABLES.memories} WHERE session_id = $1 AND (${clauses.join(' OR ')}) ORDER BY importance DESC, updated_at DESC LIMIT $${terms.length + 2}`,
        [sessionId, ...terms.map((term) => `%${term}%`), limit],
      )
      return result.rows.map(memory)
    },
    expireMemory: async (sessionId, key) => {
      await ensureSchema()
      const result = await run(`DELETE FROM ${TABLES.memories} WHERE session_id = $1 AND key = $2`, [sessionId, key])
      return (result.rowCount ?? result.rows.length) > 0
    },
    startAgentRun: async (agentRun) => {
      await ensureSchema()
      await run(
        `INSERT INTO ${TABLES.agentRuns} (id, conversation_id, goal, mode, status, steps, tools_used, verified, result, started_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, steps = EXCLUDED.steps, tools_used = EXCLUDED.tools_used`,
        [agentRun.id, agentRun.conversationId, agentRun.goal, agentRun.mode, agentRun.status, json(agentRun.steps), json(agentRun.toolsUsed), agentRun.verified, agentRun.result, agentRun.startedAt],
      )
    },
    finishAgentRun: async (agentRun) => {
      await ensureSchema()
      await run(
        `UPDATE ${TABLES.agentRuns}
            SET status = $2, steps = $3::jsonb, tools_used = $4::jsonb, verified = $5, result = $6, completed_at = $7
          WHERE id = $1`,
        [agentRun.id, agentRun.status, json(agentRun.steps), json(agentRun.toolsUsed), agentRun.verified, agentRun.result, agentRun.completedAt ?? null],
      )
    },
    recordToolRun: async (toolRun) => {
      await ensureSchema()
      await run(
        `INSERT INTO ${TABLES.toolRuns} (id, agent_run_id, conversation_id, tool_name, input, output, status, error, ms, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
        [
          toolRun.id,
          toolRun.agentRunId ?? null,
          toolRun.conversationId ?? null,
          toolRun.toolName,
          json(toolRun.input),
          json(toolRun.output ?? null),
          toolRun.status,
          toolRun.error ?? null,
          toolRun.ms,
          toolRun.startedAt,
        ],
      )
    },
  }
}

/** Runtime-only resolution: the bundler must never see an optional dependency. */
const importOptionalModule = (name: string): Promise<unknown> =>
  (Function('name', 'return import(name)') as (moduleName: string) => Promise<unknown>)(name)

export type PostgresConnection =
  | { ok: true; client: PgQueryable; close: () => Promise<void>; detail: string }
  | { ok: false; error: string }

/**
 * Connect with `pg` if it is installed. Timeouts are enforced twice — by the pool's
 * own connection timeout and by a race around the handshake — because a database that
 * is merely unreachable (a sleeping Neon branch is the everyday case here) must not be
 * able to hang a request.
 */
export async function connectPostgres(connectionString: string, timeoutMs = 5000): Promise<PostgresConnection> {
  let module: unknown
  try {
    module = await importOptionalModule('pg')
  } catch (error) {
    return {
      ok: false,
      error: `the "pg" package is not installed (${(error as Error)?.message?.slice(0, 120) ?? 'import failed'}) — run "npm install pg" to enable Postgres persistence; until then RAVEN uses its file store`,
    }
  }
  const withDefault = module as { Pool?: new (config: Record<string, unknown>) => PgQueryable & { end?: () => Promise<void> }; default?: { Pool?: new (config: Record<string, unknown>) => PgQueryable & { end?: () => Promise<void> } } }
  const Pool = withDefault.Pool ?? withDefault.default?.Pool
  if (!Pool) return { ok: false, error: 'the "pg" package did not expose a Pool constructor' }

  const needsSsl = /[?&]sslmode=(require|verify-full)/.test(connectionString)
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: timeoutMs, ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}) })
  const timeoutSignal = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`connection timed out after ${timeoutMs} ms`)), timeoutMs))
  try {
    const result = await Promise.race([pool.query('SELECT 1 AS ok'), timeoutSignal])
    if (!result?.rows?.length) throw new Error('handshake returned no rows')
    return {
      ok: true,
      client: pool,
      close: async () => {
        try {
          await pool.end?.()
        } catch {
          /* pool already gone */
        }
      },
      detail: 'connected through "pg"',
    }
  } catch (error) {
    try {
      await pool.end?.()
    } catch {
      /* ignore */
    }
    return { ok: false, error: (error as Error)?.message?.slice(0, 300) ?? 'connection failed' }
  }
}
