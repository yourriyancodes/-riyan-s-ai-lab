/**
 * RAVEN brain verification — runs with plain `node`, no model, no database, no network.
 *
 *   node --experimental-strip-types --import ./scripts/lib/tsr.mjs scripts/check-brain.mjs
 *
 * What this suite is actually defending is not "does it print an answer" but the
 * properties that make the brain trustworthy: the state machine cannot claim a phase it
 * skipped, retrieval cannot invent a document, a model cannot ship an unverified claim,
 * actions cannot execute without approval, memory cannot store every message, and a
 * missing provider or database must degrade rather than break.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.RAVEN_DB_DRIVER = 'memory'
delete process.env.RAVEN_API_KEY
delete process.env.RAVEN_MODEL
delete process.env.RAVEN_PROVIDER
delete process.env.DATABASE_URL
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_DB_KEY
process.env.RAVEN_RATE_MAX = '1000'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

let passed = 0
const failures = []

const check = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL  ${name}\n          ${(error?.message ?? String(error)).split('\n').slice(0, 6).join('\n          ')}`)
  }
}

const group = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`)

const {
  RAVEN_STATES,
  allowedNextStates,
  canTransition,
  isRavenState,
  transition,
} = await import(`${ROOT}/lib/raven/states.ts`)
const { classifyIntent } = await import(`${ROOT}/lib/raven/intent.ts`)
const { searchKnowledge, resetKnowledgeIndex, knowledgeDocuments } = await import(`${ROOT}/lib/raven/knowledge/index.ts`)
const { findProject, contact: contactRecord, projects: corpusProjects, lookupGlossary } = await import(`${ROOT}/lib/raven/knowledge/corpus.ts`)
const { createToolRegistry, TOOL_SPECS } = await import(`${ROOT}/lib/raven/tools/index.ts`)
const { validateToolInput, ToolRegistry } = await import(`${ROOT}/lib/raven/tools/registry.ts`)
const { extractMemoryUpdates } = await import(`${ROOT}/lib/raven/memory/extract.ts`)
const { runBrainTurn, resetProviderBreaker, providerBreakerState } = await import(`${ROOT}/lib/raven/brain.ts`)
const { peekDatabaseHandle, resetDatabaseHandle, getDatabase } = await import(`${ROOT}/lib/raven/db/index.ts`)
const { createFileDatabase } = await import(`${ROOT}/lib/raven/db/fileStore.ts`)
const { ravenConfig } = await import(`${ROOT}/lib/raven/config.ts`)
const { normalize } = await import(`${ROOT}/lib/raven/knowledge/search.ts`)

// Shared turn helper: fresh session per call unless one is given.
let turnCounter = 0
const ask = async (message, extra = {}, options = {}) => {
  turnCounter++
  return runBrainTurn(
    {
      message,
      sessionId: extra.sessionId ?? `ses-test-${turnCounter}`,
      conversationId: extra.conversationId ?? `conv-test-${turnCounter}`,
      ...extra,
    },
    options,
  )
}

console.log('\n\u001b[1mRAVEN BRAIN — verification\u001b[0m')

// ---------------------------------------------------------------------------
group('1. State machine (real transitions, not decoration)')

await check('every specified state exists with the exact name', async () => {
  for (const state of ['IDLE', 'LISTENING', 'THINKING', 'REASONING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'OFFLINE', 'ERROR', 'VISION']) {
    assert.ok(RAVEN_STATES.includes(state), `${state} missing from RAVEN_STATES`)
  }
})

await check('the page state list stays a subset (no renamed states)', async () => {
  const source = read('data/siteConfig.ts')
  const block = source.slice(source.indexOf('ravenStates'), source.indexOf('ravenStates') + 900)
  const names = [...block.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1])
  assert.ok(names.length >= 8, 'could not read siteConfig.ravenStates')
  for (const name of names) assert.ok(isRavenState(name), `siteConfig state ${name} is unknown to the brain`)
})

await check('illegal transitions degrade instead of lying', async () => {
  const moved = transition('IDLE', 'SPEAKING')
  assert.notEqual(moved.state, 'SPEAKING', 'IDLE → SPEAKING must not be a legal direct move')
  assert.match(moved.refused ?? '', /not legal/)
})

await check('VERIFYING is only reachable after work, never from LISTENING', async () => {
  assert.equal(canTransition('LISTENING', 'VERIFYING'), false)
  assert.equal(canTransition('EXECUTING', 'VERIFYING'), true)
  assert.equal(canTransition('RESEARCHING', 'VERIFYING'), true)
})

await check('every state can reach IDLE within three moves', async () => {
  for (const start of RAVEN_STATES) {
    let frontier = [start]
    let found = start === 'IDLE'
    for (let depth = 0; depth < 3 && !found; depth++) {
      frontier = frontier.flatMap((state) => allowedNextStates(state))
      found = frontier.includes('IDLE')
    }
    assert.ok(found, `${start} is stranded`)
  }
})

// ---------------------------------------------------------------------------
group('2. Intent classification (deterministic)')

const INTENT_CASES = [
  ['who are you?', 'identity.raven'],
  ['what is RAVEN', 'identity.raven'],
  ['who is Riyan Pasha', 'identity.riyan'],
  ['what projects has he built?', 'portfolio.projects'],
  ['tell me about the RAG Knowledge Assistant', 'portfolio.project'],
  ['what skills does this portfolio claim', 'portfolio.skills'],
  ['how can I contact Riyan', 'portfolio.contact'],
  ['what is he currently experimenting with', 'portfolio.experiments'],
  ['explain what RAG means in simple terms', 'explain.concept'],
  ['which project best demonstrates retrieval', 'compare.evaluate'],
  ['help me plan a roadmap to learn this', 'plan.multistep'],
  ['remember that my favourite language is TypeScript', 'memory.remember'],
  ['what do you remember about me?', 'memory.recall'],
  ['scroll to the projects section', 'action.navigate'],
  ['is the database online', 'capability.probe'],
  ['hi', 'greeting'],
  ['asdkjhasd zxcv qwer zxcvb', 'unknown'],
]

await check('each phrasing lands on the expected intent', async () => {
  for (const [message, expected] of INTENT_CASES) {
    const actual = classifyIntent(message).intent
    assert.equal(actual, expected, `"${message}" → ${actual}, expected ${expected}`)
  }
})

await check('a named project is extracted as an entity', async () => {
  const match = classifyIntent('what is the sign language detector doing')
  assert.equal(match.intent, 'portfolio.project')
  assert.match(String(match.entities.project), /Sign Language/i)
})

await check('confidence stays low when nothing matched', async () => {
  assert.ok(classifyIntent('asdkjhasd zxcv qwer zxcvb').confidence < 0.2)
  assert.ok(classifyIntent('who are you').confidence > 0.6)
})

// ---------------------------------------------------------------------------
group('3. Knowledge layer (grounded in this repository)')

await check('project questions retrieve project documents', async () => {
  const hits = searchKnowledge('sign language detector computer vision', { limit: 3 })
  assert.ok(hits.length, 'expected at least one hit')
  assert.ok(hits.some((hit) => hit.id.includes('project')), `no project in ${hits.map((hit) => hit.id).join(', ')}`)
})

await check('a full phrase match outranks a partial one', async () => {
  const exact = searchKnowledge('RAG Knowledge Assistant')
  assert.ok(exact[0] && exact[0].phraseMatch, 'expected the exact-phrase document to rank first')
})

await check('unrelated queries return nothing rather than something plausible', async () => {
  assert.equal(searchKnowledge('how do I recalibrate a carburettor on a 1972 lambretta').length, 0)
})

await check('every skill and focus area on the page is retrievable (drift guard)', async () => {
  const graph = read('components/NeuralGraph.tsx')
  const names = [...graph.slice(graph.indexOf('SKILL_NODES'), graph.indexOf('SKILL_NODES') + 3000).matchAll(/name: '([^']{3,40})'/g)].map((match) => match[1])
  assert.ok(names.length >= 6, `only found ${names.length} skill nodes in NeuralGraph.tsx`)
  for (const name of names) {
    const hits = searchKnowledge(name, { limit: 4 })
    assert.ok(hits.some((hit) => normalize(hit.body + hit.title).includes(normalize(name))), `skill "${name}" is not retrievable from the corpus`)
  }
})

await check('every project detail in the modal is retrievable (drift guard)', async () => {
  const modal = read('components/ProjectDetailModal.tsx')
  const overview = [...modal.matchAll(/overview:\s*'([^']{20,200})'/g)].map((match) => match[1])
  assert.ok(overview.length >= 3, `only ${overview.length} overview strings parsed`)
  for (const text of overview) {
    const words = normalize(text).split(' ').filter((word) => word.length > 5).slice(0, 5)
    const hits = searchKnowledge(words.join(' '), { limit: 4 })
    assert.ok(hits.length, `no retrieval for project overview fragment: ${text.slice(0, 40)}…`)
  }
})

await check('the focus constellation on the page is retrievable (drift guard)', async () => {
  const page = read('app/page.tsx')
  const start = page.indexOf('FOCUS')
  const entries = [...page.slice(start, start + 2000).matchAll(/'([A-Za-z][A-Za-z /+&-]{3,40})'/g)].map((match) => match[1]).filter((value) => /[a-z]/.test(value))
  assert.ok(entries.length >= 5, `only parsed ${entries.length} focus entries`)
  const missing = entries.filter((entry) => !knowledgeDocuments.some((doc) => normalize(doc.body + ' ' + doc.keywords + ' ' + doc.title).includes(normalize(entry))))
  assert.deepEqual(missing, [], `focus entries absent from the corpus: ${missing.join(', ')}`)
})

await check('no contact channel is invented when none is published', async () => {
  const output = contactRecord
  assert.equal(typeof output.published, 'boolean')
  if (!output.published) assert.equal(output.links.length, 0)
})

await check('glossary lookup resolves aliases', async () => {
  const entry = lookupGlossary('retrieval augmented generation')
  assert.ok(entry && /retriev/i.test(entry.definition) && entry.aliases.length > 1)
})

// ---------------------------------------------------------------------------
group('4. Tool registry (schemas, limits, timeouts, permissions)')

const registry = createToolRegistry()

await check('every tool has a description, permission and schema', async () => {
  for (const spec of registry.specs()) {
    assert.ok(spec.name && spec.description.length > 24, `${spec.name} is under-documented`)
    assert.ok(['read', 'compute', 'action'].includes(spec.permission), `${spec.name} has a bad permission`)
    assert.equal(typeof spec.parameters, 'object')
  }
  assert.ok(registry.names().length >= 12, 'the registry is too thin to be real')
})

await check('unknown tools and unknown parameters are rejected', async () => {
  const outcome = await registry.execute({ tool: 'drop_database', input: {} }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'rejected')
  assert.match(outcome.error, /not registered/)
  const bad = validateToolInput(registry.describe('search_knowledge'), { query: 'rag', exponent: 4 }, { maxStringChars: 400 })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join(' '), /unknown parameter/)
})

await check('parameter bounds are enforced, not suggested', async () => {
  const tooLong = validateToolInput(registry.describe('search_knowledge'), { query: 'x'.repeat(400) }, { maxStringChars: 240 })
  assert.equal(tooLong.ok, false)
  const outOfRange = validateToolInput(registry.describe('search_knowledge'), { query: 'rag', limit: 99 }, { maxStringChars: 240 })
  assert.equal(outOfRange.ok, false)
  const missing = validateToolInput(registry.describe('get_project'), {}, { maxStringChars: 240 })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join(' '), /missing required/)
})

await check('a hung tool is cut off at its timeout and the turn survives', async () => {
  const sandbox = new ToolRegistry({ defaults: { timeoutMs: 120 } })
  sandbox.register({ name: 'slow', description: 'test tool that never returns in time', permission: 'read', parameters: {} }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 4000))
    return { output: { done: true } }
  })
  const outcome = await sandbox.execute({ tool: 'slow', input: {} }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'timeout')
  assert.ok(outcome.ms < 1500, `timeout reported ${outcome.ms} ms`)
})

await check('oversized output is truncated with an explicit marker', async () => {
  const sandbox = new ToolRegistry({ defaults: { timeoutMs: 500, maxOutputChars: 200 } })
  sandbox.register({ name: 'verbose', description: 'test tool that returns far too much text', permission: 'read', parameters: {} }, () => ({ output: { blob: 'y'.repeat(5000) } }))
  const outcome = await sandbox.execute({ tool: 'verbose', input: {} }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'succeeded')
  assert.equal(outcome.output.truncated, true)
  assert.match(outcome.error, /truncated/)
})

await check('a throwing tool becomes a failed run, never a crashed turn', async () => {
  const sandbox = new ToolRegistry({})
  sandbox.register({ name: 'boom', description: 'test tool that throws on purpose', permission: 'read', parameters: {} }, async () => {
    throw new Error('exploded inside the handler')
  })
  const outcome = await sandbox.execute({ tool: 'boom', input: {} }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.error, /exploded inside the handler/)
})

await check('action tools stay proposed without approval, and report real execution', async () => {
  const context = { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() }
  const denied = await registry.execute({ tool: 'request_navigation', input: { section: 'projects' } }, context)
  assert.equal(denied.status, 'skipped')
  assert.match(denied.error, /approval/)
  const approved = await registry.execute({ tool: 'request_navigation', input: { section: 'projects' } }, { ...context, approvedActions: new Set(['request_navigation']) })
  assert.equal(approved.status, 'succeeded')
  assert.equal(approved.output.approved, true)
  // The server never claims to have scrolled the browser.
  assert.equal(approved.output.executed, false)
})

await check('navigation to a section the page does not define is refused at the schema', async () => {
  const outcome = await registry.execute({ tool: 'request_navigation', input: { section: 'nonexistent' } }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(['request_navigation']), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'rejected')
  assert.match(outcome.error, /must be one of/)
})

await check('a navigation action reports the target the client will resolve', async () => {
  const outcome = await registry.execute({ tool: 'request_navigation', input: { section: 'contact' } }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(['request_navigation']), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'succeeded')
  assert.equal(outcome.output.executed, false)
})

await check('every recorded tool run carries timing and status', async () => {
  const runs = []
  const withSink = createToolRegistry((run) => runs.push(run))
  await withSink.execute({ tool: 'list_projects', input: {} }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: 'run-x', approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].toolName, 'list_projects')
  assert.equal(runs[0].status, 'succeeded')
  assert.equal(typeof runs[0].ms, 'number')
  assert.equal(runs[0].agentRunId, 'run-x')
  assert.ok(runs[0].output.projects.length >= 3)
})

await check('a memory write without any store says so instead of claiming success', async () => {
  const outcome = await registry.execute({ tool: 'remember_fact', input: { key: 'note.x', value: 'y' } }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: ravenConfig() })
  assert.equal(outcome.status, 'succeeded')
  assert.equal(outcome.output.persisted, false)
  assert.match(String(outcome.note ?? outcome.output.reason ?? ''), /nowhere durable|no persistence adapter/)
})

// ---------------------------------------------------------------------------
group('5. Memory policy (extraction, not transcription)')

await check('explicit requests are stored once, with importance', async () => {
  const { updates } = extractMemoryUpdates({ message: 'remember that my favourite language is TypeScript', intent: 'memory.remember' })
  assert.equal(updates.length, 1, `expected one write, got ${updates.map((update) => update.key).join(', ')}`)
  assert.equal(updates[0].key, 'preference.favourite_language')
  assert.equal(updates[0].value, 'TypeScript')
  assert.ok(updates[0].importance >= 0.7)
  assert.match(updates[0].reason, /explicit-remember/)
})

await check('a non-preference fact keeps a note key', async () => {
  const { updates } = extractMemoryUpdates({ message: 'remember that my target exam is in December', intent: 'memory.remember' })
  assert.equal(updates.length, 1)
  assert.match(updates[0].key, /^note\./)
})

await check('small talk and questions are never stored', async () => {
  for (const message of ['hi there', 'what is the weather like?', 'thanks!', 'ok cool']) {
    const { updates } = extractMemoryUpdates({ message, intent: 'unknown' })
    assert.equal(updates.length, 0, `"${message}" should not have produced a memory`)
  }
})

await check('a preference statement is captured but capped in size', async () => {
  const { updates } = extractMemoryUpdates({ message: 'my favorite framework to build with is React and I also like Svelte a lot', intent: 'memory.remember' })
  assert.equal(updates.length, 1)
  assert.ok(updates[0].value.length <= 220)
})

await check('forget requests become expire operations', async () => {
  const { updates } = extractMemoryUpdates({ message: 'please forget my favorite framework', intent: 'memory.remember' })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].op, 'expire')
})

// ---------------------------------------------------------------------------
group('6. Persistence (one interface, every driver, graceful when absent)')

await check('in-process store keeps conversation and memories', async () => {
  resetDatabaseHandle()
  const handle = await getDatabase()
  assert.equal(handle.driver, 'memory')
  const adapter = handle.adapter
  await adapter.upsertConversation({ id: 'conv-a', sessionId: 'ses-a', title: 't', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  await adapter.appendMessage({ id: 'm1', conversationId: 'conv-a', role: 'user', content: 'hello', mode: null, state: 'LISTENING', createdAt: '2026-01-01T00:00:01.000Z' })
  await adapter.remember({ id: 'r1', sessionId: 'ses-a', key: 'preference.ts', value: 'TypeScript', importance: 0.8, source: 'explicit', createdAt: '2026-01-01T00:00:02.000Z', updatedAt: '2026-01-01T00:00:02.000Z' })
  assert.equal((await adapter.recentMessages('conv-a', 10)).length, 1)
  assert.equal((await adapter.searchMemories('ses-a', ['typescript'], 5))[0].value, 'TypeScript')
  assert.equal(await adapter.expireMemory('ses-a', 'preference.ts'), true)
  assert.equal((await adapter.recallMemories('ses-a', 5)).length, 0)
})

await check('a file store survives a simulated restart of the process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raven-brain-'))
  const first = await createFileDatabase(join(directory, 'data'))
  await first.remember({ id: 'r1', sessionId: 'ses-file', key: 'profile.name', value: 'Riyan', importance: 0.9, source: 'explicit', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  await first.appendMessage({ id: 'm1', conversationId: 'conv-file', role: 'raven', content: 'stored before restart', mode: 'knowledge', state: 'SPEAKING', createdAt: new Date().toISOString() })
  await first.flush()
  const files = await readdir(join(directory, 'data'))
  assert.ok(files.includes('memories.json'), `expected memories.json, saw ${files.join(', ')}`)
  const reopened = await createFileDatabase(join(directory, 'data'))
  const memories = await reopened.recallMemories('ses-file', 5)
  assert.equal(memories.length, 1, 'memory did not survive the reopen')
  assert.equal(memories[0].value, 'Riyan')
  assert.equal((await reopened.recentMessages('conv-file', 5))[0].content, 'stored before restart')
  const raw = JSON.parse(await readFile(join(directory, 'data', 'messages.json'), 'utf8'))
  assert.equal(raw[0].role, 'raven')
  await rm(directory, { recursive: true, force: true })
})

await check('no DATABASE_URL means no postgres attempt and no crash', async () => {
  resetDatabaseHandle()
  const handle = await getDatabase({ ...ravenConfig(), database: { ...ravenConfig().database, url: null, forced: 'postgres' } })
  assert.notEqual(handle.driver, 'postgres')
  assert.ok(handle.notes.length >= 1, 'a forced postgres attempt must record why it fell back')
  assert.match(handle.notes.join(' '), /DATABASE_URL|pg|not set/)
})

await check('postgres adapter binds parameters and never interpolates input', async () => {
  const executed = []
  const client = {
    async query(sql, params = []) {
      executed.push({ sql, params })
      return { rows: [], rowCount: 0 }
    },
  }
  const { createPostgresDatabase } = await import(`${ROOT}/lib/raven/db/postgres.ts`)
  const adapter = createPostgresDatabase(client, { ensureSchema: true })
  const hostile = "Robert'); DROP TABLE raven_messages;--"
  await adapter.appendMessage({ id: 'm1', conversationId: 'conv-x', role: 'user', content: hostile, mode: 'knowledge', state: 'SPEAKING', createdAt: '2026-01-01T00:00:00.000Z' })
  await adapter.remember({ id: 'r1', sessionId: 'ses-x', key: 'note.x', value: hostile, importance: 0.5, source: 'extracted', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  const inserts = executed.filter((entry) => entry.sql.trim().startsWith('INSERT'))
  assert.ok(inserts.length >= 2, 'expected two inserts')
  for (const entry of inserts) {
    assert.ok(!entry.sql.includes(hostile), 'user input was interpolated into SQL text')
    assert.ok(entry.params.includes(hostile), 'user input was not bound as a parameter')
    assert.match(entry.sql, /\$1/)
  }
  assert.match(executed[0].sql, /CREATE TABLE IF NOT EXISTS raven_conversations/)
  assert.match(inserts[1].sql, /ON CONFLICT \(session_id, key\) DO UPDATE/)
})

await check('agent runs and tool runs are recorded as real rows', async () => {
  resetDatabaseHandle()
  const handle = await getDatabase()
  const before = handle.adapter.rows().agentRuns.length
  const result = await ask('what projects has riyan built?')
  assert.equal(result.success, true)
  const rows = handle.adapter.rows()
  assert.equal(rows.agentRuns.length, before + 1, 'no agent_run was written')
  const run = rows.agentRuns[0]
  assert.equal(run.conversationId, result.conversationId)
  assert.ok(run.steps.length > 0, 'agent run recorded no steps')
  assert.ok(run.toolsUsed.length > 0, 'agent run recorded no tools')
  assert.equal(typeof run.verified, 'boolean')
  assert.ok(run.completedAt, 'agent run was never finished')
  assert.ok(rows.toolRuns.length > 0, 'no tool_run rows were written')
  assert.ok(rows.toolRuns.every((entry) => typeof entry.ms === 'number' && typeof entry.status === 'string'))
  assert.equal(result.metadata.agentRunId, run.id, 'the response must point at the row that was written')
})

await check('the file store is what a fresh clone actually gets, and says so', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raven-brain-default-'))
  process.env.RAVEN_DB_DRIVER = ''
  process.env.RAVEN_DATA_DIR = directory
  resetDatabaseHandle()
  const handle = await getDatabase()
  assert.equal(handle.driver, 'file')
  assert.match(handle.adapter.status().detail, /json files/)
  const result = await ask('remember that my favourite stack is Next.js and Postgres')
  assert.equal(result.metadata.database.driver, 'file')
  assert.ok(result.metadata.memory.stored >= 1, 'the memory the user asked for was not stored')
  // Second turn, same session: the fact must come back from disk, not from a cache.
  resetDatabaseHandle()
  const reopened = await getDatabase()
  const memories = await reopened.adapter.recallMemories(`ses-test-${turnCounter}`, 5)
  assert.ok(memories.some((memory) => /next/i.test(memory.value)), 'the stored preference did not survive a fresh handle')
  const conversationId = result.conversationId
  const history = await reopened.adapter.recentMessages(conversationId, 10)
  assert.equal(history.length, 2, 'the turn was not written to the conversation log')
  process.env.RAVEN_DB_DRIVER = 'memory'
  delete process.env.RAVEN_DATA_DIR
  resetDatabaseHandle()
  await rm(directory, { recursive: true, force: true })
})

await check('a memory write that fails on the way to disk is reported as a failure', async () => {
  // The property under test is the one a demo never shows: the answer must not claim to have
  // remembered something the storage engine refused. Patch the cached handle rather than the
  // driver, so the rest of the turn runs against the real adapter.
  const handle = await getDatabase()
  const original = handle.adapter
  handle.adapter = { ...original, remember: async () => { throw new Error('device is read-only') } }
  try {
    const turn = await runBrainTurn({ message: 'Remember that I prefer Rust for command-line tools.', sessionId: 'mem-fail-1' })
    assert.equal(turn.memory.stored, 0, 'the turn claims a write the adapter refused')
    // The honest sentence contains the word "stored" ("Nothing was stored"), so a substring
    // test on that verb proves nothing. What must be absent is a *receipt*.
    assert.match(turn.response, /could not write|did not persist|nothing was stored/i, `the failure was not named: ${turn.response.slice(0, 220)}`)
    assert.doesNotMatch(turn.response, /Stored \d+ item|\bSaved\b|I.?ll remember|noted that/i, `a failed write was announced as a success: ${turn.response.slice(0, 220)}`)
    assert.ok(turn.response.length > 0, 'the failure swallowed the answer entirely')
    assert.notEqual(turn.state, 'ERROR', 'a memory write failure must not fail the whole turn')
    // `persistence` is where the write was attempted; a refusal that skipped it would mean the
    // failure was caught somewhere else and mislabelled as a storage problem.
    assert.ok(turn.metadata.trace.some((event) => /memory|persistence/i.test(event.phase)), 'the trace never reached the persistence phase')
  } finally {
    handle.adapter = original
  }
})

await check('an empty retrieval is admitted, not papered over', async () => {
  const turn = await runBrainTurn({ message: 'What does Riyan think about 17th-century Dutch bulb futures?', sessionId: 'empty-retrieval-1' })
  assert.equal(turn.success, false, 'a question with no evidence in the corpus must not be reported as an answer')
  assert.equal(turn.citations.length, 0, 'a refusal must not arrive wearing the sources it rejected')
  assert.equal(turn.verified, false, 'an answer with no evidence is never verified')
  assert.notEqual(turn.mode, 'genai', 'no provider is configured and no retrieval succeeded')
  assert.equal(turn.mode, 'offline', 'an ungrounded turn is an offline turn')
  // And the near-miss case that used to bluff: the glossary missed, the searcher returned
  // records about the site itself, and the answer claimed the portfolio "does mention" them.
  const nearby = await runBrainTurn({ message: 'How does Riyan configure Kubernetes operators for quantum annealers?', sessionId: 'empty-retrieval-2' })
  assert.equal(nearby.citations.length, 0, 'a term absent from every record still produced citations')
  assert.equal(nearby.verified, false, 'an answer that admits it has no evidence cannot be verified')
  assert.doesNotMatch(nearby.response, /does mention it/i, 'the portfolio was said to mention something it does not')
  assert.match(
    turn.response,
    /don.?t have|do not have|no record|nothing|not (in|covered)|cannot|can.?t|unable|unavailable|outside/i,
    `an empty retrieval was answered as if it were known: ${turn.response.slice(0, 220)}`,
  )
})

// ---------------------------------------------------------------------------
group('7. The brain, end to end, with no provider and no database')

await check('knowledge answers arrive without any AI service', async () => {
  const result = await ask('what projects has riyan built?')
  assert.equal(result.mode, 'knowledge')
  assert.equal(result.success, true)
  assert.equal(result.verified, true)
  assert.equal(result.metadata.provider, null)
  assert.ok(result.citations.length > 0, 'a knowledge answer must cite where it came from')
  assert.match(result.response, /project/i)
  for (const project of corpusProjects.slice(0, 3)) assert.ok(result.response.includes(project.name), `missing ${project.name}`)
})

await check('the trace reflects phases that actually ran, in legal order', async () => {
  const result = await ask('who are you')
  const trace = result.metadata.trace
  const phases = trace.map((entry) => entry.phase)
  for (const phase of ['input', 'intent', 'route', 'retrieval', 'verification', 'compose-response']) {
    assert.ok(phases.includes(phase), `trace is missing the ${phase} phase: ${phases.join(', ')}`)
  }
  const states = trace.map((entry) => entry.state)
  for (let index = 1; index < states.length; index++) {
    assert.ok(canTransition(states[index - 1], states[index]), `illegal ${states[index - 1]} → ${states[index]}`)
  }
  assert.ok(trace.every((entry) => entry.ms >= 0))
  assert.ok(!trace.some((entry) => entry.phase === 'transition-guard'), `the turn needed a state-machine rescue: ${JSON.stringify(trace.map((entry) => entry.state))}`)
  assert.ok(trace.some((entry) => entry.atMs <= result.metadata.latencyMs))
})

await check('no artificial delay is left anywhere in the pipeline', async () => {
  const started = Date.now()
  await ask('what skills does this portfolio claim')
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2500, `a local turn took ${elapsed} ms`)
  const sources = read('lib/raven/agents/knowledge.ts') + read('lib/raven/brain.ts') + read('lib/raven/tools/index.ts')
  assert.ok(!/setTimeout\(\s*\(\)\s*=>\s*resolve\([^)]*\),\s*\d{3,}\s*\)/.test(sources), 'a hard-coded sleep was found in the answer path')
})

await check('an ungroundable question is refused instead of invented', async () => {
  const result = await ask('which cricket world cup final did he watch in 2019?')
  assert.equal(result.mode, 'offline')
  assert.equal(result.success, false)
  assert.equal(result.error.code, 'no_grounding')
  assert.match(result.response, /could not ground/i)
  assert.equal(result.state, 'OFFLINE')
})

await check('contact answers refuse to name a channel that is not published', async () => {
  if (contactRecord.published) {
    const result = await ask('how do I contact Riyan?')
    assert.ok(contactRecord.links.some((link) => result.response.includes(link.url)))
  } else {
    const result = await ask('what is Riyan email address and phone number?')
    assert.ok(!/@/.test(result.response), `an email address appeared: ${result.response}`)
    assert.ok(!/https?:\/\//.test(result.response), 'a URL appeared that the data does not contain')
    assert.equal(result.mode, 'knowledge')
  }
})

await check('oversized and empty inputs are refused cleanly', async () => {
  const empty = await ask('    ')
  assert.equal(empty.success, false)
  assert.equal(empty.error.code, 'empty_input')
  const long = await ask('x'.repeat(5000))
  assert.equal(long.error.code, 'too_long')
  assert.equal(long.mode, 'offline')
  assert.equal(long.state, 'ERROR')
})

await check('a turn that writes memory reports the write it performed', async () => {
  resetDatabaseHandle()
  const result = await ask('remember that my favourite database is Postgres', { sessionId: 'ses-memory-turn' })
  assert.equal(result.memoryUpdates.length >= 1, true)
  assert.ok(result.response.includes('Stored') || result.response.includes('nothing new'), result.response)
  assert.equal(result.actions.some((action) => action.tool === 'remember_fact' && action.status === 'executed'), true, 'no executed action was reported')
  const rows = peekDatabaseHandle().adapter.rows()
  assert.ok(rows.memories.some((memory) => /postgres/i.test(memory.value)))
})

await check('navigation is proposed, and only executed by the client', async () => {
  const result = await ask('scroll to the projects section')
  const action = result.actions.find((entry) => entry.tool === 'request_navigation')
  assert.ok(action, 'no navigation action was proposed')
  assert.equal(action.input.section, 'projects')
  assert.ok(['proposed', 'executed'].includes(action.status), `unexpected status ${action.status}`)
  assert.match(result.response, /projects/i)
})

// ---------------------------------------------------------------------------
group('8. GenAI layer (optional, provider-agnostic, never allowed to bluff)')

const stubProvider = (behaviour) => ({
  id: 'stub',
  label: 'Test stub provider',
  async probe() {
    return { reachable: true, detail: 'stub' }
  },
  async generate(request) {
    behaviour.calls.push(request)
    if (behaviour.mode === 'fail-rate') {
      return { ok: false, provider: 'stub', code: 'rate_limited', message: '429 Too Many Requests', retryAfterMs: 5000, ms: 3 }
    }
    if (behaviour.mode === 'throw') throw new Error('socket hang up')
    const text = behaviour.mode === 'lie' ? 'Riyan worked at Google for 5 years and shipped Project Falcon with 99% accuracy.' : '{"answer":"RAG means retrieving documents first, then answering from them. This portfolio documents a RAG Knowledge Assistant project."}'
    return { ok: true, text, model: 'stub-1', provider: 'stub', usage: { inputChars: 10, outputChars: text.length }, ms: 5 }
  },
})

await check('a configured provider is used for explanation requests', async () => {
  const behaviour = { calls: [], mode: 'json' }
  const result = await ask('explain what RAG means in simple terms', {}, { providerOverride: stubProvider(behaviour) })
  assert.equal(behaviour.calls.length, 1, 'the provider was not called')
  assert.equal(result.mode, 'genai')
  assert.ok(result.metadata.provider, 'the response must say which provider answered')
  assert.equal(result.metadata.provider.model, 'stub-1')
  assert.ok(result.citations.some((citation) => citation.kind === 'provider'))
  // The prompt that was sent must have carried the retrieved evidence, not a bare question.
  const prompt = behaviour.calls[0].messages.map((message) => message.content).join('\n')
  assert.match(prompt, /SUPPLIED SOURCES/)
  assert.match(prompt, /RAG Knowledge Assistant/)
  assert.match(prompt, /never invent/i)
})

await check('an unverifiable model answer is replaced by the grounded one', async () => {
  const behaviour = { calls: [], mode: 'lie' }
  resetProviderBreaker()
  const result = await ask('explain what RAG means in simple terms', {}, { providerOverride: stubProvider(behaviour) })
  assert.notEqual(result.mode, 'genai', `the invented answer was shipped as-is: ${result.response}`)
  assert.ok(!/Google/.test(result.response), 'an invented employer survived verification')
  assert.ok(!/Falcon/.test(result.response), 'an invented project survived verification')
  assert.ok(!/99%/.test(result.response), 'an invented figure survived verification')
  assert.equal(result.metadata.route.degradedFrom, 'genai')
  assert.match(result.metadata.route.degradedBecause, /verification rejected/)
  assert.equal(result.verified, true, 'the local fallback must itself be verified')
})

await check('rate limiting degrades to knowledge and is reported', async () => {
  resetProviderBreaker()
  const behaviour = { calls: [], mode: 'fail-rate' }
  const result = await ask('explain what RAG means in simple terms', {}, { providerOverride: stubProvider(behaviour) })
  assert.ok(['knowledge', 'offline'].includes(result.mode))
  assert.match(result.metadata.route.degradedBecause ?? '', /rate_limited/)
  assert.equal(result.metadata.provider, null, 'a failed provider must not be credited')
  assert.equal(result.success, true, 'a provider failure is a degradation, not a crash')
})

await check('a provider that throws cannot crash the turn', async () => {
  resetProviderBreaker()
  const behaviour = { calls: [], mode: 'throw' }
  const result = await ask('explain what RAG means in simple terms', {}, { providerOverride: stubProvider(behaviour) })
  assert.ok(result.response.length > 10)
  assert.equal(result.mode, 'offline')
  assert.equal(result.error.code, 'internal_error')
})

await check('two failures open the breaker and stop further calls', async () => {
  resetProviderBreaker()
  const behaviour = { calls: [], mode: 'fail-rate' }
  const provider = stubProvider(behaviour)
  await ask('explain what RAG means in simple terms', {}, { providerOverride: provider })
  await ask('explain what RAG means in simple terms', {}, { providerOverride: provider })
  assert.equal(providerBreakerState().open, true, 'the breaker should have opened')
  const callsBefore = behaviour.calls.length
  const result = await ask('explain what RAG means in simple terms', {}, { providerOverride: provider })
  assert.equal(behaviour.calls.length, callsBefore, 'the provider was called while the breaker was open')
  assert.ok(result.response.length > 10)
  assert.match(result.metadata.route.reasons.join(' '), /previously failed/)
  resetProviderBreaker()
})

await check('an open breaker skips the endpoint on agentic turns too', async () => {
  // The router's `genai` gate was not enough on its own: an agentic turn hands its provider straight
  // to the reasoning agent, so an endpoint that had already failed twice was still dialled on every
  // plan. Measured live before the fix: 1.5 s of retries per turn, and 76 s for one turn when the
  // endpoint hung instead of answering. The breaker now holds the handle itself, and the skip is
  // reported rather than hidden.
  resetProviderBreaker()
  const behaviour = { calls: [], mode: 'fail-rate' }
  const provider = stubProvider(behaviour)
  const plan = 'Create a plan for improving Riyan\u2019s AI portfolio.'
  await ask(plan, {}, { providerOverride: provider })
  await ask(plan, {}, { providerOverride: provider })
  assert.equal(providerBreakerState().open, true, 'two provider failures should open the breaker')
  const callsBefore = behaviour.calls.length
  const result = await ask(plan, {}, { providerOverride: provider })
  assert.equal(behaviour.calls.length, callsBefore, 'an agentic turn attempted the endpoint while the breaker was open')
  assert.equal(result.mode, 'agentic', 'the plan must still be answered from tools, not dropped')
  assert.equal(result.success, true, 'a cooldown is a degradation, not a failure')
  assert.equal(result.metadata.provider, null, 'a skipped provider cannot be credited with the answer')
  assert.match(JSON.stringify(result.metadata), /not attempted|cooldown|previously failed|rate_limited/i, 'the skip has to be visible in what the turn reports')
  resetProviderBreaker()
})

await check('agentic mode plans, executes tools, and says who synthesized', async () => {
  const behaviour = { calls: [], mode: 'json' }
  const result = await ask('which project best demonstrates retrieval and why?', { providerOverride: stubProvider(behaviour) })
  assert.equal(result.mode, 'agentic')
  assert.ok(result.metadata.steps >= 2, `only ${result.metadata.steps} step(s) recorded`)
  assert.ok(result.metadata.toolsUsed.includes('list_projects') || result.metadata.toolsUsed.includes('search_knowledge'), result.metadata.toolsUsed.join(','))
  assert.equal(result.metadata.route.usedTools, true)
  assert.ok(result.metadata.toolRuns.length >= 1)
  assert.match(result.response, /retriev|match strength|ranked/i)
})

await check('the agentic path also works with no provider at all', async () => {
  const result = await ask('compare the projects and tell me which one is closest to production')
  assert.equal(result.mode, 'agentic')
  assert.equal(result.metadata.provider, null)
  assert.match(result.response, /no model was involved|no provider/i)
  assert.equal(result.verified, true)
})

// ---------------------------------------------------------------------------
group('9. Contract and hygiene')

await check('the client wire types mirror the server contract', async () => {
  const server = read('lib/raven/types.ts')
  const client = read('lib/ravenClient.ts')
  const grab = (source, name) => {
    const start = source.indexOf(`export type ${name} =`)
    assert.notEqual(start, -1, `${name} not found`)
    const next = source.indexOf('export type', start + 10)
    const slice = source.slice(start, next > start ? next : start + 400)
    return new Set([...slice.matchAll(/'([a-zA-Z._]+)'/g)].map((match) => match[1]))
  }
  const serverModes = grab(server, 'RavenMode')
  const clientModes = grab(client, 'RavenMode')
  assert.deepEqual([...clientModes].sort(), [...serverModes].sort(), 'RavenMode drifted between client and server')
  const serverStates = new Set([...server.slice(server.indexOf('export type RavenState ='), server.indexOf('export type RavenState =') + 900).matchAll(/\| '([A-Z_]+)'/g)].map((match) => match[1]))
  for (const state of RAVEN_STATES) assert.ok(serverStates.has(state), `${state} is not declared in types.ts`)
  const clientStates = new Set([...client.slice(client.indexOf('export type RavenState ='), client.indexOf('export type RavenState =') + 700).matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]))
  for (const state of RAVEN_STATES) assert.ok(clientStates.has(state), `${state} is missing from the client union`)
})

await check('no placeholder or self-congratulating filler in the answer path', async () => {
  const files = ['lib/raven/agents/knowledge.ts', 'lib/raven/brain.ts', 'lib/raven/tools/index.ts', 'data/ravenKnowledge.ts', 'lib/raven/knowledge/corpus.ts']
  for (const file of files) {
    const text = read(file)
    for (const banned of ['TODO', 'FIXME', 'coming soon', 'not implemented', 'lorem ipsum', 'placeholder']) {
      assert.ok(!text.toLowerCase().includes(banned.toLowerCase()), `${file} contains "${banned}"`)
    }
  }
})

await check('the removed fake-delay tool module is really gone', async () => {
  let exists = true
  try {
    read('lib/agentTools.ts')
  } catch {
    exists = false
  }
  assert.equal(exists, false, 'lib/agentTools.ts (naive matcher + fake latency) must be replaced by the brain')
  const store = read('lib/ravenStore.ts')
  assert.ok(!store.includes('agentTools'), 'the store must not fall back to the old matcher')
  assert.ok(!store.includes('setTimeout(') || /settle/.test(store), 'the store should not simulate thinking time')
})

await check('health reports capabilities without leaking credentials', async () => {
  process.env.RAVEN_API_KEY = 'SECRET-DO-NOT-ECHO-1234'
  const { ravenConfig: liveConfig } = await import(`${ROOT}/lib/raven/config.ts`)
  const { describeCapabilities } = await import(`${ROOT}/lib/raven/config.ts`)
  const report = describeCapabilities(liveConfig())
  assert.equal(report.providerConfigured, true)
  assert.ok(!JSON.stringify(report).includes('SECRET-DO-NOT-ECHO'), 'a key value appeared in the capability report')
  assert.ok(!JSON.stringify(liveConfig()).includes('SECRET-DO-NOT-ECHO'), 'ravenConfig() must not hand a key to callers that serialize it')
  assert.equal(report.providerAdapterImplemented, true)
  delete process.env.RAVEN_API_KEY
})

await check('every registered tool is reachable from the planner vocabulary', async () => {
  const planner = read('lib/raven/agents/research.ts')
  const used = new Set([...planner.matchAll(/tool: '([a-z_]+)'/g)].map((match) => match[1]))
  for (const name of used) assert.ok(registry.has(name), `planner references unregistered tool ${name}`)
})

await check('unregistered tools are refused by the planner path too', async () => {
  const result = await runBrainTurn({ message: 'please run read_private_email', sessionId: 'ses-x', conversationId: 'conv-x' })
  assert.notEqual(result.metadata.toolsUsed.indexOf('read_private_email'), 0)
  assert.ok(result.response.length > 0)
})

await check('every turn carries the canonical fields, on both success and refusal', async () => {
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  const required = ['success', 'response', 'reply', 'mode', 'state', 'conversationId', 'citations', 'actions', 'memoryUpdates', 'verified', 'provider', 'trace', 'tools', 'memory', 'degraded']
  const answered = await runBrainTurn({ message: 'What technologies does Riyan use?', sessionId: 'shape-a' })
  for (const key of required) assert.ok(key in answered, `an answered turn is missing ${key}`)
  assert.equal(answered.reply, answered.response, 'reply and response drifted apart')
  assert.equal(answered.provider, 'none', 'a turn with no provider must not name one')
  assert.deepEqual(answered.trace, answered.metadata.trace, 'the hoisted trace is not metadata.trace')
  assert.deepEqual(answered.tools, answered.metadata.toolsUsed, 'the hoisted tool list is not what ran')
  assert.equal(answered.degraded, null, 'a turn that delivered what it planned is not degraded')
  assert.equal(answered.memory.driver, answered.metadata.database.driver, 'memory.driver disagrees with the database block')

  const refused = await runBrainTurn({ message: 'x'.repeat(99999), sessionId: 'shape-b' })
  for (const key of required) assert.ok(key in refused, `a refused turn is missing ${key}`)
  assert.equal(refused.provider, 'none', 'a refusal must still say which provider answered: none')
  // A turn the brain itself refuses still records the phases it entered; what it must not do
  // is invent a provider, a tool run or a memory write while doing so.
  assert.deepEqual(refused.trace, refused.metadata?.trace ?? [], 'a refusal trace disagrees with metadata')
  assert.deepEqual(refused.tools, [], 'a refused turn ran no tools and must not list any')
  assert.equal(refused.memory.stored, 0, 'a refused turn stored nothing and must not claim otherwise')
  assert.equal(refused.verified, false, 'a refusal is never verified')
})

await check('the mode can never claim more than the provider field admits', async () => {
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  const turn = await runBrainTurn({ message: 'Summarise what Riyan built in two sentences.', sessionId: 'claim-a' })
  // Without a provider the router sends this to the local engine; if a provider were
  // configured and answered, `provider` would name it. Either way the pair is the promise.
  if (turn.mode === 'genai') assert.notEqual(turn.provider, 'none', 'mode=genai with provider=none is a bluff')
  else assert.equal(turn.provider, 'none', `mode=${turn.mode} must not report a provider in this environment`)
  if (turn.degraded) assert.notEqual(turn.mode, turn.degraded.from, 'a degraded turn cannot still be in the mode it was degraded from')
  assert.ok(turn.degraded === null || typeof turn.degraded.because === 'string', 'degradation without a reason is not evidence')
})

await check('the brain layer never imports the voice layer', async () => {
  // One authoritative voice is a UI concern; the answer must be identical with TTS present,
  // absent or broken. The cheapest honest guard is the import graph.
  const { readdirSync, readFileSync } = await import('node:fs')
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))
  const offenders = []
  for (const file of walk('lib/raven')) {
    if (!/\.ts$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    if (/ravenVoice|speechSync|speechSynthesis/.test(text)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'the brain reached for the voice layer')
})

await check('voice resolution is deterministic and prefers a configured feminine voice', async () => {
  const { resolveRavenVoice } = await import(`${ROOT}/lib/ravenVoice.ts`)
  const voices = [
    { name: 'Google UK English Male', lang: 'en-GB', localService: true },
    { name: 'Microsoft Zira Online (Natural) - English (United States)', lang: 'en-US', localService: true },
    { name: 'Albert', lang: 'en-GB', localService: true },
  ]
  const first = resolveRavenVoice(voices)
  const second = resolveRavenVoice(voices.slice().reverse())
  assert.equal(first.voice?.name, second.voice?.name, 'the same voices in a different order picked a different voice')
  assert.match(first.voice?.name ?? '', /Zira|Female|Aria|Samantha|Victoria|Karen/i, `picked ${first.voice?.name ?? 'nothing'}, which is not the feminine preference`)
  assert.notEqual(first.source, 'platform-default', 'a platform with usable voices must not fall through to the default')
  const fallback = resolveRavenVoice([{ name: 'Oddity', lang: 'fr-FR', localService: true }])
  assert.ok(fallback.voice === null || typeof fallback.voice.name === 'string', 'the fallback is neither a voice nor an explicit none')
  assert.equal(typeof fallback.source, 'string', 'a fallback must say which rule produced it')
})

// ---------------------------------------------------------------------------
group('11. Concurrency (one process, many turns at once)')

await check('concurrent turns answer their own question and never borrow each other\u2019s evidence', async () => {
  resetDatabaseHandle()
  const questions = [
    { message: 'What technologies does Riyan use?', sessionId: 'ses-c1', conversationId: 'conv-c1' },
    { message: 'What projects has Riyan built?', sessionId: 'ses-c2', conversationId: 'conv-c2' },
    { message: 'Do you have access to my computer?', sessionId: 'ses-c3', conversationId: 'conv-c3' },
  ]
  const results = await Promise.all(questions.map((q) => ask(q.message, q)))
  assert.equal(results.length, 3, 'a concurrent turn never came back')
  for (const result of results) {
    assert.ok((result.response ?? '').trim().length > 20, 'a concurrent turn answered with nothing')
    // A trace is per-turn state. If turns shared a accumulator, this would interleave.
    const at = (result.metadata?.trace ?? []).map((phase) => phase.atMs)
    assert.ok(at.length >= 2, 'no phases recorded for a real turn')
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'a turn\u2019s phase trace arrived out of order')
  }
  const key = (result) => new Set((result.citations ?? []).map((citation) => JSON.stringify(citation)))
  const skillSet = key(results[0])
  const projectSet = key(results[1])
  assert.ok(skillSet.size > 0 && projectSet.size > 0, 'the two knowledge turns cited nothing, so disjointness proves nothing')
  for (const citation of projectSet) assert.ok(!skillSet.has(citation), 'two different questions were answered from the same retrieved record')
  // And the capability probe must not act: no actions, and no claim of access.
  assert.equal(results[2].actions.length, 0, 'a turn claimed an action for the access question')
  assert.match(results[2].response, /no|cannot|can't|not able|don\u2019t have|do not have|never/i, 'the access question was not refused')
})

await check('simultaneous turns on one conversation all reach history, with nothing lost', async () => {
  resetDatabaseHandle()
  const sessionId = 'ses-shared'
  const conversationId = 'conv-shared'
  const messages = [
    'Riyan prefers TypeScript for backend work.',
    'What projects has Riyan built?',
    'Riyan works on data engineering pipelines.',
    'What technologies does Riyan use?',
  ]
  const results = await Promise.all(messages.map((message) => ask(message, { sessionId, conversationId })))
  assert.ok(results.every((result) => (result.response ?? '').trim().length > 0), 'a turn on the shared conversation failed')
  const handle = await getDatabase()
  const history = await handle.adapter.recentMessages(conversationId, 100)
  const users = history.filter((row) => row.role === 'user').map((row) => row.content)
  const ravens = history.filter((row) => row.role === 'raven')
  // Four turns wrote concurrently: every user line must appear exactly once, and there must
  // be a reply for each. A lost write under interleaving would show up here as a short count.
  for (const message of messages) {
    assert.equal(users.filter((content) => content === message).length, 1, `shared history lost or duplicated: ${message.slice(0, 32)}`)
  }
  assert.equal(ravens.length, messages.length, `${ravens.length} replies for ${messages.length} turns on one conversation`)
  assert.equal(history.length, messages.length * 2, 'conversation rows are not user/reply pairs')
  // Both facts the user stated must have been extracted exactly once each, not twice.
  const remembered = await handle.adapter.recallMemories(sessionId, 20)
  const preferenceKeys = remembered.filter((memory) => /preference|profile/i.test(memory.key)).map((memory) => memory.key)
  assert.equal(new Set(preferenceKeys).size, preferenceKeys.length, 'concurrent memory writes duplicated a fact under the same key')
})

await check('the same question twice in a row is answered from retrieval again, not from a cache', async () => {
  resetDatabaseHandle()
  const first = await ask('What projects has Riyan built?', { sessionId: 'ses-dup', conversationId: 'conv-dup' })
  const second = await ask('What projects has Riyan built?', { sessionId: 'ses-dup', conversationId: 'conv-dup' })
  assert.ok(first.metadata.trace.some((phase) => /retriev|knowledge/i.test(phase.phase)), 'the first turn never ran retrieval')
  assert.ok(second.metadata.trace.some((phase) => /retriev|knowledge/i.test(phase.phase)), 'the repeat turn skipped retrieval, which means something is cached')
})

// ---------------------------------------------------------------------------
group('11b. SQLite adapter (a real local database, still zero dependencies)')

const { createSqliteDatabase, sqliteDialect } = await import(`${ROOT}/lib/raven/db/sqlite.ts`)
const { SCHEMA_STATEMENTS: SCHEMA, TABLES: SQL_TABLES } = await import(`${ROOT}/lib/raven/db/schema.ts`)

/** The same script of operations, run against any adapter, returning comparable results. */
const adapterBehaviourScript = async (adapter) => {
  const iso = (offset) => new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString()
  await adapter.upsertConversation({ id: 'c1', sessionId: 's1', title: 'first', createdAt: iso(0), updatedAt: iso(1) })
  await adapter.upsertConversation({ id: 'c1', sessionId: 's1', title: 'renamed', createdAt: iso(0), updatedAt: iso(9) })
  for (const [index, role] of ['user', 'raven', 'user', 'raven'].entries()) {
    await adapter.appendMessage({ id: `m${index}`, conversationId: 'c1', role, content: `turn ${index}`, mode: 'knowledge', state: 'SPEAKING', createdAt: iso(10 + index) })
  }
  // Two rows written in the same millisecond must still come back in insertion order.
  await adapter.appendMessage({ id: 'm-same-a', conversationId: 'c1', role: 'user', content: 'same-ms question', mode: null, state: null, createdAt: iso(40) })
  await adapter.appendMessage({ id: 'm-same-b', conversationId: 'c1', role: 'raven', content: 'same-ms answer', mode: null, state: null, createdAt: iso(40) })
  const now = iso(50)
  await adapter.remember({ id: 'r1', sessionId: 's1', key: 'preference.language', value: 'Rust', importance: 0.9, source: 'explicit', createdAt: now, updatedAt: now })
  await adapter.remember({ id: 'r2', sessionId: 's1', key: 'note.stack', value: 'Next.js and Postgres', importance: 0.4, source: 'extracted', createdAt: now, updatedAt: now })
  await adapter.remember({ id: 'r3', sessionId: 'other', key: 'preference.language', value: 'Elixir', importance: 1, source: 'explicit', createdAt: now, updatedAt: now })
  await adapter.remember({ id: 'r1b', sessionId: 's1', key: 'preference.language', value: 'TypeScript', importance: 0.95, source: 'explicit', createdAt: now, updatedAt: iso(60) })
  const recent = (await adapter.recentMessages('c1', 100)).map((row) => row.id)
  const conversations = await adapter.listConversations('s1', 5)
  const recalled = await adapter.recallMemories('s1', 10)
  const searched = await adapter.searchMemories('s1', ['rust'], 5)
  const searchedStack = await adapter.searchMemories('s1', ['postgres', 'next.js'], 5)
  const expired = await adapter.expireMemory('s1', 'note.stack')
  const missing = await adapter.expireMemory('s1', 'never.existed')
  await adapter.startAgentRun({ id: 'a1', conversationId: 'c1', goal: 'plan it', mode: 'agentic', status: 'running', startedAt: now, completedAt: null, steps: [{ id: 's' }], toolsUsed: ['list_projects'], verified: false, result: '' })
  await adapter.finishAgentRun({ id: 'a1', conversationId: 'c1', goal: 'plan it', mode: 'agentic', status: 'verified', startedAt: now, completedAt: iso(70), steps: [{ id: 's', status: 'ok' }], toolsUsed: ['list_projects', 'get_skills'], verified: true, result: 'done' })
  await adapter.recordToolRun({ id: 't1', agentRunId: 'a1', conversationId: 'c1', toolName: 'list_projects', input: { a: 1 }, output: { count: 5 }, status: 'succeeded', ms: 12, startedAt: now, finishedAt: now })
  return {
    conversations,
    recent,
    remembered: recalled.map((memory) => `${memory.key}=${memory.value}:${memory.importance}`),
    searched: searched.map((memory) => memory.value),
    searchedStack: searchedStack.map((memory) => memory.value),
    expired,
    missing,
  }
}

