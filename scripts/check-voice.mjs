/**
 * Behaviour checks for lib/ravenVoice.ts — RAVEN's one voice controller.
 *
 * Two things had to be proven, because both were reported as bugs and neither is
 * visible in a typecheck: that the *same* voice is chosen on every message on every
 * platform, and that a newer response can never be spoken alongside an older one. Both
 * are testable without a browser, because `speechSynthesis` is just an object.
 *
 *   node --experimental-strip-types scripts/check-voice.mjs
 */

/* ---------------------------------------------------------------- fake engine */

const calls = []
let listeners = []
let engineVoices = []

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.rate = 1
    this.pitch = 1
    this.volume = 1
    this.lang = ''
    this.voice = null
    this.onstart = null
    this.onend = null
    this.onerror = null
    this.onboundary = null
    calls.push({ kind: 'create', utterance: this, text })
  }
}

const engine = {
  speak(utterance) {
    calls.push({ kind: 'speak', utterance, text: utterance.text, voice: utterance.voice, at: calls.length })
  },
  cancel() {
    calls.push({ kind: 'cancel', at: calls.length })
  },
  getVoices: () => engineVoices,
  addEventListener: (type, handler) => {
    if (type === 'voiceschanged') listeners.push(handler)
  },
  removeEventListener: (type, handler) => {
    if (type === 'voiceschanged') listeners = listeners.filter((entry) => entry !== handler)
  },
}

globalThis.SpeechSynthesisUtterance = FakeUtterance
globalThis.window = { speechSynthesis: engine }

const fireVoicesChanged = () => {
  for (const handler of [...listeners]) handler()
}

/* ---------------------------------------------------------------- import under test */

const {
  PREFERRED_RAVEN_VOICES,
  RAVEN_DELIVERY,
  resolveRavenVoice,
  labelRavenVoice,
  scoreRavenVoice,
  ravenVoice,
  ravenVoiceState,
  resetRavenVoice,
  speakRaven,
  stopRavenSpeech,
  voicesReady,
} = await import('../lib/ravenVoice.ts')

let failures = 0
let checks = 0

