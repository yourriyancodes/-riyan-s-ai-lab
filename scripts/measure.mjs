#!/usr/bin/env node
/**
 * RAVEN measurement harness. Committed because "optimise only what is measurable" (Phase-2 brief,
 * rules 14/15) is impossible to hold to if the measuring script lives in `/tmp` and dies with the
 * sandbox. Everything here reports counts and timings of real work: no synthetic numbers, and no
 * interpretation attached to a latency that could be noise.
 *
 *   node scripts/measure.mjs turns   [--port 3102] [--rounds 3]   live turn latency percentiles
 *   node scripts/measure.mjs phases  [--port 3102] [--rounds 5]   where those milliseconds go
 *   node scripts/measure.mjs micro                                 in-process floors (no server)
 *   node scripts/measure.mjs context                               what each prompt is made of
 *
 * `turns` and `phases` need a running instance (any driver, provider optional) and say so when
 * there is none. `micro` and `context` run against the source and measure the deterministic engine
 * only — they never call a provider, so they are safe to run on a laptop with no credentials.
 *
 * `micro`/`context` import TypeScript, so run them through the repo's loader:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *        --import ./scripts/lib/tsr.mjs scripts/measure.mjs micro
 */
import { connect } from 'node:net'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const argv = process.argv.slice(2)
const command = argv[0] ?? 'turns'
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}
const port = Number(flag('port', 3100))
const rounds = Number(flag('rounds', 3))

/**
 * The phrasings from the Phase-2 brief, kept verbatim because a measurement on invented sentences
 * measures a distribution nobody types. Each entry says what the turn is *supposed* to spend: a
 * model call is the expensive thing, so `calls: 0` is the claim under test, not a preference.
 */
const PROBES = [
  { message: 'what technologies does Riyan use?', expect: 'no model' },
  { message: 'how many projects are in this portfolio', expect: 'no model' },
  { message: 'what is riyan known for', expect: 'no model' },
  { message: 'can you see my screen or run commands?', expect: 'no model' },
  { message: 'who are you', expect: 'no model' },
  { message: 'what are you capable of', expect: 'no model' },
  { message: 'explain what RAG means in simple terms', expect: 'model when configured' },
  { message: 'why did Riyan choose Next.js over plain React for this site', expect: 'model when configured' },
  { message: 'what would you change about the voice pipeline and why', expect: 'model when configured' },
  { message: 'compare the projects and tell me which one is closest to production', expect: 'agent, then model' },
  { message: 'Analyse the retrieval pipeline in this project and recommend what to improve first', expect: 'agent, then model' },
  { message: 'Create a plan for improving Riyan’s AI portfolio.', expect: 'agent, then model' },
]

const listening = (targetPort) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: Number(targetPort) })
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(600, () => done(false))
    socket.once('error', () => done(false))
    socket.once('connect', () => done(true))
  })

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]

const post = async (body) => {
  const started = Date.now()
  const response = await fetch(`http://127.0.0.1:${port}/api/raven`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-raven-session': `measure-${process.pid}-${Math.random().toString(36).slice(2, 8)}` },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  return { ms: Date.now() - started, status: response.status, json }
}

if (command === 'turns' || command === 'phases') {
  if (!(await listening(port))) {
    console.error(`no instance on :${port} — start one first (see RAVEN-BRAIN.md §12). Nothing was measured.`)
    process.exit(1)
  }
  const samples = []
  const perPhase = new Map()
  for (let round = 0; round < rounds; round++) {
    for (const probe of PROBES) {
      const { ms, status, json } = await post({ message: probe.message })
      samples.push({ ms, mode: json.mode, provider: json.provider ?? 'none', status, expect: probe.expect, state: json.state })
      for (const event of json.metadata?.trace ?? []) {
        const entry = perPhase.get(event.phase) ?? { ms: 0, n: 0 }
        entry.ms += event.ms ?? 0
        entry.n += 1
        perPhase.set(event.phase, entry)
      }
      if (command === 'phases') {
        console.log(`${String(ms).padStart(5)}ms  ${String(status)}  ${String(json.mode).padEnd(9)} prov=${String(json.provider ?? 'none').padEnd(18)} verified=${String(json.verified).padEnd(5)} cites=${json.citations?.length ?? 0}  ${probe.message}`)
      }
    }
  }
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
  const byMode = new Map()
  for (const sample of samples) {
    const key = `${sample.mode}/${sample.provider}`
    const entry = byMode.get(key) ?? []
    entry.push(sample.ms)
    byMode.set(key, entry.sort((a, b) => a - b))
  }
  console.log(`\n${samples.length} turns against :${port}`)
  console.log(`  p50 ${percentile(sorted, 0.5)}ms · p95 ${percentile(sorted, 0.95)}ms · max ${sorted[sorted.length - 1]}ms · min ${sorted[0]}ms`)
  console.log(`  (a conversation's first turn pays persistence setup, which is where the tail lives;`)
  console.log(`   these use a fresh session per probe on purpose, so the max is included rather than hidden.)`)
  console.log('\nby engine that answered:')
  for (const [key, list] of [...byMode.entries()].sort()) {
    console.log(`  ${key.padEnd(34)} n=${String(list.length).padStart(3)}  p50 ${percentile(list, 0.5)}ms  p95 ${percentile(list, 0.95)}ms`)
  }
  if (command === 'phases') {
    console.log('\nmean ms per trace phase (what the turn actually spends time on):')
    for (const [phase, entry] of [...perPhase.entries()].sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n)) {
      console.log(`  ${phase.padEnd(22)} n=${String(entry.n).padStart(3)}  mean ${(entry.ms / entry.n).toFixed(2)}ms`)
    }
  }
  process.exit(0)
}

