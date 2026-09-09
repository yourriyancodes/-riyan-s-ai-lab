/**
 * SQLite persistence through `node:sqlite` — a real database with zero dependencies.
 *
 * Why this exists: the file store keeps five JSON documents in memory and rewrites them on
 * a debounce. That is honest and portable, but it is not a database — two processes opening
 * the same directory can each hold a stale copy, and a multi-row write (append a message,
 * then bump the conversation's `updated_at`) is two writes, not one. SQLite gives the same
 * zero-cost local path actual transactions, WAL journaling, real indexes, and enforced
 * foreign keys, using only what Node 22+ already ships.
 *
 * Two rules it obeys, both inherited from the Postgres adapter:
 *
 * 1. **Values are never interpolated into SQL.** Every parameter is bound. The one place a
 *    user-supplied string reaches a predicate — term search over memories — goes through
 *    `LIKE … ESCAPE` with the wildcards escaped first.
 * 2. **Referential integrity is enforced, not decorative.** `raven_messages` has a real
 *    foreign key to `raven_conversations`, with `PRAGMA foreign_keys = ON`. That is one
 *    deliberate behavioural difference from the in-process and file adapters, which will
 *    happily accept a message whose conversation row was never written. It is a difference
 *    worth having — orphan history is exactly the kind of row a demo never notices and a
 *    debugging session trips over — but it must not be a secret, so `appendMessage` wraps
 *    the insert and re-throws with a sentence that says what was rejected. A caller that
 *    could not write the conversation first now learns that, instead of storing a message
 *    nobody will ever list.
 * 3. **The schema is not a second copy.** The DDL is derived from `SCHEMA_STATEMENTS` (the
 *    same list that generates `db/schema.sql` for Postgres) by a short, explicit dialect
 *    translation. A column added for Postgres therefore exists here too, or the parity test
 *    in `scripts/check-brain.mjs` fails — which is the point of deriving rather than writing
 *    a second schema nobody remembers to update.
 *
 * `node:sqlite` is still marked experimental, so this driver is opt-in
 * (`RAVEN_DB_DRIVER=sqlite`) and a fresh clone keeps defaulting to the file store. When an
 * older runtime cannot `import('node:sqlite')`, `resolveDatabase()` downgrades with a
 * written reason instead of failing the boot.
 */
import type {
  AgentRunRecord,
  ConversationMessageRecord,
  ConversationRecord,
  DatabaseAdapter,
  DatabaseStatus,
  MemoryRecord,
  ToolRun,
} from '../types'
import { SCHEMA_STATEMENTS, TABLES } from './schema'

type SqliteValue = string | number | null | Uint8Array
type Statement = {
  run(...values: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...values: SqliteValue[]): Record<string, unknown> | undefined
  all(...values: SqliteValue[]): Record<string, unknown>[]
}
type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}

export type SqliteOptions = {
  /** Absolute path. `:memory:` is valid and is what the tests use. */
  path: string
  /** Rows are written with ISO strings; this only affects the DDL defaults. */
  journal?: 'wal' | 'memory'
}

/**
 * Postgres DDL → SQLite DDL. Deliberately small and textual: this is the same schema, not a
 * parallel one. Anything that needs more than these five rules means the two engines have
 * genuinely diverged and the schema file should say so out loud.
 */
export function sqliteDialect(statement: string): string {
  return statement
    // The cast goes first: `\bjsonb\b` would otherwise rewrite the `jsonb` inside
    // `'[]'::jsonb` into `TEXT` and leave `'[]'::TEXT`, which SQLite rejects with
    // "unrecognized token". Order is the whole difference between valid DDL and a
    // confusing startup failure.
    .replace(/::jsonb/g, '')
    .replace(/\btimestamptz\b/g, 'TEXT')
    .replace(/\bjsonb\b/g, 'TEXT')
    .replace(/\bnow\(\)/g, 'CURRENT_TIMESTAMP')
    // SQLite's `boolean` is an integer, and it does not accept a JS boolean as a bind
    // value, so the column type is normalised here and the conversion happens at the edge.
    .replace(/\bboolean\b/g, 'INTEGER')
}

const toIso = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return new Date(value).toISOString()
  return new Date(0).toISOString()
}

const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : fallback)

const json = (value: unknown): string => JSON.stringify(value ?? null)
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    // A row that cannot be parsed is not worth crashing a read over; it is reported as
    // empty so the answer degrades to "nothing retrieved", which is the truth for that row.
    return fallback
  }
}

