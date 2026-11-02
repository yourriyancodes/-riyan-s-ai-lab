import test from 'node:test'
import assert from 'node:assert/strict'
import { askRaven, getRavenHealth } from '../../ravenClient.ts'

type Captured = { url: string; init?: RequestInit }

function stubGlobalFetch(response: Response | (() => Promise<never>)): Captured[] {
  const calls: Captured[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return typeof response === 'function' ? response() : response
  }) as unknown as typeof fetch
  // Restore after the test process finishes this module.
  process.once('beforeExit', () => {
    globalThis.fetch = original
  })
  return calls
}

test('browser client sends { input, history } — the body the API reads', async () => {
  const calls = stubGlobalFetch(
    new Response(
      JSON.stringify({
        state: 'SUCCESS',
        output: 'Grounded answer.',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        grounded: true,
        sources: [{ id: 'projects', label: 'Selected work' }],
        trace: ['UNDERSTANDING'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )

  const history = [{ role: 'user' as const, text: 'earlier question' }]
  const response = await askRaven('What projects has Riyan built?', history)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, '/api/raven')
  const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
  assert.equal(body.input, 'What projects has Riyan built?')
  assert.equal('message' in body, false)
  assert.deepEqual(body.history, history)

  assert.equal(response.state, 'SUCCESS')
  if (response.state !== 'SUCCESS') return
  assert.equal(response.output, 'Grounded answer.')
})

test('browser client surfaces API failures instead of inventing text', async () => {
  stubGlobalFetch(
    new Response(JSON.stringify({ state: 'OFFLINE', code: 'RAVEN_OFFLINE', message: 'not connected' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
  )

  const response = await askRaven('hello')
  assert.equal(response.state, 'OFFLINE')
  assert.equal(response.code, 'RAVEN_OFFLINE')
})

test('browser client handles a non-JSON response safely', async () => {
  stubGlobalFetch(new Response('<html>gateway error</html>', { status: 502 }))

  const response = await askRaven('hello')
  assert.equal(response.state, 'ERROR')
  assert.equal(response.code, 'INVALID_RESPONSE')
})

test('health client returns null instead of throwing when the endpoint is down', async () => {
  stubGlobalFetch(() => Promise.reject(new TypeError('fetch failed')))
  assert.equal(await getRavenHealth(), null)
})