if (command === 'micro') {
  const { classifyIntent } = await import(`${ROOT}/lib/raven/intent.ts`)
  const { searchKnowledge } = await import(`${ROOT}/lib/raven/knowledge/index.ts`)
  const { verifyAnswer } = await import(`${ROOT}/lib/raven/agents/verification.ts`)
  const { createToolRegistry } = await import(`${ROOT}/lib/raven/tools/index.ts`)
  const { ravenConfig } = await import(`${ROOT}/lib/raven/config.ts`)
  const { selectContext } = await import(`${ROOT}/lib/raven/providers/prompt.ts`)
  const config = ravenConfig()
  const time = async (label, iterations, run) => {
    for (let index = 0; index < Math.min(200, iterations); index++) await run(index)
    const started = process.hrtime.bigint()
    for (let index = 0; index < iterations; index++) await run(index)
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
    console.log(`  ${label.padEnd(34)} ${iterations} iterations in ${elapsedMs.toFixed(1)}ms  → ${(elapsedMs / iterations).toFixed(4)} ms each`)
    return elapsedMs / iterations
  }
  console.log('in-process floors (single call, warm, no HTTP, no provider):')
  await time('classifyIntent', 2000, (index) => classifyIntent(PROBES[index % PROBES.length].message))
  await time('searchKnowledge', 2000, (index) => searchKnowledge(PROBES[index % PROBES.length].message, { limit: 8 }))
  const registry = createToolRegistry(undefined, { stepTimeoutMs: 4000 })
  const context = {
    sessionId: 'measure',
    conversationId: 'measure',
    adapter: null,
    agentRunId: null,
    approvedActions: new Set(),
    now: () => new Date().toISOString(),
    config,
  }
  await time('registry.execute(search_knowledge)', 800, (index) => registry.execute({ tool: 'search_knowledge', input: { query: PROBES[index % PROBES.length].message } }, context))
  await time('registry.execute(list_projects)', 800, () => registry.execute({ tool: 'list_projects', input: {} }, context))
  await time('verifyAnswer', 2000, (index) =>
    verifyAnswer({
      answer: 'Riyan uses Python, LangChain and FastAPI across 5 projects.',
      mode: 'knowledge',
      intent: classifyIntent(PROBES[index % PROBES.length].message),
      citations: [{ kind: 'siteConfig', source: 'data/siteConfig.ts', label: 'Projects', quote: 'Python' }],
      runs: [],
      evidenceText: 'Python, LangChain / LlamaIndex, Vector Databases, RAG, FastAPI',
      actions: [],
      provider: null,
      memoryKeys: [],
    }),
  )
  await time('selectContext over 12 candidates', 2000, (index) =>
    selectContext(
      Array.from({ length: 12 }, (_, position) => ({
        source: `source:${position}`,
        priority: position % 3 === 0 ? 1 : position % 3 === 1 ? 2 : 3,
        relevance: 1 - position / 24,
        text: `Sentence ${position} about retrieval ranking and citations, repeated in ${index % 7} variants. ${PROBES[(index + position) % PROBES.length].message}`,
      })),
      4000,
    ),
  )
  console.log('\nThese are the floors, not the turn: a live turn also does persistence, the router,')
  console.log('the composer, the provider request, and the response. Compare with `turns`.')
  process.exit(0)
}

if (command === 'context') {
  const { buildMessages } = await import(`${ROOT}/lib/raven/providers/prompt.ts`)
  const { searchKnowledge } = await import(`${ROOT}/lib/raven/knowledge/index.ts`)
  const { ravenConfig } = await import(`${ROOT}/lib/raven/config.ts`)
  const budget = ravenConfig().limits.contextCharBudget
  console.log(`context budget ${budget} chars — per phrasing, what the packer kept and what it removed:`)
  let total = 0
  let deduped = 0
  let dropped = 0
  for (const probe of PROBES) {
    const hits = searchKnowledge(probe.message, { limit: 8 })
    const built = buildMessages(
      {
        question: probe.message,
        sources: hits,
        citations: hits.map((hit) => hit.citation),
        recentMessages: hits[0] ? [{ role: 'assistant', content: hits[0].body.slice(0, 240) }] : [],
        memories: [],
        task: 'Answer using only the SUPPLIED SOURCES for portfolio facts.',
        requireJson: false,
      },
      budget,
    )
    total += built.messages[0].content.length
    deduped += built.dedupedChars
    dropped += built.droppedCount
    console.log(
      `  ${String(built.messages[0].content.length).padStart(5)} chars  kept=${String(built.manifest.filter((entry) => entry.included).length).padStart(2)}  dropped=${built.droppedCount}  deduped=${String(built.dedupedChars).padStart(4)}  ${probe.message}`,
    )
  }
  console.log(`\ntotal ${total} chars · ${deduped} duplicate chars removed by sentence dedupe · ${dropped} item(s) over budget`)
  console.log('The dedupe number is the whole point of this command: on this corpus a question')
  console.log('retrieves distinct records, so the prompt is the same size it always was, and the')
  console.log('removals happen exactly where records or previous answers repeat themselves. It is')
  console.log('not a byte-saving claim — the manifest is the feature: which block, how many chars,')
  console.log('why it was left out.')
  process.exit(0)
}

console.error(`unknown command "${command}" — expected turns | phases | micro | context`)
process.exit(2)
