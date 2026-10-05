/**
 * A local OpenAI-compatible endpoint, for testing the provider path only.
 *
 * WHAT THIS IS: a ~100-line HTTP server that speaks `/v1/models` and `/v1/chat/completions`
 * well enough for `lib/raven/providers/openai.ts` to exercise its real code paths over real
 * sockets — auth rejection, rate limit, server error, hang, malformed body, and a successful
 * completion. It is plumbing, and it is how PATH C in RAVEN-BRAIN.md §11.2 / §12 is proven
 * without a key, a bill, or a GPU.
 *
 * WHAT THIS IS NOT: a model. It has no weights, retrieves nothing, and its "answers" are two
 * fixed sentences. Nothing in this repository treats it as intelligence — the brain would say
 * `mode=genai provider=openai-compatible` here, and that is a statement about *which transport
 * answered*, never a claim that reasoning happened. Do not point a deployment at this file and
 * describe the result as AI. Point `RAVEN_BASE_URL` at Ollama, LM Studio, or a real provider.
 *
 * Usage:
 *   node scripts/local-provider-stub.mjs                # listens on 127.0.0.1:3199
 *   RAVEN_BASE_URL=http://127.0.0.1:3199/v1 \
 *   RAVEN_API_KEY=local-test-key RAVEN_MODEL=stub-1 npm run dev
 *
 * Behaviour switches, driven by the request so a single server can be probed repeatedly:
 *   header  Authorization containing "BADKEY"   → 401 on every route, including /v1/models
 *   message containing "FAIL THE MODEL"          → 500 (the retry + breaker path)
 *   message containing "RATE LIMIT ME"           → 429 with Retry-After: 1
 *   message containing "MAKE IT HANG"             → the socket stays open; the *client's*
 *                                                  RAVEN_TIMEOUT_MS is what ends it
 *   message containing "GIBBERISH INSTEAD"        → 200 with a non-JSON body
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.STUB_PORT ?? 3199)
const HOST = process.env.STUB_HOST ?? '127.0.0.1'

let calls = 0

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => {
    raw += chunk
    // Refuse to build an unbounded string from a request: the brain caps its own bodies, and a
    // test double should not be the thing that runs out of memory.
    if (raw.length > 4_000_000) {
      json(res, 413, { error: { message: 'stub body limit' } })
      req.destroy()
    }
  })
  req.on('end', () => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      if (/BADKEY/.test(String(req.headers.authorization ?? ''))) return json(res, 401, { error: { message: 'Incorrect API key provided.' } })
      return json(res, 200, { object: 'list', data: [{ id: 'stub-1', owned_by: 'local' }] })
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) return json(res, 404, { error: { message: 'no such route' } })

    calls++
    // The prompt as a single string, so the switches can read it. Nothing is stored or echoed
    // back beyond the two canned sentences below.
    let prompt = raw
    try {
      prompt = JSON.stringify(JSON.parse(raw))
    } catch {
      /* leave the text as-is */
    }

    // A real provider rejects a bad key on every route, model list included. Anything less and a
    // health probe would report the endpoint as authorized while every completion kept failing.
    if (/BADKEY/.test(String(req.headers.authorization ?? ''))) return json(res, 401, { error: { message: 'Incorrect API key provided.' } })
    if (/RATE LIMIT ME/i.test(prompt)) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
      return res.end(JSON.stringify({ error: { message: 'Rate limit exceeded. Slow down.' } }))
    }
    if (/FAIL THE MODEL/i.test(prompt)) return json(res, 500, { error: { message: 'upstream exploded' } })
    if (/GIBBERISH INSTEAD/i.test(prompt)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('<html>not json at all</html>')
    }
    if (/MAKE IT HANG/i.test(prompt)) return // deliberately never answers

    // Two sentences, picked by whether the caller's context contained the remembered preference.
    // That is the whole point: it proves *something arrived in the prompt*, which is what the
    // memory-grounding test claims, without pretending to understand either question.
    const sawMemory = /prefer\s+Rust|Rust for CLI/i.test(prompt)
    const content = sawMemory
      ? 'For a CLI that parses and indexes notes, keep the parser separate from the storage layer, stream records rather than buffering them, and expose one command per verb. Rust suits the parser boundary because ownership keeps the streaming borrow checks honest.'
      : 'Riyan built the RAG Knowledge Assistant, which uses hybrid dense-sparse retrieval to answer portfolio questions from retrieved records.'

    console.log(
      `call#${calls} bytes=${raw.length} sawMemory=${sawMemory} model=${(() => {
        try {
          return JSON.parse(raw).model
        } catch {
          return '?'
        }
      })()}`,
    )
    return json(res, 200, {
      id: `chatcmpl-stub-${calls}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'stub-1',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Math.round(prompt.length / 4), completion_tokens: 40, total_tokens: Math.round(prompt.length / 4) + 40 },
    })
  })
})

server.listen(PORT, HOST, () => console.log(`local provider stub (NOT a model) on http://${HOST}:${PORT}/v1`))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
