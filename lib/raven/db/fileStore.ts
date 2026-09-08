/**
 * JSON-file persistence — the fallback that still persists.
 *
 * An in-process Map is fine for a test, but "database not configured" should not mean
 * "you cannot try RAVEN's memory out". Writing the same rows to `.raven-data/*.json`
 * gives real persistence across dev restarts, at zero cost and with no service to
 * sign up for. Writes are serialized through one queue and land via a temp-file
 * rename, so a crash mid-write cannot truncate the store.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseAdapter, DatabaseStatus } from '../types'
import { createMemoryDatabase, type MemoryStoreRows } from './memoryStore'

const FILES: Record<keyof MemoryStoreRows, string> = {
  conversations: 'conversations.json',
  messages: 'messages.json',
  memories: 'memories.json',
  agentRuns: 'agent-runs.json',
  toolRuns: 'tool-runs.json',
}

export type FileDatabaseOptions = {
  /** Extra note appended to status().detail. */
  detail?: string
  /** Cap on retained rows per collection, oldest dropped first. */
  maxRows?: Partial<Record<keyof MemoryStoreRows, number>>
}

const CAPS: Record<keyof MemoryStoreRows, number> = {
  conversations: 200,
  messages: 5000,
  memories: 1000,
  agentRuns: 500,
  toolRuns: 5000,
}

export type FileDatabase = DatabaseAdapter & { flush(): Promise<void>; rows(): MemoryStoreRows }

export async function createFileDatabase(directory: string, options: FileDatabaseOptions = {}): Promise<FileDatabase> {
  const rows: MemoryStoreRows = { conversations: [], messages: [], memories: [], agentRuns: [], toolRuns: [] }
  const inner = createMemoryDatabase('file-backed store', rows)

  // The inner store owns all the query logic; this adapter only loads and flushes.
  const load = async () => {
    for (const [key, file] of Object.entries(FILES) as [keyof MemoryStoreRows, string][]) {
      try {
        const content = await readFile(join(directory, file), 'utf8')
        const parsed = JSON.parse(content) as unknown
        if (Array.isArray(parsed)) (rows[key] as unknown[]) = parsed
      } catch {
        /* first run, or a file that could not be read: start empty and say so below */
      }
    }
  }

  let queue: Promise<void> = Promise.resolve()
  let writes = 0
  let lastError: string | null = null

  const trim = () => {
    for (const key of Object.keys(FILES) as (keyof MemoryStoreRows)[]) {
      const cap = options.maxRows?.[key] ?? CAPS[key]
      const list = rows[key] as unknown as { createdAt?: string; updatedAt?: string; id?: string }[]
      // conversations and agent runs are newest-first already; messages and tool runs
      // are append-only, so those keep their tail.
      const keepTail = key === 'messages' || key === 'toolRuns'
      if (list.length > cap) (rows[key] as unknown[]) = keepTail ? list.slice(list.length - cap) : list.slice(0, cap)
    }
  }

  const flush = () => {
    queue = queue.then(async () => {
      try {
        await mkdir(directory, { recursive: true })
        for (const [key, file] of Object.entries(FILES) as [keyof MemoryStoreRows, string][]) {
          const target = join(directory, file)
          const temp = `${target}.${process.pid}.tmp`
          await writeFile(temp, `${JSON.stringify(rows[key], null, 2)}\n`, 'utf8')
          await rename(temp, target)
        }
        writes++
        lastError = null
      } catch (error) {
        lastError = (error as Error)?.message ?? 'write failed'
      }
    })
    return queue
  }

  const persist = async () => {
    trim()
    await flush()
  }

  await load()

  let writable = true
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, '.probe'), 'ok', 'utf8')
  } catch {
    writable = false
  }

  const adapter: FileDatabase = {
    status: (): DatabaseStatus => ({
      driver: 'file',
      configured: writable,
      reachable: writable,
      detail: writable
        ? `${directory} (json files, ${writes} flush(es)${options.detail ? `, ${options.detail}` : ''})`
        : `file store unavailable: ${lastError ?? `directory ${directory} is not writable`}`,
    }),
    ensureSchema: async () => {
      if (!writable) throw new Error(`cannot write to ${directory}`)
      await flush()
    },
    upsertConversation: async (conversation) => {
      await inner.upsertConversation(conversation)
      await persist()
    },
    appendMessage: async (message) => {
      await inner.appendMessage(message)
      await persist()
    },
    recentMessages: (conversationId, limit) => inner.recentMessages(conversationId, limit),
    listConversations: (sessionId, limit) => inner.listConversations(sessionId, limit),
    remember: async (memory) => {
      await inner.remember(memory)
      await persist()
    },
    recallMemories: (sessionId, limit) => inner.recallMemories(sessionId, limit),
    searchMemories: (sessionId, terms, limit) => inner.searchMemories(sessionId, terms, limit),
    expireMemory: async (sessionId, key) => {
      const removed = await inner.expireMemory(sessionId, key)
      if (removed) await persist()
      return removed
    },
    startAgentRun: async (run) => {
      await inner.startAgentRun(run)
      await persist()
    },
    finishAgentRun: async (run) => {
      await inner.finishAgentRun(run)
      await persist()
    },
    recordToolRun: async (run) => {
      await inner.recordToolRun(run)
      await persist()
    },
    flush: () => queue,
    rows: () => rows,
  }

  return adapter
}

