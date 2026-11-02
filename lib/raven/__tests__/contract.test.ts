import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRavenRequest,
  sanitizeHistory,
  RAVEN_MAX_HISTORY_TURNS,
  RAVEN_MAX_INPUT,
} from '../types.ts'

test('accepts the canonical { input } body', () => {
  const parsed = parseRavenRequest({ input: '  what has riyan built?  ' })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.input, 'what has riyan built?')
  assert.deepEqual(parsed.history, [])
})

test('accepts the legacy { message } body so an old bundle still works', () => {
  const parsed = parseRavenRequest({ message: 'hello' })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.input, 'hello')
})

test('rejects missing and blank input', () => {
  for (const body of [{}, { input: '   ' }, { input: 42 }, null, 'text']) {
    const parsed = parseRavenRequest(body)
    assert.equal(parsed.ok, false)
    if (parsed.ok) return
    assert.equal(parsed.code, 'INPUT_REQUIRED')
    assert.equal(parsed.status, 400)
  }
})

test('rejects oversized input', () => {
  const parsed = parseRavenRequest({ input: 'a'.repeat(RAVEN_MAX_INPUT + 1) })
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.equal(parsed.code, 'INPUT_TOO_LONG')
  assert.equal(parsed.status, 413)
})

test('bounds history by turns and drops malformed entries', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', text: `t${i}` }))
  const clean = sanitizeHistory({ input: 'x', history })
  assert.equal(clean.length, RAVEN_MAX_HISTORY_TURNS)
  assert.equal(clean.at(-1)?.text, 't19')

  const messy = sanitizeHistory({
    history: [
      { role: 'user', text: 'keep' },
      { role: 'system', text: 'drop role' },
      { role: 'raven', text: '   ' },
      { role: 'raven', text: 'keep too' },
      'nope',
      null,
    ],
  })
  assert.deepEqual(messy, [
    { role: 'user', text: 'keep' },
    { role: 'raven', text: 'keep too' },
  ])
})

test('bounds history by total characters', () => {
  const history = [
    { role: 'user', text: 'a'.repeat(1500) },
    { role: 'user', text: 'b'.repeat(1500) },
  ]
  const clean = sanitizeHistory({ history })
  assert.equal(clean.length, 1)
  assert.equal(clean[0]?.text.length, 1500)
})