/** Escape the LIKE wildcards a user could put in a memory term (`%`, `_`, `\`). */
const likeOperand = (term: string): string => term.replace(/[\\%_]/g, (match) => `\\${match}`).toLowerCase()

export async function createSqliteDatabase(options: SqliteOptions): Promise<DatabaseAdapter & { close(): void; checkpoint(): void }> {
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (path: string) => SqliteDatabase
  }
  const db = new DatabaseSync(options.path)
  const inMemory = options.path === ':memory:' || options.journal === 'memory'

  db.exec(`PRAGMA foreign_keys = ON`)
  if (!inMemory) db.exec(`PRAGMA journal_mode = WAL`)
  // Durability over throughput: this store holds conversation history, and a WAL checkpoint
  // that costs a millisecond is cheaper than a lost preference after a container restart.
  if (!inMemory) db.exec(`PRAGMA synchronous = NORMAL`)

  const ensureSchema = async () => {
    for (const statement of SCHEMA_STATEMENTS) db.exec(sqliteDialect(statement))
  }
  // Applied here as well as through `ensureSchema()`, because every `CREATE … IF NOT EXISTS`
  // is idempotent and an adapter that throws `no such table` until somebody remembers to
  // call a second function is an API that invites a production incident. `resolveDatabase()`
  // still calls `ensureSchema()` explicitly, so the shared contract is unchanged.

  const mapConversation = (row: Record<string, unknown>): ConversationRecord => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    title: String(row.title ?? ''),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  })
  const mapMessage = (row: Record<string, unknown>): ConversationMessageRecord => ({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role === 'raven' || row.role === 'system' ? row.role : 'user',
    content: String(row.content ?? ''),
    mode: (row.mode as ConversationMessageRecord['mode']) ?? null,
    state: (row.state as ConversationMessageRecord['state']) ?? null,
    createdAt: toIso(row.created_at),
  })
  const mapMemory = (row: Record<string, unknown>): MemoryRecord => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    key: String(row.key),
    value: String(row.value ?? ''),
    importance: numberOr(row.importance, 0.5),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    source: row.source === 'explicit' || row.source === 'tool' ? row.source : 'extracted',
  })
  const mapAgentRun = (row: Record<string, unknown>): AgentRunRecord => ({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    goal: String(row.goal ?? ''),
    status: String(row.status ?? 'planned') as AgentRunRecord['status'],
    startedAt: toIso(row.started_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : toIso(row.completed_at),
    steps: parseJson(row.steps, []),
    toolsUsed: parseJson<string[]>(row.tools_used, []),
    verified: Number(row.verified ?? 0) === 1,
    result: String(row.result ?? ''),
    mode: (row.mode as AgentRunRecord['mode']) ?? 'knowledge',
  })

  await ensureSchema()

  return {
    status: (): DatabaseStatus => {
      let reachable = false
      try {
        reachable = db.prepare('SELECT 1 AS ok').get()?.ok === 1
      } catch {
        reachable = false
      }
      return {
        driver: 'sqlite',
        configured: true,
        reachable,
        detail: inMemory
          ? 'sqlite via node:sqlite, in-memory (data is lost when the process exits)'
          : `sqlite via node:sqlite at ${options.path} (WAL, foreign keys enforced)`,
      }
    },
    ensureSchema,

    async upsertConversation(conversation) {
      db.prepare(
        `INSERT INTO ${TABLES.conversations} (id, session_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           session_id = excluded.session_id,
           title = excluded.title,
           updated_at = excluded.updated_at`,
      ).run(conversation.id, conversation.sessionId, conversation.title, conversation.createdAt, conversation.updatedAt)
    },

    async appendMessage(message) {
      // One transaction, because "the reply is stored but the conversation still says it
      // was updated last week" is exactly the inconsistency a JSON-file store permits.
      db.exec('BEGIN')
      try {
        db.prepare(
          `INSERT INTO ${TABLES.messages} (id, conversation_id, role, content, mode, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
        ).run(message.id, message.conversationId, message.role, message.content, message.mode, message.state, message.createdAt)
        db.prepare(`UPDATE ${TABLES.conversations} SET updated_at = ? WHERE id = ?`).run(message.createdAt, message.conversationId)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        const reason = (error as Error)?.message ?? 'insert failed'
        // The raw driver says "FOREIGN KEY constraint failed", which is true but useless in
        // a log; say which row could not be attached to what.
        throw /FOREIGN KEY/i.test(reason)
          ? new Error(`message ${message.id} was not stored: conversation ${message.conversationId} does not exist`, { cause: error })
          : error
      }
    },

    async recentMessages(conversationId, limit) {
      // `rowid` is the tiebreaker because these timestamps are millisecond-granular and a
      // turn writes two rows in the same millisecond; without it the pair can come back
      // reversed and the console would show the answer before the question. It has to be
      // aliased in the inner query: a derived table exposes only its named columns, and
      // `rowid` is not one of them.
      const select = `SELECT *, rowid AS __seq FROM ${TABLES.messages} WHERE conversation_id = ?`
      return db
        .prepare(`${select} ORDER BY __seq DESC LIMIT ?`)
        .all(conversationId, Math.max(1, Math.min(500, Math.trunc(limit))))
        .reverse()
        .map(mapMessage)
    },

    async listConversations(sessionId, limit) {
      return db
        .prepare(`SELECT * FROM ${TABLES.conversations} WHERE session_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?`)
        .all(sessionId, Math.max(1, Math.min(200, Math.trunc(limit))))
        .map(mapConversation)
    },

    async remember(memory) {
      db.prepare(
        `INSERT INTO ${TABLES.memories} (id, session_id, key, value, importance, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, key) DO UPDATE SET
           value = excluded.value,
           importance = excluded.importance,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      ).run(memory.id, memory.sessionId, memory.key, memory.value, memory.importance, memory.source, memory.createdAt, memory.updatedAt)
    },

    async recallMemories(sessionId, limit) {
      return db
        .prepare(`SELECT * FROM ${TABLES.memories} WHERE session_id = ? ORDER BY importance DESC, updated_at DESC LIMIT ?`)
        .all(sessionId, Math.max(1, Math.min(200, Math.trunc(limit))))
        .map(mapMemory)
    },

    async searchMemories(sessionId, terms, limit) {
      const needles = terms.map((term) => term.trim()).filter(Boolean).slice(0, 16)
      if (!needles.length) return []
      // Scored in SQL, like the Postgres adapter: the number of distinct terms a row
      // matches, then importance. Each term is one bound parameter — nothing is spliced in.
      // The `ESCAPE '\'` below is two characters in this file and one in the SQL on purpose:
      // a template literal halves it, and SQLite rejects an escape longer than a character.
      // It is what makes a term of `_` match a literal underscore instead of every row.
      const score = needles.map(() => `(CASE WHEN lower(key || ' ' || value) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`).join(' + ')
      const params = needles.map((term) => `%${likeOperand(term)}%`)
      return db
        .prepare(
          `SELECT *, (${score}) AS match_score FROM ${TABLES.memories}
           WHERE session_id = ? AND (${score}) > 0
           ORDER BY match_score DESC, importance DESC, updated_at DESC LIMIT ?`,
        )
        .all(...params, sessionId, ...params, Math.max(1, Math.min(100, Math.trunc(limit))))
        .map(mapMemory)
    },

    async expireMemory(sessionId, key) {
      const result = db.prepare(`DELETE FROM ${TABLES.memories} WHERE session_id = ? AND key = ?`).run(sessionId, key)
      return Number(result.changes) > 0
    },

    async startAgentRun(run) {
      db.prepare(
        `INSERT INTO ${TABLES.agentRuns} (id, conversation_id, goal, mode, status, steps, tools_used, verified, result, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           status = excluded.status,
           steps = excluded.steps,
           tools_used = excluded.tools_used`,
      ).run(run.id, run.conversationId, run.goal, run.mode, run.status, json(run.steps), json(run.toolsUsed), run.verified ? 1 : 0, run.result, run.startedAt, run.completedAt)
    },

    async finishAgentRun(run) {
      db.prepare(
        `UPDATE ${TABLES.agentRuns}
         SET status = ?, steps = ?, tools_used = ?, verified = ?, result = ?, completed_at = ?
         WHERE id = ?`,
      ).run(run.status, json(run.steps), json(run.toolsUsed), run.verified ? 1 : 0, run.result, run.completedAt, run.id)
    },

    async recordToolRun(run) {
      db.prepare(
        `INSERT INTO ${TABLES.toolRuns} (id, agent_run_id, conversation_id, tool_name, input, output, status, error, ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      ).run(run.id, run.agentRunId ?? null, run.conversationId ?? null, run.toolName, json(run.input), json(run.output), run.status, run.error ?? null, Math.trunc(run.ms), run.finishedAt ?? run.startedAt)
    },

    checkpoint() {
      if (!inMemory) db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },
    close() {
      db.close()
    },
  }
}