await check('the SQLite adapter behaves identically to the in-process adapter', async () => {
  const { createMemoryDatabase } = await import(`${ROOT}/lib/raven/db/memoryStore.ts`)
  const sqlite = await createSqliteDatabase({ path: ':memory:' })
  const reference = await adapterBehaviourScript(createMemoryDatabase())
  const actual = await adapterBehaviourScript(sqlite)
  assert.deepEqual(actual, reference, 'the two adapters answer the same script differently')
  sqlite.close()
})

await check('recentMessages comes back oldest-first from every adapter that runs here', async () => {
  // The contract `DatabaseAdapter.recentMessages` documents, and that two consumers read
  // positionally: the prompt builder walks backwards to spend its budget on the newest turns, and
  // the referent resolver takes the *tail* to find what RAVEN just said. The parity check above
  // compares adapters with each other, so a reversal shared by all of them would pass it — this one
  // spells the expected order out, including the same-millisecond pair that needs a tiebreaker.
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createMemoryDatabase } = await import(`${ROOT}/lib/raven/db/memoryStore.ts`)
  const { createFileDatabase } = await import(`${ROOT}/lib/raven/db/fileStore.ts`)
  const expected = ['m0', 'm1', 'm2', 'm3', 'm-same-a', 'm-same-b']
  const directory = await mkdtemp(join(tmpdir(), 'raven-order-'))
  const adapters = [['in-process', createMemoryDatabase()], ['file-backed', await createFileDatabase(directory)], ['sqlite', await createSqliteDatabase({ path: ':memory:' })]]
  for (const [name, adapter] of adapters) {
    const { recent } = await adapterBehaviourScript(adapter)
    assert.deepEqual(recent, expected, `${name} returned the conversation in the wrong order`)
    if ('close' in adapter && typeof adapter.close === 'function') adapter.close()
  }
})

