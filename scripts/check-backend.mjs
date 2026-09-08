/**
 * RAVEN backend verification: transports, adapters and HTTP routes.
 *
 *   node --experimental-strip-types --import ./scripts/lib/tsr.mjs scripts/check-backend.mjs
 *
 * The point of this file is that none of these paths are mocked in a way that hides
 * their shape. Providers are driven against a real HTTP server on localhost, so the
 * request bodies, headers, status handling, `Retry-After`, malformed JSON and timeouts are
 * exercised over an actual socket. The Supabase adapter is checked the same way. The
 * route handlers are invoked as the Web-standard functions Next will call, so the JSON
 * contract the console depends on is verified rather than assumed.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

process.env.RAVEN_DB_DRIVER = 'memory'
delete process.env.RAVEN_API_KEY
delete process.env.RAVEN_MODEL
delete process.env.RAVEN_PROVIDER
delete process.env.DATABASE_URL
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_DB_KEY
process.env.RAVEN_RATE_MAX = '1000'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

let passed = 0
const failures = []
const check = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL  ${name}\n          ${String(error?.message ?? error).split('\n').slice(0, 6).join('\n          ')}`)
  }
}
const group = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`)

// ---------------------------------------------------------------------------
// A scriptable stand-in for Gemini / an OpenAI-compatible server / PostgREST.
// ---------------------------------------------------------------------------
const received = []
let script = []

const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  const entry = { method: request.method, url: request.url ?? '', headers: request.headers, body }
  received.push(entry)
  const next = script.shift() ?? { status: 200, json: { ok: true } }
  if (next.delay) await new Promise((resolve) => setTimeout(resolve, next.delay))
  if (next.raw !== undefined) {
    response.writeHead(next.status ?? 200, { 'content-type': 'application/json' })
    response.end(next.raw)
    return
  }
  response.writeHead(next.status ?? 200, { 'content-type': 'application/json', ...(next.headers ?? {}) })
  response.end(JSON.stringify(next.json ?? {}))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const noSleep = async () => {}

console.log('\n\u001b[1mRAVEN BACKEND — transports, adapters, routes\u001b[0m')

// ---------------------------------------------------------------------------
group('1. Gemini provider over REST')

const { createGeminiProvider, clearGeminiProbeCache } = await import(`${ROOT}/lib/raven/providers/gemini.ts`)

const gemini = (overrides = {}) =>
  createGeminiProvider({
    apiKey: 'test-key-never-echoed',
    model: 'gemini-2.5-flash',
    baseUrl: base,
    timeoutMs: 1500,
    maxRetries: 2,
    sleep: noSleep,
    ...overrides,
  })

await check('a successful completion is parsed with usage and model named', async () => {
  received.length = 0
  script = [{ status: 200, json: { candidates: [{ content: { parts: [{ text: 'RAG retrieves first, then answers.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 14 } } }]
  const result = await gemini().generate({ messages: [{ role: 'system', content: 'persona' }, { role: 'user', content: 'what is RAG' }] })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'RAG retrieves first, then answers.')
  assert.equal(result.model, 'gemini-2.5-flash')
  assert.equal(result.usage.inputTokens, 120)
  const sent = received[0]
  assert.match(sent.url, /\/v1beta\/models\/gemini-2\.5-flash:generateContent$/)
  assert.equal(sent.headers['x-goog-api-key'], 'test-key-never-echoed', 'the key must travel in a header')
  assert.ok(!sent.url.includes('test-key-never-echoed'), 'the key must never appear in the URL')
  const payload = JSON.parse(sent.body)
  assert.equal(payload.contents[0].role, 'user')
  assert.equal(payload.systemInstruction.parts[0].text, 'persona')
})

await check('rate limiting surfaces as retryAfterMs, not as silence', async () => {
  received.length = 0
  script = [
    { status: 429, json: { error: { message: 'Resource has been exhausted (quota).' } }, headers: { 'retry-after': '7' } },
    { status: 429, json: { error: { message: 'Resource has been exhausted (quota).' } }, headers: { 'retry-after': '7' } },
    { status: 429, json: { error: { message: 'Resource has been exhausted (quota).' } }, headers: { 'retry-after': '7' } },
  ]
  const result = await gemini({ maxRetries: 2 }).generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'rate_limited')
  assert.equal(result.retryAfterMs, 7000)
  assert.match(result.message, /exhausted/)
  assert.equal(received.length, 3, `expected 2 retries, saw ${received.length} requests`)
})

await check('a bad key is reported as unavailable, and not retried', async () => {
  received.length = 0
  script = [{ status: 403, json: { error: { message: 'API key not valid.' } } }]
  const result = await gemini().generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unavailable')
  assert.match(result.message, /key not valid/)
  assert.equal(received.length, 1, 'a 403 must not be retried')
})

await check('a malformed body is bad_response, never a blank answer', async () => {
  script = [{ status: 200, raw: 'not json at all <<>>' }]
  const result = await gemini().generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'bad_response')
})

await check('a hung provider is cut off by the timeout', async () => {
  script = [{ status: 200, json: { candidates: [] }, delay: 900 }]
  const result = await gemini({ timeoutMs: 150, maxRetries: 0 }).generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'timeout')
  assert.ok(result.ms < 1200, `timeout took ${result.ms} ms`)
})

await check('a blocked prompt is reported as refused', async () => {
  script = [{ status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } }]
  const result = await gemini().generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'refused')
  assert.match(result.message, /SAFETY/)
})

await check('transient 5xx is retried once and can succeed', async () => {
  received.length = 0
  script = [{ status: 503, json: { error: { message: 'overloaded' } } }, { status: 200, json: { candidates: [{ content: { parts: [{ text: 'recovered' }] } }] } }]
  const result = await gemini().generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'recovered')
  assert.equal(received.length, 2)
})

await check('probe reports reachability for /api/health', async () => {
  clearGeminiProbeCache()
  script = [{ status: 200, json: { models: [{ name: 'models/gemini-2.5-flash' }] } }]
  const probed = await gemini().probe()
  assert.equal(probed.reachable, true)
  assert.match(probed.detail, /available/)
})

// ---------------------------------------------------------------------------
group('2. OpenAI-compatible provider (the local, zero-cost path)')

const { createOpenAiCompatibleProvider, clearOpenAiProbeCache } = await import(`${ROOT}/lib/raven/providers/openai.ts`)

await check('chat completions parse, and a local server needs no key', async () => {
  received.length = 0
  clearOpenAiProbeCache()
  script = [{ status: 200, json: { choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } } }]
  const provider = createOpenAiCompatibleProvider({ baseUrl: `${base}/v1`, model: 'llama3.1', apiKey: null, timeoutMs: 1500, sleep: noSleep })
  const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }], json: true })
  assert.equal(result.ok, true)
  assert.equal(result.usage.outputTokens, 3)
  assert.equal(received[0].headers.authorization, undefined, 'a keyless local endpoint must not send an auth header')
  assert.match(received[0].url, /\/v1\/chat\/completions$/)
  assert.equal(JSON.parse(received[0].body).response_format.type, 'json_object')
})

await check('json mode can be disabled for servers that reject it', async () => {
  received.length = 0
  script = [{ status: 200, json: { choices: [{ message: { content: 'plain prose' }, finish_reason: 'stop' }] } }]
  const provider = createOpenAiCompatibleProvider({ baseUrl: `${base}/v1`, model: 'phi3', apiKey: 'k', timeoutMs: 1500, supportJsonMode: false, sleep: noSleep })
  const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }], json: true })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'plain prose')
  assert.equal(JSON.parse(received[0].body).response_format, undefined)
  assert.equal(received[0].headers.authorization, 'Bearer k')
})

await check('a length-truncated completion is refused rather than presented as an answer', async () => {
  script = [{ status: 200, json: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } }]
  const provider = createOpenAiCompatibleProvider({ baseUrl: `${base}/v1`, model: 'llama3.1', apiKey: null, timeoutMs: 1500, sleep: noSleep })
  const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'refused')
})

// ---------------------------------------------------------------------------
group('3. Supabase REST adapter over real HTTP')

const { createSupabaseRestDatabase } = await import(`${ROOT}/lib/raven/db/supabaseRest.ts`)

await check('writes go to the right table with upsert semantics', async () => {
  received.length = 0
  script = [{ status: 201, json: [] }, { status: 204, json: [] }, { status: 204, json: [] }]
  const adapter = createSupabaseRestDatabase({ url: base, key: 'test-role-key', timeoutMs: 2000 })
  await adapter.remember({ id: 'r1', sessionId: 'ses-1', key: 'profile.name', value: 'Riyan', importance: 0.9, source: 'explicit', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  assert.match(received[0].url, /^\/rest\/v1\/raven_memories\?on_conflict=session_id,key$/)
  assert.equal(received[0].method, 'POST')
  assert.match(received[0].headers.prefer, /merge-duplicates/)
  assert.equal(JSON.parse(received[0].body)[0].session_id, 'ses-1')
  assert.equal(JSON.parse(received[0].body)[0].importance, 0.9)
})

await check('reads use filters and ordering, and map rows back to camelCase', async () => {
  received.length = 0
  script = [
    { status: 200, json: [{ id: 'm2', conversation_id: 'conv-1', role: 'raven', content: 'second', created_at: '2026-01-01T00:00:02.000Z', mode: 'knowledge', state: 'SPEAKING' }, { id: 'm1', conversation_id: 'conv-1', role: 'user', content: 'first', created_at: '2026-01-01T00:00:01.000Z' }] },
    { status: 200, json: [{ id: 'r1', session_id: 'ses-1', key: 'profile.name', value: 'Riyan', importance: 0.9, source: 'explicit', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }] },
  ]
  const adapter = createSupabaseRestDatabase({ url: base, key: 'k', timeoutMs: 2000 })
  const recent = await adapter.recentMessages('conv-1', 10)
  assert.equal(recent.length, 2)
  assert.equal(recent[0].content, 'first', 'rows must come back oldest-first for prompt building')
  assert.equal(recent[1].mode, 'knowledge')
  assert.equal(recent[0].mode, null)
  assert.match(received[0].url, /conversation_id=eq\.conv-1&order=created_at\.desc/)
  const memories = await adapter.searchMemories('ses-1', ['profile'], 5)
  assert.equal(memories[0].value, 'Riyan')
  assert.match(received[1].url, /or=\(and\(key\.ilike\.\*profile\*.*\)\)/)
})

await check('a missing table is reported with the actionable hint', async () => {
  script = [{ status: 404, json: { error: { message: 'relation "raven_conversations" does not exist' } } }]
  const adapter = createSupabaseRestDatabase({ url: base, key: 'k', timeoutMs: 2000 })
  await assert.rejects(() => adapter.ensureSchema(), /db\/schema\.sql/)
  assert.equal(adapter.status().reachable, false)
})

await check('network failure marks the store unreachable and never throws on status()', async () => {
  const adapter = createSupabaseRestDatabase({ url: 'http://127.0.0.1:1/rest', key: 'k', timeoutMs: 300 })
  await assert.rejects(() => adapter.ensureSchema())
  const status = adapter.status()
  assert.equal(status.reachable, false)
  assert.equal(status.driver, 'postgres-rest')
  assert.match(status.detail, /supabase rest/)
})

// ---------------------------------------------------------------------------
group('4. Driver resolution and graceful degradation')

const { getDatabase, resetDatabaseHandle } = await import(`${ROOT}/lib/raven/db/index.ts`)
const { ravenConfig } = await import(`${ROOT}/lib/raven/config.ts`)

await check('an unreachable DATABASE_URL degrades to the file store with a reason', async () => {
  resetDatabaseHandle()
  process.env.DATABASE_URL = 'postgresql://raven:***@127.0.0.1:9/raven'
  const config = ravenConfig()
  const handle = await getDatabase({ ...config, database: { ...config.database, url: config.database.url, forced: null, dataDir: config.database.dataDir, timeoutMs: 400, restUrl: null, restKey: null } })
  assert.notEqual(handle.driver, 'postgres', 'a dead database must not be reported as the driver')
  assert.ok(handle.notes.length >= 1)
  assert.match(handle.notes.join(' '), /pg|timed out|connect/i)
  assert.equal(typeof handle.adapter.status().reachable, 'boolean')
  delete process.env.DATABASE_URL
  resetDatabaseHandle()
})

await check('the brain still answers while the database is down', async () => {
  const { runBrainTurn } = await import(`${ROOT}/lib/raven/brain.ts`)
  const result = await runBrainTurn({ message: 'what are the focus areas?', sessionId: 'ses-down', conversationId: 'conv-down' })
  assert.equal(result.success, true)
  assert.match(result.response, /RAG|Vision|Agentic|AI/i)
  assert.ok(result.metadata.database.detail.length > 0)
})

// ---------------------------------------------------------------------------
group('5. HTTP routes (the contract the console consumes)')

const ravenRoute = await import(`${ROOT}/app/api/raven/route.ts`)
const healthRoute = await import(`${ROOT}/app/api/health/route.ts`)
const { resetRateLimiter } = await import(`${ROOT}/lib/raven/rateLimit.ts`)

const post = (body, init = {}) =>
  new Request('http://localhost/api/raven', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })

await check('POST /api/raven answers a knowledge question and labels the mode', async () => {
  resetRateLimiter()
  const response = await ravenRoute.POST(post({ message: 'who are you?', conversationId: 'conv-http-1', sessionId: 'ses-http-1' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-raven-mode'), 'knowledge')
  const data = await response.json()
  assert.equal(data.success, true)
  assert.equal(data.mode, 'knowledge')
  assert.equal(data.conversationId, 'conv-http-1')
  assert.equal(data.state, 'SPEAKING')
  assert.ok(Array.isArray(data.citations) && data.citations.length > 0)
  assert.ok(Array.isArray(data.metadata.trace) && data.metadata.trace.length >= 4)
  assert.equal(typeof data.metadata.latencyMs, 'number')
  assert.equal(data.verified, true)
})

await check('a bad conversation id is replaced rather than trusted', async () => {
  resetRateLimiter()
  const response = await ravenRoute.POST(post({ message: 'hello there', conversationId: "../../etc/passwd; DROP TABLE" }))
  const data = await response.json()
  assert.match(data.conversationId, /^conv-[a-z0-9-]+$/)
})

await check('invalid JSON, missing message and empty message are all rejected', async () => {
  resetRateLimiter()
  const broken = await ravenRoute.POST(post('{not json'))
  assert.equal(broken.status, 400)
  const missing = await ravenRoute.POST(post({}))
  assert.equal(missing.status, 422)
  const blank = await ravenRoute.POST(post({ message: '   ' }))
  assert.equal(blank.status, 422, 'a whitespace-only message is a validation failure, not a server error')
  const data = await blank.json()
  assert.equal(data.error.code, 'empty_input')
  assert.equal(data.mode, 'offline')
  assert.equal(data.state, 'OFFLINE')
})

await check('the rate limiter returns 429 with a usable retry-after', async () => {
  resetRateLimiter()
  process.env.RAVEN_RATE_MAX = '2'
  const config = ravenConfig()
  assert.equal(config.limits.rateLimit.maxRequests, 2, 'limit not picked up; config must be resolved per call')
  const first = await ravenRoute.POST(post({ message: 'hello', sessionId: 'ses-rate' }))
  const second = await ravenRoute.POST(post({ message: 'hello', sessionId: 'ses-rate' }))
  const third = await ravenRoute.POST(post({ message: 'hello', sessionId: 'ses-rate' }))
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(third.status, 429)
  const payload = await third.json()
  assert.equal(payload.error.code, 'rate_limited')
  assert.ok(payload.error.retryAfterMs > 0)
  assert.ok(Number(third.headers.get('retry-after')) >= 1)
  delete process.env.RAVEN_RATE_MAX
  resetRateLimiter()
})

await check('GET /api/raven documents the accepted body', async () => {
  const response = await ravenRoute.GET()
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.endpoints.ask, 'POST /api/raven')
  assert.ok(data.acceptedBody.context.approvedActions.includes('tool names'))
})

await check('GET /api/health reports measured capability, never a fake flag', async () => {
  const response = await healthRoute.GET(new Request('http://localhost/api/health?probe=0'))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.providerConfigured, false)
  assert.equal(data.providerReachable, false, 'nothing was probed, so it must not claim reachability')
  assert.equal(data.providerAdapterImplemented, true)
  assert.equal(data.ownerAuthConfigured, false)
  assert.equal(['READY', 'PARTIALLY_READY'].includes(data.status), true)
  assert.equal(data.database.driver, 'memory')
  assert.ok(data.knowledge.documents >= 20)
  assert.ok(data.tools.some((tool) => tool.name === 'search_knowledge' && tool.permission === 'read'))
  assert.ok(data.tools.some((tool) => tool.name === 'remember_fact' && tool.permission === 'action'))
  assert.ok(data.states.includes('THINKING') && data.states.includes('VISION'))
})

await check('a configured key is never echoed by health or the brain', async () => {
  process.env.RAVEN_API_KEY = 'LEAK-CHECK-9f2ac1'
  process.env.RAVEN_MODEL = 'gemini-2.5-flash'
  const response = await healthRoute.GET(new Request('http://localhost/api/health?probe=0'))
  const text = await response.text()
  assert.ok(!text.includes('LEAK-CHECK-9f2ac1'), 'the API key value appeared in the health payload')
  assert.match(text, /"providerKeyPresent": true/)
  delete process.env.RAVEN_API_KEY
  delete process.env.RAVEN_MODEL
})

await check('an oversized message is refused before the brain runs', async () => {
  resetRateLimiter()
  const response = await ravenRoute.POST(post({ message: 'q'.repeat(6000), sessionId: 'ses-big' }))
  assert.equal(response.status, 413)
  const data = await response.json()
  assert.equal(data.error.code, 'too_long')
  assert.ok(!data.response.includes('q'.repeat(50)))
})

await check('voice transcripts and vision context pass through without overclaiming', async () => {
  resetRateLimiter()
  const response = await ravenRoute.POST(
    post({
      message: 'what is on the skills page?',
      inputType: 'voice-transcript',
      context: { visionContext: { facePresent: true, depth: { x: 0.2, y: 0.1 }, source: 'client-camera' } },
      sessionId: 'ses-voice',
    }),
  )
  const data = await response.json()
  assert.equal(data.success, true)
  assert.match(data.metadata.trace.map((entry) => entry.phase).join(' '), /vision-input/)
  assert.ok(!/i can see|i detected|looking at you/i.test(data.response), 'the brain claimed visual perception it does not have')
})

// ---------------------------------------------------------------------------
group('6. No-provider honesty in the prompt layer')

const { buildMessages, extractJsonObject, cleanReply, RAVEN_PERSONA } = await import(`${ROOT}/lib/raven/providers/prompt.ts`)

await check('the prompt forbids invented facts and demands source-only claims', () => {
  assert.match(RAVEN_PERSONA, /Never invent/)
  assert.match(RAVEN_PERSONA, /not in the portfolio/)
  assert.match(RAVEN_PERSONA, /unless the execution record says it happened/)
})

await check('context is budgeted, dropping the least useful parts first', () => {
  const huge = Array.from({ length: 40 }, (unused, index) => ({ id: `d${index}`, title: `Doc ${index}`, body: 'x'.repeat(400), score: 1, tags: [], citation: { kind: 'siteConfig', source: 's', label: 'l' }, matched: [], phraseMatch: false }))
  const built = buildMessages({ question: 'why', sources: huge, citations: [], recentMessages: [], memories: [], task: 'answer briefly' }, 3000)
  assert.ok(built.usedChars <= 3000, `budget blown: ${built.usedChars}`)
  assert.equal(built.truncated, true)
  assert.match(built.messages[0].content, /further source\(s\) trimmed/)
})

await check('JSON extraction survives fences and prose wrappers', () => {
  assert.deepEqual(extractJsonObject('```json\n{"answer":"hi"}\n```'), { answer: 'hi' })
  assert.deepEqual(extractJsonObject('Sure! {"answer":"hi"} hope that helps'), { answer: 'hi' })
  assert.equal(extractJsonObject('no json here'), null)
  assert.equal(cleanReply('RAVEN: hello\n'), 'hello')
})

// ---------------------------------------------------------------------------
server.close()
await once(server, 'close')

const total = passed + failures.length
console.log(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${passed}/${total} checks passed\u001b[0m`)
if (failures.length) {
  for (const failure of failures) console.error(`\n\u001b[31m✗ ${failure.name}\u001b[0m\n${failure.error?.stack ?? failure.error}`)
  process.exit(1)
}
