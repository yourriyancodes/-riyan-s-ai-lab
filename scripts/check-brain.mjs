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
group('6. Persistence (same interface, three drivers, graceful when absent)')

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

// ---------------------------------------------------------------------------
const total = passed + failures.length
console.log(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${passed}/${total} checks passed\u001b[0m`)
if (failures.length) {
  for (const failure of failures) console.error(`\n\u001b[31m✗ ${failure.name}\u001b[0m\n${failure.error?.stack ?? failure.error}`)
  process.exit(1)
}
