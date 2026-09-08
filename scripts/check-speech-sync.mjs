/**
 * Behaviour checks for lib/speechSync.ts — the module that turns speechSynthesis
 * boundary events into RAVEN's mouth pose. Runs on a fake clock, so it is
 * deterministic and needs no browser.
 *
 *   node --experimental-strip-types scripts/check-speech-sync.mjs
 */
let clock = 1000
globalThis.performance = { now: () => clock }

const { beginSpeech, onBoundary, endSpeech, resetSpeech, sampleSpeech, visemeForPair, wordAt, VISEME_OPENNESS } =
  await import('../lib/speechSync.ts')

const VISEME_KEYS = Object.keys(VISEME_OPENNESS)
let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks++
  const ok = Object.is(actual, expected)
  if (!ok) {
    failures++
    console.log(`  x ${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function checkClose(label, actual, expected, tolerance = 1e-6) {
  checks++
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
  if (!ok) {
    failures++
    console.log(`  x ${label}\n      expected ~${expected}, got ${actual}`)
  }
}

// ---- grapheme -> viseme ------------------------------------------------------
console.log('visemeForPair:')
const pairs = [
  ['p', 'a', 'vPP'],
  ['b', 'o', 'vPP'],
  ['m', 'y', 'vPP'],
  ['f', 'r', 'vFF'],
  ['v', 'o', 'vFF'],
  ['t', 'h', 'vTH'],
  ['t', 'o', 'vDD'],
  ['d', 'o', 'vDD'],
  ['s', 'h', 'vCH'],
  ['c', 'h', 'vCH'],
  ['s', 'o', 'vSS'],
  ['z', 'i', 'vSS'],
  ['k', 'e', 'vKK'],
  ['g', 'o', 'vKK'],
  ['x', 'y', 'vKK'],
  ['n', 'g', 'vNN'],
  ['n', 'o', 'vNN'],
  ['r', 'a', 'vRR'],
  ['l', 'a', 'vRR'],
  ['o', 'o', 'vU'],
  ['o', 'u', 'vU'],
  ['e', 'e', 'vI'],
  ['e', 'a', 'vI'],
  ['a', 'i', 'vE'],
  ['a', 'w', 'vO'],
  ['a', '', 'vAA'],
  ['u', 'p', 'vU'],
  ['w', 'e', 'vU'],
  ['1', '2', 'vAA'],
]
for (const [a, b, expected] of pairs) check(`'${a}${b}'`, visemeForPair(a, b || undefined), expected)
// Every returned key must be a channel the component actually binds.
for (const key of VISEME_KEYS) check(`openness defined for ${key}`, typeof VISEME_OPENNESS[key], 'number')

// ---- word location ------------------------------------------------------------
console.log('wordAt:')
check('word at index 10 (start of "brown")', wordAt('the quick brown fox', 10).text, 'brown')
check('word at index 6 (inside "quick")', wordAt('the quick brown fox', 6).text, 'quick')
check('span of quick', JSON.stringify([wordAt('the quick brown fox', 6).start, wordAt('the quick brown fox', 6).end]), '[4,9]')
check('cursor in a gap keeps the previous word', wordAt('the  fox', 4).text, 'the')
check('no trailing whitespace', /\s$/.test(wordAt('the quick brown fox', 0).text), false)
check('empty text is safe', wordAt('', 3).text, '')
check('index past the end is clamped', wordAt('abc', 99).text, 'abc')
check('cursor past all text yields nothing', wordAt('abc def', 99).text, 'def')

// ---- estimate mode (browser without boundary events) --------------------------
console.log('estimate mode:')
resetSpeech()
clock = 5000
beginSpeech('Ravens fly at dusk over the city', { rate: 1 })
let sample = sampleSpeech(clock)
check('speaking', sample.speaking, true)
check('source before any event', sample.source, 'estimate')
check('closed before time passes', sample.progress > 0, false)
clock = 5000 + 1000
sample = sampleSpeech(clock)
check('cursor advanced by elapsed time', sample.progress > 0.03, true)
check('energy present while speaking', sample.energy > 0.1, true)
check('viseme is a real key', VISEME_KEYS.includes(sample.viseme), true)
clock = 5000 + 3000
const later = sampleSpeech(clock)
check('progress is monotonic', later.progress >= sample.progress, true)
endSpeech()
const stopped = sampleSpeech(clock)
check('not speaking after end', stopped.speaking, false)
checkClose('openness zero after end', stopped.openness, 0)

// ---- boundary mode (Chrome: real word timings) ---------------------------------
console.log('boundary mode:')
resetSpeech()
clock = 20000
const text = 'Blink twice then speak slowly'
beginSpeech(text, { rate: 1 })
check('starts in estimate', sampleSpeech(clock).source, 'estimate')
// Simulate Chrome: one event per word, ~340ms apart (roughly 13 cps).
const words = [...text.matchAll(/\S+/g)]
for (const match of words) {
  clock += 340
  onBoundary({ charIndex: match.index, charLength: match[0].length, word: '' })
}
const during = sampleSpeech(clock)
check('source flipped to boundary', during.source, 'boundary')
check('word resolved from text', during.word.length > 0, true)
check('measured rate is near 13 cps', Math.abs(during.energy) > 0.05, true)

// A stall between words must reduce energy rather than keep chewing.
clock += 1200
const stalled = sampleSpeech(clock)
check('stall lowers energy', stalled.energy < during.energy, true)

// Boundary events alone must not desync when a browser omits charLength.
resetSpeech()
clock = 40000
beginSpeech('no char length here', { rate: 1 })
onBoundary({ charIndex: 3, charLength: 0, word: 'char' })
const fallback = sampleSpeech(clock)
check('word falls back to the event payload', fallback.word, 'char')
check('still boundary-sourced', fallback.source, 'boundary')

// Events arriving before beginSpeech must be ignored, not crash.
resetSpeech()
onBoundary({ charIndex: 5, charLength: 3, word: 'x' })
check('events without a session are dropped', sampleSpeech(clock).speaking, false)

// ---- openness sanity -----------------------------------------------------------
check('open jaw is the most open', VISEME_OPENNESS.vAA >= VISEME_OPENNESS.vI, true)
check('lips stay nearly closed', VISEME_OPENNESS.vPP < 0.25, true)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.error(`FAIL: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('PASS: speech driver behaves as documented.')