await check('the SQLite schema is derived from the Postgres one, column for column', async () => {
  // The raw handle, not the adapter: this test is about the DDL translation itself, and the
  // adapter deliberately exposes no query surface for a test to lean on.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  const tables = []
  for (const statement of SCHEMA) {
    const table = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]
    if (table) {
      // Build the translated DDL, then read what SQLite actually made of it: comparing the
      // resulting columns is a real parity check, comparing the two texts would not be.
      db.exec(sqliteDialect(statement))
      tables.push(table)
      const postgresColumns = [...statement.matchAll(/^\s*(\w+)\s+(?:text|integer|real|boolean|jsonb|timestamptz)/gm)].map((match) => match[1])
      const sqliteColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
      assert.deepEqual(sqliteColumns, postgresColumns, `${table}: columns drifted from db/schema.ts`)
    } else if (statement.startsWith('CREATE INDEX')) {
      db.exec(sqliteDialect(statement))
    }
  }
  // Expected from TABLES, not a hardcoded number: the day someone adds a table, this test
  // should follow the source of truth instead of failing on a stale count.
  assert.deepEqual(
    tables.slice().sort(),
    Object.values(SQL_TABLES).sort(),
    `translated set is ${tables.join(', ') || 'none'}, but the brain names ${Object.values(SQL_TABLES).join(', ')}`,
  )
  // Every index the Postgres schema declares must exist here too, or the two engines drift
  // apart on the queries that are supposed to be fast.
  const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`).all().map((row) => row.name)
  const declared = SCHEMA.filter((statement) => statement.startsWith('CREATE INDEX')).map((statement) => statement.match(/IF NOT EXISTS (\w+)/)[1])
  assert.ok(declared.length >= tables.length, 'the schema has fewer indexes than tables; nothing is indexed on one of them')
  for (const name of declared) assert.ok(indexes.includes(name), `index ${name} is missing from the SQLite translation`)
  // The four tables are the ones the rest of the brain names, so a rename cannot half-land.
  assert.deepEqual(tables.sort(), Object.values(SQL_TABLES).sort(), 'the table set does not match TABLES')
  db.close()
})

await check('a real file survives close and reopen, which is the point of it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raven-sqlite-'))
  const path = join(directory, 'brain.db')
  const first = await createSqliteDatabase({ path })
  const now = new Date().toISOString()
  await first.remember({ id: 'x1', sessionId: 's', key: 'preference.shell', value: 'fish', importance: 0.8, source: 'explicit', createdAt: now, updatedAt: now })
  await first.upsertConversation({ id: 'c', sessionId: 's', title: 't', createdAt: now, updatedAt: now })
  await first.appendMessage({ id: 'x2', conversationId: 'c', role: 'raven', content: 'stored before restart', mode: 'knowledge', state: 'SPEAKING', createdAt: now })
  first.close()
  const reopened = await createSqliteDatabase({ path })
  const memories = await reopened.recallMemories('s', 5)
  assert.equal(memories[0]?.value, 'fish', 'durable memory did not survive the reopen')
  const history = await reopened.recentMessages('c', 5)
  assert.equal(history[0]?.content, 'stored before restart', 'conversation did not survive the reopen')
  reopened.close()
  await rm(directory, { recursive: true, force: true })
})

await check('a message with no conversation is refused, loudly, not stored as an orphan', async () => {
  const db = await createSqliteDatabase({ path: ':memory:' })
  const now = new Date().toISOString()
  await assert.rejects(
    () => db.appendMessage({ id: 'orphan', conversationId: 'ghost-conv', role: 'user', content: 'nowhere to live', mode: null, state: null, createdAt: now }),
    /does not exist/,
    'the foreign key was either not enforced or reported uselessly',
  )
  assert.deepEqual(await db.recentMessages('ghost-conv', 5), [], 'the rejected row was stored anyway')
  db.close()
})

await check('eight simultaneous writes land as eight rows, in order', async () => {
  const db = await createSqliteDatabase({ path: ':memory:' })
  const now = new Date().toISOString()
  await db.upsertConversation({ id: 'cc', sessionId: 'ss', title: 't', createdAt: now, updatedAt: now })
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      db.appendMessage({ id: `w${index}`, conversationId: 'cc', role: index % 2 ? 'raven' : 'user', content: `write ${index}`, mode: null, state: null, createdAt: now }),
    ),
  )
  const rows = await db.recentMessages('cc', 50)
  assert.equal(rows.length, 8, `${rows.length} of 8 concurrent writes were lost`)
  assert.deepEqual(rows.map((row) => row.content), Array.from({ length: 8 }, (_, index) => `write ${index}`), 'concurrent writes came back out of order')
  db.close()
})

await check('SQL in a stored value is data, not syntax', async () => {
  const db = await createSqliteDatabase({ path: ':memory:' })
  const now = new Date().toISOString()
  // No underscore in the fixture on purpose: this value is later searched for `_`, and a
  // key that already contains one would make that assertion meaningless.
  const hostile = "'); DROP TABLE memories;--"
  await db.remember({ id: 'h1', sessionId: 'sh', key: 'note.' + hostile, value: hostile, importance: 0.5, source: 'extracted', createdAt: now, updatedAt: now })
  const found = await db.recallMemories('sh', 5)
  assert.equal(found[0]?.value, hostile, 'the bound value was altered')
  // `%` and `_` are LIKE wildcards; a term containing them must not match the whole table.
  await db.remember({ id: 'h2', sessionId: 'sh', key: 'other', value: 'percent % signs everywhere', importance: 0.5, source: 'extracted', createdAt: now, updatedAt: now })
  // Escaping is only observable if you pick a term that would match *something else* when
  // unescaped: `_` means "any single character", so an unescaped one returns every row with
  // any character in it, and an escaped one returns only rows containing a literal underscore.
  const underscore = await db.searchMemories('sh', ['_'], 10)
  assert.equal(underscore.length, 0, 'a bare _ was treated as a wildcard and matched rows without one')
  const percent = await db.searchMemories('sh', ['%'], 10)
  assert.deepEqual(percent.map((memory) => memory.key), ['other'], 'a literal % should match only the row that contains one')
  db.close()
})

await check('an unusable SQLite path degrades with a written reason instead of failing boot', async () => {
  resetDatabaseHandle()
  const config = ravenConfig()
  const handle = await getDatabase({
    ...config,
    database: { ...config.database, forced: 'sqlite', sqlitePath: process.platform === 'win32' ? 'Z:\nope\nope.db' : '/dev/null/raven.db' },
  })
  assert.notEqual(handle.driver, 'sqlite', 'an unopenable path must not be reported as the driver')
  assert.ok(handle.notes.join(' ').match(/sqlite/i), 'the downgrade did not say which driver failed and why')
  resetDatabaseHandle()
})

await check('RAVEN_DB_DRIVER accepts every real driver name, including postgres-rest', async () => {
  const previous = process.env.RAVEN_DB_DRIVER
  try {
    for (const driver of ['postgres', 'postgres-rest', 'sqlite', 'file', 'memory']) {
      process.env.RAVEN_DB_DRIVER = driver
      assert.equal(ravenConfig().database.forced, driver, `RAVEN_DB_DRIVER=${driver} was ignored by config`)
    }
    process.env.RAVEN_DB_DRIVER = 'quantum'
    assert.equal(ravenConfig().database.forced, null, 'an unknown driver name must not be forced')
  } finally {
    if (previous === undefined) delete process.env.RAVEN_DB_DRIVER
    else process.env.RAVEN_DB_DRIVER = previous
  }
})

// ---------------------------------------------------------------------------
group('13. Final integration: context, ceilings, and the states a turn may claim')

const { resolveProjectReferent } = await import(`${ROOT}/lib/raven/intent.ts`)
const { planAgentSteps } = await import(`${ROOT}/lib/raven/agents/reasoning.ts`)

await check('the two documented timeout budgets actually bound a turn', async () => {
  // RAVEN_AGENT_STEP_TIMEOUT_MS and RAVEN_AGENT_TURN_TIMEOUT_MS were read out of the environment and
  // then never referenced: the numbers in `.env.example` bound nothing, and anything that stalled
  // held the turn for its own internal budget (measured: 76 s for one plan turn against a hung
  // endpoint). Both budgets are enforced now — the step ceiling clamps even a tool that asked for
  // longer, and the turn ceiling races the agent and answers from what retrieval already returned.
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  const { ToolRegistry } = await import(`${ROOT}/lib/raven/tools/registry.ts`)
  const base = ravenConfig()

  const sandbox = new ToolRegistry({ defaults: { timeoutMs: 4000, maxTimeoutMs: 120 } })
  sandbox.register({ name: 'slow_but_confident', description: 'asks for a timeout the ceiling refuses to grant', permission: 'read', parameters: {}, timeoutMs: 3000 }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    return { output: { said: 'too late' } }
  })
  const outcome = await sandbox.execute({ tool: 'slow_but_confident', input: {} }, { sessionId: 's', conversationId: 'c', adapter: null, agentRunId: null, approvedActions: new Set(), now: () => new Date().toISOString(), config: base })
  assert.equal(outcome.status, 'timeout', `a 3 s tool ran under a 120 ms ceiling: status=${outcome.status}`)
  assert.ok(outcome.ms < 900, `the ceiling was not the bound (ms=${outcome.ms})`)

  const config = { ...base, limits: { ...base.limits, agentStepTimeoutMs: 4000, agentTurnTimeoutMs: 150 } }
  const hungProvider = {
    id: 'hang',
    label: 'Hangs forever',
    probe: async () => ({ reachable: true, detail: 'stub' }),
    generate: () => new Promise(() => {}),
  }
  const started = Date.now()
  const turn = await runBrainTurn({ message: 'Create a plan for improving Riyan\u2019s AI portfolio.', sessionId: `budget-${Date.now()}`, skipPersistence: true }, { config, providerOverride: hungProvider })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2500, `a 150 ms turn budget let the turn run ${elapsed} ms`)
  assert.equal(turn.degraded?.from, 'agentic', `the overrun is not reported (degraded=${JSON.stringify(turn.degraded)})`)
  assert.match(turn.degraded?.because ?? '', /turn budget/i, 'the report has to name which budget ran out')
  assert.ok(turn.response.length > 10, 'a turn that ran out of budget still has to say something')
  // What it says is decided by what retrieval actually returned, and the mode has to follow that
  // rather than the plan: a cited knowledge answer, or an honest refusal with nothing attached.
  if (turn.mode === 'knowledge') assert.ok(turn.citations.length > 0, 'a knowledge answer must arrive with the records it used')
  else {
    assert.equal(turn.mode, 'offline', `an overrun with nothing grounded to say must not report ${turn.mode}`)
    assert.equal(turn.success, false, 'a refusal is not a success')
    assert.equal(turn.citations.length, 0, 'a refusal may not wear the records it did not use')
  }
})

await check('the referent window is counted in answers, not in rows', () => {
  // “And what about the first one?” arrives one turn after the listing, with an unrelated
  // acknowledgement in between. Counting the window in table rows spent two of three slots on that
  // pair and lost the listing, so the ordinal resolved against the wrong answer. The candidates are
  // therefore the last few things RAVEN *said*.
  const turns = [
    { role: 'user', content: 'What projects has Riyan built?' },
    { role: 'raven', content: '5 project(s) on this portfolio: - 01 Akshara Deepa Tutor — a learning system - 03 RAG Knowledge Assistant — retrieval pipeline' },
    { role: 'user', content: 'Which one uses RAG?' },
    { role: 'raven', content: 'RAG Knowledge Assistant (03) — RETRIEVAL / AI, status TESTING.' },
    { role: 'user', content: 'Remember that I benchmark retrieval latency.' },
    { role: 'raven', content: 'Stored 1 item(s) in sqlite persistence: note.benchmark_retrieval_latency.' },
  ]
  const first = resolveProjectReferent('And what about the first one?', turns)
  assert.equal(first?.name, 'Akshara Deepa Tutor', `the ordinal resolved to “${first?.name}” — it lost the listing two turns back`)
  assert.equal(first?.how, 'ordinal', `“the first one” should resolve positionally, got ${first?.how}`)
  // A tie between candidates is not a resolution.
  assert.equal(resolveProjectReferent('it', [{ role: 'raven', content: 'Akshara Deepa Tutor and RAG Knowledge Assistant are both listed.' }]), null)
  // One turn further out, with an unrelated exchange in between, the ordinal still points at the list.
  const later = [
    ...turns,
    { role: 'user', content: 'What is Riyan’s email address?' },
    { role: 'raven', content: 'No contact link or email is published in the portfolio data yet.' },
  ]
  const second = resolveProjectReferent('Now tell me about the second one.', later)
  assert.equal(second?.name, 'RAG Knowledge Assistant', `the listing two answers back was lost: got “${second?.name}”`)
  assert.equal(second?.how, 'ordinal')
  // An ordinal past the end of the list is not a question about this corpus.
  assert.equal(resolveProjectReferent('And the ninth one?', later), null, 'a two-item list cannot have a ninth entry')
})

await check('a follow-up is resolved from the previous answer instead of refused', async () => {
  const sessionId = `ctx-${Date.now()}`
  const conversationId = `conv-${sessionId}`
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  await runBrainTurn({ message: 'What projects has Riyan built?', sessionId, conversationId })
  const follow = await runBrainTurn({ message: 'Which one uses RAG?', sessionId, conversationId })
  assert.equal(follow.metadata.intent, 'portfolio.project', `the follow-up stayed ${follow.metadata.intent}; context was ignored`)
  assert.match(follow.response, /RAG Knowledge Assistant/, `the referent was not carried into the answer: ${follow.response.slice(0, 160)}`)
  assert.ok(follow.citations.length > 0, 'a resolved answer must still cite the record it came from')
  assert.ok(follow.metadata.trace.some((event) => event.phase === 'anaphora'), 'the resolution is invisible in the trace')
  const anaphora = follow.metadata.trace.find((event) => event.phase === 'anaphora')
  assert.match(anaphora.note ?? '', /resolved/i, 'the trace event does not say what it resolved')

  // And the negative half: the same words with no previous answer must NOT invent a subject.
  const cold = await runBrainTurn({ message: 'Which one uses RAG?', sessionId: `cold-${Date.now()}`, conversationId: 'cold-conv' })
  assert.notEqual(cold.metadata.intent, 'portfolio.project', 'a referential question was answered from nothing')
  assert.equal(cold.success, false, 'a follow-up with no antecedent should be an honest refusal')
})

await check('the referent resolver abstains rather than guessing', async () => {
  const recent = [{ role: 'raven', content: '5 project(s) on this portfolio: RAG Knowledge Assistant and Akshara Deepa Tutor.' }]
  assert.equal(resolveProjectReferent('What is the population of Jakarta?', recent), null, 'a self-contained question was rewritten')
  assert.equal(resolveProjectReferent('which one?', []), null, 'a follow-up with no previous answer resolved to something')
  assert.equal(resolveProjectReferent('which one?', [{ role: 'raven', content: 'I have no projects listed here.' }]), null, 'a referent was invented from the corpus rather than the answer')
  const ordinal = resolveProjectReferent('what about the first one?', recent)
  assert.equal(ordinal?.how, 'ordinal', 'an ordinal follow-up was not resolved by position')
  assert.equal(ordinal?.name, 'RAG Knowledge Assistant', 'the first project in the answer is not the first project chosen')
})

await check('a turn that executed nothing cannot claim EXECUTING', async () => {
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  const idle = await runBrainTurn({ message: 'thanks', sessionId: 'exec-none-1' })
  assert.deepEqual(idle.tools, [], 'no tool was expected for a pleasantry')
  assert.equal(idle.metadata.trace.some((event) => event.state === 'EXECUTING'), false, 'EXECUTING was entered with nothing executed')
  assert.equal(idle.metadata.trace.some((event) => event.state === 'VERIFYING' && /\b0 tool run/.test(event.note ?? '')), false, 'VERIFYING claimed a check against zero runs')

  const answered = await runBrainTurn({ message: 'What technologies does Riyan use?', sessionId: 'exec-some-1' })
  assert.ok(answered.tools.length > 0, 'this turn should have run a tool for the comparison to mean anything')
  const executed = answered.metadata.trace.filter((event) => event.state === 'EXECUTING')
  if (executed.length) {
    const outcome = answered.metadata.trace.find((event) => event.phase === 'actions-outcome')
    assert.ok(outcome, 'EXECUTING appeared without a following actions-outcome event')
    assert.match(outcome.note ?? '', /\d+\/\d+ run\(s\) succeeded/, 'the outcome event does not carry counts')
  }
})

await check('every tool is registered, bounded, and cannot touch the machine', async () => {
  // A tool description may legitimately say the *client* executes a scroll; what must not
  // exist is a tool that can touch this machine. So the test looks for capability, not verbs.
  const forbidden = /\bshell\b|child_process|execSync|spawnSync|\bspawn\(|unlinkSync|rmSync|rmdir|writeFileSync|appendFile|node:fs|\bnet\b|\bdbus\b/i
  for (const entry of TOOL_SPECS) {
    const spec = entry.spec
    assert.ok(['read', 'compute', 'action'].includes(spec.permission), `${spec.name} declares permission ${spec.permission}`)
    assert.ok(typeof spec.timeoutMs === 'number' && spec.timeoutMs > 0 && spec.timeoutMs <= 8000, `${spec.name} has no usable timeout`)
    assert.ok(!forbidden.test(`${spec.name} ${spec.description}`), `${spec.name} advertises machine access, which this backend does not have`)
    if (spec.permission === 'action') {
      const touchesThePage = spec.name === 'request_navigation'
      assert.equal(Boolean(spec.requiresApproval), touchesThePage, `${spec.name} has the wrong approval policy`)
    }
  }
  const names = TOOL_SPECS.map((entry) => entry.spec.name)
  // The spec's capability list, by the names this registry actually uses: `get_profile` is its
  // "get_about", and the memory pair is `remember_fact`/`forget_fact` rather than
  // save/recall, because expiring a fact is a different operation from saving one.
  for (const required of ['list_projects', 'get_project', 'get_skills', 'get_profile', 'get_contact', 'search_knowledge', 'recall_memories', 'remember_fact', 'system_status']) {
    assert.ok(names.includes(required), `${required} disappeared from the registry`)
  }
})

await check('a plan is bounded by the step ceiling no matter how it is asked', async () => {
  const limit = ravenConfig().limits.agentMaxSteps
  const monster = 'Plan everything: fetch every project, summarise each skill, rewrite the roadmap, add auth, deploy it, benchmark it, and explain each step in detail.'
  const intent = classifyIntent(monster)
  const plan = planAgentSteps({ intent, message: monster, alreadyRan: new Set() })
  assert.ok(plan.steps.length > 0, 'the planner produced no steps for an explicitly plan-shaped request')
  assert.ok(plan.steps.length <= limit, `the planner emitted ${plan.steps.length} steps against a ceiling of ${limit}`)
  for (const step of plan.steps) {
    assert.equal(typeof step.tool, 'string', 'a plan step without a tool is not executable')
    assert.ok(TOOL_SPECS.some((entry) => entry.spec.name === step.tool), `plan step ${step.tool} is not a registered tool`)
  }
})

await check('a near-miss refusal reports offline, not knowledge', async () => {
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  const turn = await runBrainTurn({ message: 'How does Riyan configure Kubernetes operators for quantum annealers?', sessionId: 'near-miss-1' })
  assert.equal(turn.success, false, 'an ungrounded turn cannot be reported as a success')
  assert.equal(turn.mode, 'offline', `mode was ${turn.mode}: an ungrounded answer must not be called knowledge`)
  assert.equal(turn.state, 'OFFLINE', 'the state has to follow the mode or the UI lights up for nothing')
  assert.equal(turn.citations.length, 0, 'a refusal may not wear the sources it rejected')
  assert.equal(turn.verified, false)
  assert.equal(turn.degraded?.from, 'knowledge', 'the turn should say what it fell back from')
  assert.match(turn.response, /Offline\/local reasoning is active/i, 'item 18: an offline refusal has to say so out loud')
  assert.match(turn.metadata.trace[turn.metadata.trace.length - 1].phase, /no-evidence|offline/i, 'the trace ended somewhere unexpected')
})

await check('every table survives a restart of the process', async () => {
  const { createSqliteDatabase } = await import(`${ROOT}/lib/raven/db/sqlite.ts`)
  const directory = await mkdtemp(join(tmpdir(), 'raven-persist-'))
  const path = join(directory, 'brain.db')
  const now = new Date(0).toISOString()
  const first = await createSqliteDatabase({ path })
  await first.upsertConversation({ id: 'pc', sessionId: 'ps', title: 'a title', createdAt: now, updatedAt: now })
  await first.appendMessage({ id: 'pm', conversationId: 'pc', role: 'raven', content: 'a reply', mode: 'agentic', state: 'SPEAKING', createdAt: now })
  await first.remember({ id: 'pr', sessionId: 'ps', key: 'preference.db', value: 'SQLite', importance: 0.7, source: 'explicit', createdAt: now, updatedAt: now })
  await first.startAgentRun({ id: 'pa', conversationId: 'pc', goal: 'a goal', mode: 'agentic', status: 'running', startedAt: now, completedAt: null, steps: [{ id: '1', action: 'search_knowledge', tool: 'search_knowledge', status: 'ok' }], toolsUsed: ['search_knowledge'], verified: false, result: '' })
  await first.recordToolRun({ id: 'pt', agentRunId: 'pa', conversationId: 'pc', toolName: 'search_knowledge', input: { q: 'x' }, output: { hits: 2 }, status: 'succeeded', ms: 4, startedAt: now, finishedAt: now })
  await first.finishAgentRun({ id: 'pa', conversationId: 'pc', goal: 'a goal', mode: 'agentic', status: 'verified', startedAt: now, completedAt: now, steps: [{ id: '1', action: 'search_knowledge', tool: 'search_knowledge', status: 'ok' }], toolsUsed: ['search_knowledge'], verified: true, result: 'done' })
  first.close()

  const reopened = await createSqliteDatabase({ path })
  const [conversation] = await reopened.listConversations('ps', 5)
  assert.equal(conversation?.title, 'a title', 'conversation did not survive')
  const [message] = await reopened.recentMessages('pc', 5)
  assert.equal(message?.content, 'a reply', 'message did not survive')
  assert.equal(message?.mode, 'agentic', 'per-message mode was lost')
  const [memory] = await reopened.recallMemories('ps', 5)
  assert.equal(memory?.value, 'SQLite', 'memory did not survive')
  // The run audit is the part people forget to persist, and the only thing that can prove a
  // claim after the fact, so it is checked with the same seriousness as the chat rows.
  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(path, { readOnly: true })
  const run = raw.prepare('SELECT status, verified, steps, tools_used FROM raven_agent_runs WHERE id = ?').get('pa')
  assert.equal(run.status, 'verified', 'agent run did not survive its own finish')
  assert.equal(Number(run.verified), 1, 'the verified flag was lost')
  assert.equal(JSON.parse(run.steps)[0].tool, 'search_knowledge', 'the step list did not survive as JSON')
  const toolRun = raw.prepare('SELECT tool_name, status, ms, input FROM raven_tool_runs WHERE id = ?').get('pt')
  assert.deepEqual({ tool: toolRun.tool_name, status: toolRun.status, ms: toolRun.ms }, { tool: 'search_knowledge', status: 'succeeded', ms: 4 }, 'tool run did not survive')
  assert.deepEqual(JSON.parse(toolRun.input), { q: 'x' }, 'tool input JSON did not round-trip')
  raw.close()
  reopened.close()
  await rm(directory, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
group('12. Intent coverage the browser actually exercises')

await check('capability questions reach system_status instead of a pleasantry', async () => {
  for (const message of [
    'Do you have access to my computer?',
    'Can you read my files?',
    'Search the internet for the newest Next.js release.',
    'Do you have internet access?',
  ]) {
    assert.equal(classifyIntent(message).intent, 'capability.probe', `mis-classified: ${message}`)
  }
  const result = await ask('Do you have access to my computer?', { sessionId: 'ses-cap', conversationId: 'conv-cap' })
  assert.ok(result.metadata.toolsUsed.includes('system_status'), 'the capability answer did not come from the measured status tool')
  assert.ok((result.citations ?? []).length > 0, 'a capability answer shipped with no evidence')
  assert.match(result.response, /no|not|cannot|can't|never|only/i, 'the capability answer did not state its limits')
  assert.equal(result.actions.length, 0, 'a capability probe caused an action')
})

await check('a stored preference is actually findable with a natural question', async () => {
  resetDatabaseHandle()
  assert.equal(classifyIntent('What language do I prefer for CLIs?').intent, 'memory.recall', 'recall question never reached the recall intent')
  assert.equal(classifyIntent('What did I just ask you to remember?').intent, 'memory.recall', 'a conversation reference is a recall question')
  assert.equal(classifyIntent('Did I mention a preferred language?').intent, 'memory.recall', 'an anaphoric recall question was missed')
  const sessionId = 'ses-pref'
  const conversationId = 'conv-pref'
  const stored = await ask('Please remember that I prefer Rust for command-line tools.', { sessionId, conversationId })
  assert.ok(stored.memoryUpdates.length > 0, `nothing was stored: ${stored.response.slice(0, 120)}`)
  const recall = await ask('What language do I prefer for CLIs?', { sessionId, conversationId })
  assert.match(recall.response, /Rust/, `the fact was stored but never recalled — answer was: ${recall.response.slice(0, 160)}`)
  assert.ok(recall.metadata.toolsUsed.includes('recall_memories'), 'recall did not read the memory store')
})

await check('short unmatched questions are \u201cunknown\u201d, not silently small-talk', async () => {
  assert.equal(classifyIntent('phone number').intent, 'unknown', 'a two-word question was absorbed as small-talk again')
  assert.equal(classifyIntent('access computer').intent, 'unknown')
  assert.equal(classifyIntent('thanks').intent, 'smalltalk', 'a real pleasantry must still be recognised as one')
  assert.equal(classifyIntent('Thank you!').intent, 'smalltalk')
  const refused = await ask('What is my bank balance?', { sessionId: 'ses-un', conversationId: 'conv-un' })
  assert.equal(refused.success, false, 'an ungroundable question claimed success')
  assert.match(refused.response, /invent|ground/i, 'the refusal did not say it refused to invent')
})

await check('an exclusion phrase (“outside the portfolio”) never gets answered with the list', async () => {
  // Vocabulary scoring alone reads `portfolio` in “tell me something outside the portfolio” and
  // answers an edge-of-knowledge question with a project listing. The guard removes the
  // portfolio-shaped intents, so the turn is classified `unknown` and answered by the same path as
  // any other ungrounded question: retrieval, then a refusal if the corpus has nothing. The
  // suppression is reported in the signals rather than hidden inside the classifier.
  const asked = classifyIntent('Tell me something outside the portfolio knowledge base.')
  assert.equal(asked.intent, 'unknown', 'an outside-the-portfolio request must not become a project list')
  assert.ok(asked.signals.some((sig) => sig.startsWith('suppress:outside-scope')), 'the suppression itself must be visible in the trace')
  assert.equal(asked.entities.unanswerableByCorpus, 'outside-scope', 'the reason has to travel with the turn to the composer')
  // A question about work that does not exist yet is not a question about the records either.
  const future = classifyIntent('Suggest a CLI architecture for my next project.')
  assert.equal(future.intent, 'unknown', 'a design question about a future project must not become a project listing')
  assert.ok(future.signals.some((sig) => sig.startsWith('suppress:hypothetical')), 'the hypothetical demotion must be reported too')
  // Both markers have to change the *answer*, not just the label: with no provider the composer may
  // not fall back to “here are some records that share a word with you”.
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  for (const [message, session] of [['Tell me something outside the portfolio knowledge base.', 'suppress-1'], ['Suggest a CLI architecture for my next project.', 'suppress-2']]) {
    const turn = await runBrainTurn({ message, sessionId: session })
    assert.equal(turn.mode, 'offline', `“${message}” was answered in ${turn.mode} mode`)
    assert.equal(turn.success, false, `“${message}” has nothing grounded to say and must not report success`)
    assert.equal(turn.citations.length, 0, 'a refusal may not wear sources it did not use')
  }
  for (const q of ['What has Riyan built in his portfolio?', 'what skills are on the portfolio page?', 'show me projects beyond the web apps'])
    assert.notEqual(classifyIntent(q).intent, 'unknown', `“${q}” is still answerable and must not be suppressed`)
})

// ---------------------------------------------------------------------------
const total = passed + failures.length
console.log(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${passed}/${total} checks passed\u001b[0m`)
if (failures.length) {
  for (const failure of failures) console.error(`\n\u001b[31m✗ ${failure.name}\u001b[0m\n${failure.error?.stack ?? failure.error}`)
  process.exit(1)
}
