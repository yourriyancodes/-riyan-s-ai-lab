import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiProvider, ProviderError } from '../gemini.ts'
import { resolveProviderConfig } from '../provider.ts'

type Call = { url: string; init: RequestInit }

function stubFetch(response: Response | (() => Promise<never>)): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (typeof response === 'function') return response()
    return response
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const okBody = {
  candidates: [
    {
      content: { parts: [{ text: 'Riyan builds AI and data systems.' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 12, totalTokenCount: 132 },
  modelVersion: 'gemini-2.5-flash-001',
}

test('posts to the documented generateContent endpoint with the key in a header', async () => {
  const { fetchImpl, calls } = stubFetch(
    new Response(JSON.stringify(okBody), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
  const provider = createGeminiProvider({ apiKey: 'test-key-123', model: 'gemini-2.5-flash', fetchImpl })

  const result = await provider.generate({
    systemInstruction: 'system',
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
  })

  assert.equal(calls.length, 1)
  const call = calls[0]!
  assert.equal(
    call.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  )
  assert.equal(call.init.method, 'POST')
  const headers = call.init.headers as Record<string, string>
  assert.equal(headers['x-goog-api-key'], 'test-key-123')
  assert.equal(headers['content-type'], 'application/json')
  // The credential must never travel in the URL.
  assert.equal(call.url.includes('test-key-123'), false)

  const sent = JSON.parse(String(call.init.body)) as {
    systemInstruction: { parts: { text: string }[] }
    contents: unknown[]
    generationConfig: { maxOutputTokens: number }
  }
  assert.equal(sent.systemInstruction.parts[0]?.text, 'system')
  assert.equal(sent.contents.length, 1)
  assert.equal(sent.generationConfig.maxOutputTokens, 1024)

  assert.equal(result.text, 'Riyan builds AI and data systems.')
  assert.equal(result.usage?.totalTokens, 132)
  assert.equal(result.modelVersion, 'gemini-2.5-flash-001')
})

test('maps authentication failures to PROVIDER_AUTH_ERROR', async () => {
  const { fetchImpl } = stubFetch(
    new Response(JSON.stringify({ error: { code: 401, message: 'API key not valid' } }), { status: 401 }),
  )
  const provider = createGeminiProvider({ apiKey: 'bad', fetchImpl })

  await assert.rejects(
    () => provider.generate({ systemInstruction: 's', contents: [] }),
    (error: unknown) => error instanceof ProviderError && error.code === 'PROVIDER_AUTH_ERROR',
  )
})

test('maps 429 to PROVIDER_RATE_LIMITED and keeps the retry hint', async () => {
  const { fetchImpl } = stubFetch(
    new Response(JSON.stringify({ error: { code: 429, message: 'quota' } }), {
      status: 429,
      headers: { 'retry-after': '30' },
    }),
  )
  const provider = createGeminiProvider({ apiKey: 'k', fetchImpl })

  await assert.rejects(
    () => provider.generate({ systemInstruction: 's', contents: [] }),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === 'PROVIDER_RATE_LIMITED' &&
      error.retryAfterSeconds === 30,
  )
})

test('maps 404 to PROVIDER_MODEL_NOT_FOUND', async () => {
  const { fetchImpl } = stubFetch(new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }))
  const provider = createGeminiProvider({ apiKey: 'k', model: 'nope', fetchImpl })

  await assert.rejects(
    () => provider.generate({ systemInstruction: 's', contents: [] }),
    (error: unknown) => error instanceof ProviderError && error.code === 'PROVIDER_MODEL_NOT_FOUND',
  )
})

test('maps network failures to PROVIDER_UNREACHABLE', async () => {
  const { fetchImpl } = stubFetch(() => Promise.reject(new TypeError('fetch failed')))
  const provider = createGeminiProvider({ apiKey: 'k', fetchImpl })

  await assert.rejects(
    () => provider.generate({ systemInstruction: 's', contents: [] }),
    (error: unknown) => error instanceof ProviderError && error.code === 'PROVIDER_UNREACHABLE',
  )
})

test('rejects an empty candidate instead of returning blank text', async () => {
  const { fetchImpl } = stubFetch(
    new Response(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }), {
      status: 200,
    }),
  )
  const provider = createGeminiProvider({ apiKey: 'k', fetchImpl })

  await assert.rejects(
    () => provider.generate({ systemInstruction: 's', contents: [] }),
    (error: unknown) => error instanceof ProviderError && error.code === 'PROVIDER_BAD_RESPONSE',
  )
})

test('provider resolution fails closed and never invents a key', () => {
  assert.deepEqual(resolveProviderConfig({}), {
    configured: false,
    reason: 'MISSING_API_KEY',
    providerId: 'gemini',
    model: 'gemini-2.5-flash',
  })

  const unsupported = resolveProviderConfig({ RAVEN_PROVIDER: 'openai', RAVEN_API_KEY: 'k' })
  assert.equal(unsupported.configured, false)
  if (unsupported.configured) return
  assert.equal(unsupported.reason, 'UNSUPPORTED_PROVIDER')

  const fromRaven = resolveProviderConfig({ RAVEN_API_KEY: 'k', RAVEN_MODEL: 'gemini-3.1-flash-lite' })
  assert.equal(fromRaven.configured, true)
  if (!fromRaven.configured) return
  assert.equal(fromRaven.keySource, 'RAVEN_API_KEY')
  assert.equal(fromRaven.model, 'gemini-3.1-flash-lite')

  const fromGemini = resolveProviderConfig({ GEMINI_API_KEY: 'k' })
  assert.equal(fromGemini.configured, true)
  if (!fromGemini.configured) return
  assert.equal(fromGemini.keySource, 'GEMINI_API_KEY')
})