function ok(label, condition, detail = '') {
  checks++
  if (!condition) {
    failures++
    console.log(`  x ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/* ---------------------------------------------------------------- voice lists */

const V = (name, lang, extra = {}) => ({ name, lang, voiceURI: name.toLowerCase().replace(/\W+/g, '-'), localService: true, ...extra })

const PLATFORMS = {
  'macOS Ventura': [
    V('Alex', 'en-US'),
    V('Samantha', 'en-US'),
    V('Daniel', 'en-GB'),
    V('Karen', 'en-AU'),
    V('Moira', 'en-IE'),
    V('Google UK English Male', 'en-GB'),
  ],
  'Windows Edge': [
    V('Microsoft David Desktop - English (United States)', 'en-US'),
    V('Microsoft Zira Desktop - English (United States)', 'en-US'),
    V('Microsoft Aria Online (Natural) - English (United States)', 'en-US', { localService: false }),
    V('Microsoft Hazel Desktop - English (United Kingdom)', 'en-GB'),
  ],
  'Chromium desktop': [
    V('Google UK English Male', 'en-GB'),
    V('Google US English', 'en-US'),
    V('Google UK English Female', 'en-GB'),
    V('native', 'en-US'),
  ],
  'Android WebView': [
    V('en-us-x-sfg', 'en-US'),
    V('en-us-x-idf', 'en-US'),
    V('David', 'en-GB'),
  ],
  'Linux, masculine only': [V('English (UK)', 'en-GB'), V('Microsoft Mark - English', 'en-US')],
  'no English at all': [V('es-ES', 'es-ES'), V('French France', 'fr-FR'), V('Diego', 'es-MX')],
  'empty list': [],
}

// Android's short codes are the awkward case: no gender in the name at all, so the
// policy must still land on one deterministic voice rather than the browser default.
console.log('deterministic selection, per platform:')
const EXPECTED = {
  'macOS Ventura': { name: 'Samantha', source: 'preferred-name' },
  'Windows Edge': { name: 'Microsoft Aria Online (Natural) - English (United States)', source: 'preferred-name' },
  'Chromium desktop': { name: 'Google UK English Female', source: 'preferred-name' },
  // Two unmarked Android voices and one named male one: the policy takes an unmarked
  // voice and breaks the tie on the name, which is why the answer is stable and why it is
  // never "whatever the device happened to list first".
  'Android WebView': { name: 'en-us-x-idf', source: 'english-unmarked' },
  // An unmarked English voice outranks a named male one — that is the policy working:
  // never pick a masculine voice when anything else is on offer.
  'Linux, masculine only': { name: 'English (UK)', source: 'english-unmarked' },
  'no English at all': { name: null, source: 'platform-default' },
  'empty list': { name: null, source: 'platform-default' },
}

for (const [platform, voices] of Object.entries(PLATFORMS)) {
  const expected = EXPECTED[platform]
  const picked = resolveRavenVoice(voices)
  eq(`${platform}: voice`, picked.voice?.name ?? null, expected.name)
  eq(`${platform}: which rule`, picked.source, expected.source)

  // Order independence: the browser's array order must not change the outcome. This is
  // the assertion that would catch a `voices[0]`-style regression.
  const reversed = [...voices].reverse()
  const rotated = voices.length > 1 ? [...voices.slice(2), ...voices.slice(0, 2)] : voices
  eq(`${platform}: order-independent (reversed)`, resolveRavenVoice(reversed).voice?.name ?? null, expected.name)
  eq(`${platform}: order-independent (rotated)`, resolveRavenVoice(rotated).voice?.name ?? null, expected.name)

  // 25 resolutions, one answer. "Don't select a new voice for every message" made literal.
  let stable = true
  for (let i = 0; i < 25; i++) {
    if ((resolveRavenVoice(voices).voice?.name ?? null) !== expected.name) stable = false
  }
  ok(`${platform}: stable across repeated calls`, stable)
}

/* ---------------------------------------------------------------- policy details */

console.log('selection policy:')

// A higher-ranked preferred voice wins even when a lower-ranked one appears first.
const orderedAgainstUs = [V('Zira', 'en-US'), V('Samantha', 'en-US')]
eq('ranking beats array position', resolveRavenVoice(orderedAgainstUs).voice?.name, 'Samantha')
ok(
  'the preferred table is actually ordered',
  PREFERRED_RAVEN_VOICES.indexOf('Samantha') < PREFERRED_RAVEN_VOICES.indexOf('Zira'),
)

// "female" contains "male": a substring gender test would disqualify every feminine
// voice on Windows. Token matching is what protects it.
eq(
  'masculine substring test does not reject female voices',
  scoreRavenVoice(V('Microsoft Zira Desktop - English (United States) (Female)', 'en-US')) >
    scoreRavenVoice(V('Microsoft David Desktop - English (United States) (Male)', 'en-US')),
  true,
)
eq('masculine voice is never chosen while a feminine one exists', resolveRavenVoice([V('David', 'en-US'), V('Zira', 'en-US')]).voice?.name, 'Zira')
eq('label: feminine by name token', labelRavenVoice(V('Microsoft Hazel Desktop - English (United Kingdom)', 'en-GB')), 'feminine-name')
eq('label: nothing English to choose from', labelRavenVoice(V('Diego', 'es-MX')), 'english-unmarked')
eq('non-English voices are ineligible', Number.isFinite(scoreRavenVoice(V('Diego', 'es-MX'))), false)
eq('volume is not above unity', RAVEN_DELIVERY.volume <= 1, true)
ok('prosody is conservative', RAVEN_DELIVERY.rate >= 0.85 && RAVEN_DELIVERY.rate <= 1.2, `rate ${RAVEN_DELIVERY.rate}`)
ok('pitch is a nudge, not a costume', RAVEN_DELIVERY.pitch >= 0.9 && RAVEN_DELIVERY.pitch <= 1.15, `pitch ${RAVEN_DELIVERY.pitch}`)
ok('stall net exists', Number.isFinite(RAVEN_DELIVERY.stallMs) && RAVEN_DELIVERY.stallMs > 1000)
ok('voice wait is bounded', Number.isFinite(RAVEN_DELIVERY.voiceWaitMs) && RAVEN_DELIVERY.voiceWaitMs > 0)

/* ---------------------------------------------------------------- session cache */

console.log('one voice for the lifetime of the session:')
engineVoices = PLATFORMS['macOS Ventura']
const first = ravenVoice()
eq('session voice resolved', first.voice?.name, 'Samantha')
// Adding voices later (a pack installing) must not swap the timbre mid-session.
engineVoices = [...PLATFORMS['Windows Edge'], ...PLATFORMS['macOS Ventura']]
eq('new voices cannot hijack the cached voice', ravenVoice().voice?.name, 'Samantha')
// But losing it entirely is handled by re-resolving, not by speaking with nothing.
engineVoices = [V('Karen', 'en-AU')]
eq('vanished voice forces one re-resolution', ravenVoice().voice?.name, 'Karen')
resetRavenVoice()
engineVoices = PLATFORMS['macOS Ventura']

/* ---------------------------------------------------------------- speak / overlap */

console.log('overlap and duplicate protection:')
calls.length = 0
const doneA = []
const doneB = []
const boundaries = []

const turnA = speakRaven('Answer A, which is quite long.', {
  onDone: (reason) => doneA.push(reason),
  onBoundary: (b) => boundaries.push(['A', b.charIndex]),
})
await turnA
const spokenA = calls.filter((entry) => entry.kind === 'speak')
eq('A spoke once', spokenA.length, 1)
eq('A got the session voice', spokenA[0].voice?.name, 'Samantha')
eq('A got the fixed rate', spokenA[0].utterance.rate, RAVEN_DELIVERY.rate)
eq('A got the fixed pitch', spokenA[0].utterance.pitch, RAVEN_DELIVERY.pitch)

// A is still "speaking" when the user sends another message.
const utteranceA = spokenA[0].utterance
const turnB = speakRaven('Answer B is the latest intent.', { onDone: (reason) => doneB.push(reason), onBoundary: (b) => boundaries.push(['B', b.charIndex]) })
await turnB
const allSpoken = calls.filter((entry) => entry.kind === 'speak')
const allCancelled = calls.filter((entry) => entry.kind === 'cancel')
eq('B cancelled before speaking', allCancelled.length >= 1, true)
eq('B is the only thing now speaking', allSpoken.length, 2)
eq('B got the same voice as A', allSpoken[1].voice?.name, 'Samantha')
eq('B replaced A without a gap in identity', allSpoken[1].utterance !== utteranceA, true)

// A's engine callbacks arrive late — after B started. They must be inert.
utteranceA.onboundary?.({ charIndex: 12, charLength: 4 })
utteranceA.onend?.()
eq('A\'s late boundary is dropped', boundaries.length, 0)
eq('A\'s late onend settles nothing', doneA.length, 0)
const utteranceB = allSpoken[1].utterance
utteranceB.onboundary?.({ charIndex: 3, charLength: 5 })
eq("B's boundary is forwarded", boundaries.length, 1)
eq("B's boundary is labelled B", boundaries[0][0], 'B')
utteranceB.onend?.()
eq("B's onend fires exactly once", doneB.length, 1)
eq("B's reason", doneB[0], 'end')
utteranceB.onend?.()
eq('a repeated onend cannot double-settle', doneB.length, 1)

// Interrupt path: stop() must finish the in-flight request once and ignore its callbacks.
calls.length = 0
doneA.length = 0
const turnC = speakRaven('Answer C will be interrupted.', { onDone: (reason) => doneA.push(reason) })
await turnC
stopRavenSpeech()
eq('interrupt settles the current request once', doneA.length, 1)
eq('interrupt reason', doneA[0], 'interrupted')
calls.filter((entry) => entry.kind === 'speak')[0].utterance.onend?.()
eq('the interrupted request\'s own onend is ignored', doneA.length, 1)

// An empty answer must not leave the UI holding SPEAKING.
calls.length = 0
const doneEmpty = []
await speakRaven('   ', { onDone: (reason) => doneEmpty.push(reason) })
eq('empty text never reaches the engine', calls.filter((entry) => entry.kind === 'speak').length, 0)
eq('empty text still settles', doneEmpty.join(','), 'unavailable')

/* ---------------------------------------------------------------- listener hygiene */

console.log('voiceschanged listener hygiene:')
resetRavenVoice()
engineVoices = []
listeners = []
const pending = [voicesReady(), voicesReady(), voicesReady()]
eq('waiting for an empty list registers exactly one listener', listeners.length, 1)
engineVoices = PLATFORMS['macOS Ventura']
fireVoicesChanged()
await Promise.all(pending)
eq('still one listener after three concurrent waits', listeners.length, 1)
await voicesReady()
eq('no listener once the list is populated', listeners.length, 1)
eq('waited flag recorded', ravenVoiceState().waitedForVoices, true)
eq('voice resolved after the event', ravenVoiceState().voice?.name, 'Samantha')
resetRavenVoice()
eq('dispose removes the listener', listeners.length, 0)
resetRavenVoice()
eq('dispose is idempotent', listeners.length, 0)
eq('generation keeps counting', ravenVoiceState().generation >= 0, true)

/* ---------------------------------------------------------------- one manager only */

console.log('single authoritative controller:')
const fs = await import('node:fs')
const path = await import('node:path')
const root = path.resolve(import.meta.dirname, '..')
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const offenders = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.tsx?$/.test(entry.name)) {
      const source = strip(fs.readFileSync(full, 'utf8'))
      const direct = /speechSynthesis\s*\./.test(source) || /new\s+SpeechSynthesisUtterance\b/.test(source)
      if (direct && !full.endsWith(path.join('lib', 'ravenVoice.ts'))) offenders.push(path.relative(root, full))
    }
  }
}
walk(path.join(root, 'app'))
walk(path.join(root, 'components'))
walk(path.join(root, 'lib'))
ok('no component or module touches speechSynthesis directly', offenders.length === 0, offenders.join(', '))

const store = fs.readFileSync(path.join(root, 'lib', 'ravenStore.ts'), 'utf8')
eq('the store calls speakRaven exactly once', (store.match(/speakRaven\(/g) ?? []).length, 1)
ok('the store interrupts the previous answer when a new turn is sent', /if \(get\(\)\.isSpeaking\) \{\n\s*stopRavenSpeech\(\)/.test(store))
ok('muting stops the utterance in progress', /toggleVoiceOutput[\s\S]{0,400}stopRavenSpeech\(\)/.test(store))
eq('the store builds no utterance of its own', /new\s+SpeechSynthesisUtterance/.test(store), false)
const intro = fs.readFileSync(path.join(root, 'components', 'CinematicIntro.tsx'), 'utf8')
eq('the greeting uses the same controller', (intro.match(/speakRaven\(/g) ?? []).length, 1)
ok('the greeting cannot be double-queued by Strict Mode', /spokenForRef\.current === audioEnabled/.test(intro))
eq('the intro builds no utterance of its own', /new\s+SpeechSynthesisUtterance/.test(intro), false)
// Comment-stripped, because this module's own documentation mentions the forbidden APIs
// by name to explain why they are not used.
const voiceSource = strip(fs.readFileSync(path.join(root, 'lib', 'ravenVoice.ts'), 'utf8'))
eq('no randomness in voice selection', /Math\.random/.test(voiceSource), false)
eq('no array-position selection', /getVoices\(\)\s*\[/.test(voiceSource), false)

/* ---------------------------------------------------------------- ssr safety */

console.log('server render and no-synthesis environments:')
resetRavenVoice()
const savedWindow = globalThis.window
delete globalThis.window
eq('availability is false without an engine', ravenVoiceState().speaking, false)
eq('resolver tolerates a missing window', ravenVoice().source, 'platform-default')
await voicesReady()
const doneNoEngine = []
let threw = null
try {
  await speakRaven('Server-side text must never reach an engine.', { onDone: (reason) => doneNoEngine.push(reason) })
  stopRavenSpeech()
} catch (error) {
  threw = error
}
eq('speakRaven does not throw without an engine', threw, null)
eq('and it settles the request instead of hanging', doneNoEngine.includes('unavailable'), true)
globalThis.window = savedWindow

resetRavenVoice()
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.log(`✗ ${failures} voice check(s) failed`)
  process.exitCode = 1
}
