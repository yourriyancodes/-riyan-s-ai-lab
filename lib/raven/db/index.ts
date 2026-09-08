/**
 * Database resolution and graceful degradation — the part of the brain that decides
 * where state lives.
 *
 * Contract with everything above it:
 *  - `getDatabase()` never throws and never returns null. There is always *some*
 *    working adapter, because "no database" is the default state of a fresh clone.
 *  - A configured-but-broken database is a downgrade with a written reason, never a
 *    crash: the attempt is recorded in `notes`, which reach `metadata.database.detail`
 *    and `/api/health`, so a sleeping Neon branch is visible instead of silent.
 *  - Nothing here decides policy; it only builds adapters and keeps one cached handle.
 */
import { ravenConfig, type RavenConfig } from '../config'
import type { DatabaseAdapter, DatabaseDriver, DatabaseStatus } from '../types'
import { connectPostgres, createPostgresDatabase } from './postgres'
import { createSupabaseRestDatabase } from './supabaseRest'
import { createMemoryDatabase } from './memoryStore'

export type DatabaseHandle = {
  adapter: DatabaseAdapter
  driver: DatabaseDriver
  /** Why an earlier candidate was rejected. Empty when everything worked. */
  notes: string[]
}

let settled: DatabaseHandle | null = null
let pending: Promise<DatabaseHandle> | null = null

function candidatesFor(config: RavenConfig): DatabaseDriver[] {
  const { database, allowFileStore } = config
  if (database.forced) {
    const forced = database.forced
    const rest: DatabaseDriver[] = []
    if (forced !== 'memory' && database.url && forced !== 'postgres') rest.push('postgres')
    if (forced !== 'memory' && database.restUrl && database.restKey && forced !== 'postgres-rest') rest.push('postgres-rest')
    if (allowFileStore && forced !== 'file') rest.push('file')
    if (forced !== 'memory') rest.push('memory')
    return [forced, ...rest]
  }
  const list: DatabaseDriver[] = []
  if (database.url) list.push('postgres')
  if (database.restUrl && database.restKey) list.push('postgres-rest')
  if (allowFileStore) list.push('file')
  list.push('memory')
  return list
}

async function build(driver: DatabaseDriver, config: RavenConfig): Promise<{ ok: true; adapter: DatabaseAdapter } | { ok: false; error: string }> {
  if (driver === 'memory') return { ok: true, adapter: createMemoryDatabase() }

  if (driver === 'file') {
    if (!config.allowFileStore) return { ok: false, error: 'RAVEN_ALLOW_FILE_STORE=0 (disk writes disabled)' }
    try {
      // Imported lazily: `node:fs` must not appear in a bundle that could be built for
      // a runtime without it.
      const { createFileDatabase } = await import('./fileStore')
      const { resolve } = await import('node:path')
      // `turbopackIgnore` keeps the bundler from treating a configurable directory as a
      // build-time trace. Without it, Turbopack warns that the whole project gets copied
      // into the server output because one path argument is not statically known.
      const directory = resolve(/* turbopackIgnore: true */ process.cwd(), config.database.dataDir)
      const adapter = await createFileDatabase(directory)
      await adapter.ensureSchema()
      return { ok: true, adapter }
    } catch (error) {
      return { ok: false, error: `file store at ${config.database.dataDir}: ${(error as Error)?.message ?? 'unwritable'}` }
    }
  }

  if (driver === 'postgres-rest') {
    const { restUrl, restKey } = config.database
    if (!restUrl || !restKey) return { ok: false, error: 'SUPABASE_URL or SUPABASE_DB_KEY is not set' }
    const adapter = createSupabaseRestDatabase({ url: restUrl, key: restKey, timeoutMs: config.database.timeoutMs })
    try {
      await adapter.ensureSchema()
      return { ok: true, adapter }
    } catch (error) {
      return { ok: false, error: (error as Error)?.message?.slice(0, 400) ?? 'supabase rest unreachable' }
    }
  }

  // Postgres over a connection string.
  const { url } = config.database
  if (!url) return { ok: false, error: 'DATABASE_URL is not set' }
  const connection = await connectPostgres(url, config.database.timeoutMs)
  if (!connection.ok) return { ok: false, error: connection.error }
  const adapter = createPostgresDatabase(connection.client, { ensureSchema: true, detail: connection.detail })
  try {
    await adapter.ensureSchema()
    return { ok: true, adapter }
  } catch (error) {
    await connection.close()
    return { ok: false, error: `connected, but the schema could not be prepared: ${(error as Error)?.message ?? 'unknown'}`.slice(0, 400) }
  }
}

async function resolveDatabase(config: RavenConfig): Promise<DatabaseHandle> {
  const notes: string[] = []
  for (const driver of candidatesFor(config)) {
    try {
      const built = await build(driver, config)
      if (built.ok) {
        return { adapter: built.adapter, driver, notes }
      }
      notes.push(`${driver}: ${built.error}`)
    } catch (error) {
      notes.push(`${driver}: ${(error as Error)?.message ?? 'unexpected failure'}`.slice(0, 400))
    }
  }
  // Unreachable in practice — memory has no failure mode — but the brain must not be
  // one surprising exception away from a 500.
  return { adapter: createMemoryDatabase('emergency in-process store'), driver: 'memory', notes }
}

/** Cached handle. Concurrent callers share one resolution. */
export function getDatabase(config: RavenConfig = ravenConfig()): Promise<DatabaseHandle> {
  if (settled) return Promise.resolve(settled)
  if (!pending) {
    pending = resolveDatabase(config).then((handle) => {
      settled = handle
      pending = null
      return handle
    })
  }
  return pending
}

/** `null` until the first resolution; cheap enough to call on every request. */
export async function databaseFor(config?: RavenConfig): Promise<DatabaseAdapter | null> {
  try {
    return (await getDatabase(config)).adapter
  } catch {
    return null
  }
}

export function peekDatabaseHandle(): DatabaseHandle | null {
  return settled
}

/** Reported by /api/health. Resolves the database if nothing has touched it yet. */
export async function inspectDatabase(config: RavenConfig = ravenConfig()): Promise<DatabaseStatus & { notes: string[]; attempted?: DatabaseDriver[] }> {
  const handle = await getDatabase(config)
  const status = handle.adapter.status()
  return { ...status, driver: handle.driver, notes: [...handle.notes] }
}

/** Test seam: forget the cached handle so a new environment takes effect. */
export function resetDatabaseHandle(): void {
  settled = null
  pending = null
}

export { SCHEMA_SQL, SCHEMA_STATEMENTS, TABLES } from './schema'
export { createMemoryDatabase } from './memoryStore'
export { createFileDatabase } from './fileStore'
export { createPostgresDatabase, connectPostgres } from './postgres'
export { createSupabaseRestDatabase } from './supabaseRest'
export type { MemoryStoreRows } from './memoryStore'
