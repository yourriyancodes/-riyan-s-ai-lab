/**
 * RAVEN's voice — the one and only place in this app that is allowed to touch
 * `window.speechSynthesis`.
 *
 * Why this module exists
 * ----------------------
 * Before it, two components each built their own `SpeechSynthesisUtterance`
 * (`lib/ravenStore.ts` for answers, `components/CinematicIntro.tsx` for the welcome
 * line), each with its own `voices.find(...)` and its own idea of what to do when the
 * voice list had not arrived yet. That produced the reported bug — RAVEN alternating
 * between a male and a female voice — through three separate mechanisms at once:
 *
 *  1. `getVoices()` is empty on the first tick in Chrome, so an utterance created
 *     immediately after page load silently used the **browser default voice** while a
 *     later one used a preferred voice. Different messages, different voices.
 *  2. Each caller re-ran `voices.find(...)` **per utterance** over a browser-supplied
 *     array whose order and contents change (voice packs, extensions, Android's list), so
 *     "the first match" was not the same voice twice running.
 *  3. The intro patched `utterance.voice` from a `voiceschanged` listener *after*
 *     `speak()` had started — which does nothing, since a running utterance keeps the
 *     voice it started with.
 *
 * The rules this module enforces, in order:
 *
 *  - **One voice per session.** It is resolved once, cached, and reused for every
 *    utterance, by every caller. Re-resolution happens only if the cached voice has
 *    disappeared from the list entirely.
 *  - **Never position, never randomness.** Selection is a pure score over the voice's own
 *    metadata with a deterministic name tie-break, so the result cannot depend on array
 *    order, on timing, or on `Math.random()` (which does not appear in this file).
 *  - **Never the default when a preferred voice exists.** `speak()` waits for the voice
 *    list, up to a bounded timeout, instead of racing it.
 *  - **One at a time, latest wins.** Every request carries a generation id; `cancel()`
 *    precedes every utterance, and callbacks belonging to a superseded request are
 *    dropped. So "A is speaking, B arrives" means A stops, A's late `onend` is ignored,
 *    and B is spoken exactly once.
 *  - **Never stuck.** A stall timer guarantees `onDone` fires even if the browser forgets
 *    to end an utterance, so the UI can't be left in SPEAKING.
 *  - **One listener, removed on dispose.** The `voiceschanged` subscription is
 *    reference-counted at module scope, so React re-mounts and Strict Mode's double
 *    effect cannot stack duplicate listeners.
 *
 * Nothing here fakes capability: if the platform has no usable `en` voice, the cached
 * result is `null`, the browser's default is used for the whole session, and
 * `ravenVoiceState().source` reports `"platform-default"` so the truth is inspectable.
 */

export type RavenVoiceInfo = {
  name: string
  lang: string
  /** Present on real SpeechSynthesisVoice objects; ignored by the selector. */
  voiceURI?: string
  default?: boolean
  localService?: boolean
}

export type RavenVoiceSource =
  /** One of PREFERRED_RAVEN_VOICES, by name. */
  | 'preferred-name'
  /** Not in the table, but a known feminine English voice on this platform. */
  | 'feminine-name'
  /** An English voice with no gender signal in its name — chosen, and then kept. */
  | 'english-unmarked'
  /**
   * The platform offered nothing but masculine English voices. Deterministic, not a
   * coin-flip: the same single voice is used for the whole session, and `source` says so
   * instead of pretending a feminine voice was found.
   */
  | 'masculine-only'
  /** Nothing usable: the browser's own default, also cached for the whole session. */
  | 'platform-default'

export type ResolvedRavenVoice = {
  voice: RavenVoiceInfo | null
  source: RavenVoiceSource
}

/* ------------------------------------------------------------------ delivery */

/**
 * Conservative on purpose. `rate` is a shade under "normal" because RAVEN speaks
 * technical sentences with citations in them; `pitch` is +6 % of the voice's own
 * character rather than a synthetic soprano; volume is not 1.0 so a response never
 * startles. These are the *only* prosody values in the app.
 */
export const RAVEN_DELIVERY = {
  rate: 1.02,
  pitch: 1.06,
  volume: 0.92,
  /** How long to wait for the browser's voice list before speaking with what exists. */
  voiceWaitMs: 1200,
  /** Safety net: an utterance the browser never ends cannot hold the UI in SPEAKING. */
  stallMs: 15000,
} as const

/**
 * Ranked by name, best first. Each entry is a *installed* browser/system voice that is
 * calm, clear and feminine — not invented personas. Only the first entry that exists on
 * the machine wins, so this list can never produce two different voices on one machine.
 */
export const PREFERRED_RAVEN_VOICES: readonly string[] = [
  'Google UK English Female',
  'Samantha',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Aria',
  'Microsoft Jenny Online (Natural) - English (United States)',
  'Jenny',
  'Google US English',
  'Karen',
  'Moira',
  'Tessa',
  'Serena',
  'Sonia',
  'Fiona',
  'Victoria',
  'Microsoft Zira Online (Natural) - English (United States)',
  'Zira',
  'Samantha (Enhanced)',
  'Kalinda',
]

/**
 * Known masculine given names in the voice packs that ship with macOS, Windows, iOS,
 * Android and the Chromium/Google set. Matched as whole name tokens, never as
 * substrings — "female" contains "male", and any substring test here would disqualify
 * every feminine voice on the platform.
 */
const MASCULINE_TOKENS: readonly string[] = [
  'male',
  'david',
  'mark',
  'george',
  'james',
  'daniel',
  'alex',
  'fred',
  'guy',
  'rishi',
  'oliver',
  'arthur',
  'andrew',
  'eric',
  'aaron',
  'abdi',
  'ravi',
  'prabhat',
  'henri',
  'conrad',
  'roger',
]

/** Extra feminine signals for platforms that do not name voices after the above. */
const FEMININE_TOKENS: readonly string[] = [
  'female',
  'femmale',
  'woman',
  'samantha',
  'aria',
  'jenny',
  'karen',
  'moira',
  'tessa',
  'serena',
  'sonia',
  'fiona',
  'victoria',
  'zira',
  'kalinda',
  'susan',
  'sara',
  'hazel',
  'linda',
  'heather',
  'nora',
  'ava',
]

/** Preferred locales, in order: a crisp English voice beats a localised one. */
const LANG_RANK: readonly string[] = ['en-GB', 'en-US', 'en-AU', 'en-IE', 'en-ZA', 'en-IN', 'en']

const nameTokens = (name: string): string[] =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)

const hasToken = (name: string, tokens: readonly string[]): boolean => {
  const parts = new Set(nameTokens(name))
  for (const token of tokens) if (parts.has(token)) return true
  return false
}

const langScore = (lang: string): number => {
  const index = LANG_RANK.indexOf(lang)
  if (index >= 0) return 40 - index
  const family = lang.split(/[-_]/)[0]?.toLowerCase() ?? ''
  if (family === 'en') return 20
  return -1
}

/**
 * The whole selection policy, as a pure function over a voice list.
 *
 * Score = locale + name signals, with the preferred-name table as a strong bonus, and a
 * hard veto on masculine voices so a fallback can never quietly become a male voice.
 * Ties break on the name itself, which is what makes the result independent of the order
 * the browser happened to hand back.
 */
export function scoreRavenVoice(voice: RavenVoiceInfo): number {
  const lang = (voice.lang ?? '').replace('_', '-')
  const locale = langScore(lang)
  if (locale < 0) return Number.NEGATIVE_INFINITY

  const lower = voice.name.toLowerCase()
  let score = locale

  const preferred = PREFERRED_RAVEN_VOICES.findIndex(
    (name) => name.toLowerCase() === lower || lower.startsWith(`${name.toLowerCase()} `),
  )
  if (preferred >= 0) score += 200 - preferred

  // Exact masculine name in a voice pack that labels gender in the name: veto.
  if (hasToken(voice.name, MASCULINE_TOKENS) && !hasToken(voice.name, ['female'])) {
    score -= 500
  }
  if (hasToken(voice.name, FEMININE_TOKENS)) score += 120

  // Network voices on Android are frequently a better match than a robotic local one,
  // but a *local* voice is more likely to be present on the next message, so prefer
  // stability by a small margin instead of chasing quality.
  if (voice.localService === false) score -= 4
  if (voice.default) score += 2
  return score
}

/** Which rule a chosen voice satisfies. Exported so the label can be tested directly. */
export function labelRavenVoice(voice: RavenVoiceInfo): RavenVoiceSource {
  const lower = voice.name.toLowerCase()
  const preferred = PREFERRED_RAVEN_VOICES.some(
    (name) => name.toLowerCase() === lower || lower.startsWith(`${name.toLowerCase()} `),
  )
  if (preferred) return 'preferred-name'
  if (hasToken(voice.name, FEMININE_TOKENS)) return 'feminine-name'
  if (hasToken(voice.name, MASCULINE_TOKENS)) return 'masculine-only'
  return 'english-unmarked'
}

/** Deterministic pick. Returns the best voice, plus which rule chose it. */
export function resolveRavenVoice(voices: readonly RavenVoiceInfo[]): ResolvedRavenVoice {
  let best: RavenVoiceInfo | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const voice of voices) {
    const score = scoreRavenVoice(voice)
    if (!Number.isFinite(score)) continue
    if (score > bestScore || (score === bestScore && best !== null && voice.name.localeCompare(best.name) < 0)) {
      best = voice
      bestScore = score
    }
  }
  if (!best) return { voice: null, source: 'platform-default' }

  const source: RavenVoiceSource = labelRavenVoice(best)
  return { voice: best, source }
}

/* ------------------------------------------------------------------ runtime */

export type SpeakDoneReason = 'end' | 'error' | 'interrupted' | 'stall' | 'unavailable'

export type SpeakRavenOptions = {
  /** Called immediately before `speak()`, so lip-sync starts with the audio, not with the intent. */
  onBegin?: (context: { voice: RavenVoiceInfo | null; text: string }) => void
  onBoundary?: (boundary: { charIndex: number; charLength: number }) => void
  /** Fires exactly once per request: end, error, cancel or stall. Superseded requests never fire it. */
  onDone?: (reason: SpeakDoneReason) => void
}

/** True when this browser has a Web Speech synthesis engine at all. */
export function ravenSpeechAvailable(): boolean {
  return hasSpeech()
}

export type RavenVoiceState = {
  voice: RavenVoiceInfo | null
  source: RavenVoiceSource
  /** Monotonic request id. A callback whose id is not `generation` is stale by definition. */
  generation: number
  speaking: boolean
  /** How many `voiceschanged` subscriptions this module currently holds. */
  listeners: number
  /** Whether the list was empty and we had to wait for it. */
  waitedForVoices: boolean
}

let cached: ResolvedRavenVoice | null = null
let cachedSignature = ''
let generation = 0
let speaking = false
let waitedForVoices = false
let listenerCount = 0
let waiters: (() => void)[] = []
let activeStall: ReturnType<typeof setTimeout> | null = null
let activeDone: ((reason: SpeakDoneReason) => void) | null = null

const hasSpeech = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

const signatureOf = (voices: readonly RavenVoiceInfo[]): string =>
  voices
    .map((voice) => `${voice.name}\u0000${voice.lang}`)
    .sort()
    .join('\u0001')

function listVoices(): RavenVoiceInfo[] {
  if (!hasSpeech()) return []
  try {
    return (window.speechSynthesis.getVoices() ?? []) as unknown as RavenVoiceInfo[]
  } catch {
    return []
  }
}

/**
 * Resolve once, then reuse. The cache is only thrown away when the *set* of voices
 * changed underneath us (a voice pack being installed), and even then a still-present
 * voice keeps being used — a running session must not hear two timbres.
 */
export function ravenVoice(): ResolvedRavenVoice {
  const voices = listVoices()
  const signature = signatureOf(voices)
  if (cached && signature === cachedSignature) return cached
  if (cached?.voice && voices.some((voice) => voice.name === cached?.voice?.name && voice.lang === cached?.voice?.lang)) {
    cachedSignature = signature
    return cached
  }
  cached = voices.length > 0 ? resolveRavenVoice(voices) : null
  cachedSignature = signature
  return cached ?? { voice: null, source: 'platform-default' }
}

function installVoicesListener(): void {
  if (listenerCount > 0 || !hasSpeech()) return
  if (typeof window.speechSynthesis.addEventListener !== 'function') return
  listenerCount += 1
  const onChange = () => {
    // Invalidate nothing while a voice is already cached and still present; `ravenVoice()`
    // handles that. The listener exists so the *first* utterance can wait for this event
    // instead of being spoken by the default voice.
    if (listVoices().length > 0) flushWaiters()
  }
  window.speechSynthesis.addEventListener('voiceschanged', onChange)
  ;(installVoicesListener as unknown as { handler?: () => void }).handler = onChange
}

function flushWaiters(): void {
  const pending = waiters
  waiters = []
  for (const resolve of pending) resolve()
}

/**
 * Resolves as soon as the browser reports any voices, or after `voiceWaitMs` — whichever
 * comes first. Bounded on purpose: a platform that never populates the list must still
 * speak, exactly once, with one voice for the whole session.
 */
export function voicesReady(): Promise<void> {
  if (!hasSpeech() || listVoices().length > 0) return Promise.resolve()
  installVoicesListener()
  waitedForVoices = true
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, RAVEN_DELIVERY.voiceWaitMs)
    waiters.push(finish)
  })
}

export function ravenVoiceState(): RavenVoiceState {
  const resolved = ravenVoice()
  return {
    voice: resolved.voice,
    source: resolved.source,
    generation,
    speaking,
    listeners: listenerCount,
    waitedForVoices,
  }
}

/** Hard stop. Any in-flight request becomes stale, so its callbacks are ignored. */
export function stopRavenSpeech(): void {
  if (!hasSpeech()) return
  generation += 1
  finishActive('interrupted')
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nothing to cancel */
  }
  speaking = false
}

function finishActive(reason: SpeakDoneReason): void {
  if (activeStall !== null) {
    clearTimeout(activeStall)
    activeStall = null
  }
  const done = activeDone
  activeDone = null
  speaking = false
  if (done) done(reason)
}

/**
 * Speak one RAVEN response. Returns the request id so a caller can recognise its own
 * callbacks; every later request supersedes this one.
 */
export async function speakRaven(text: string, options: SpeakRavenOptions = {}): Promise<number> {
  const id = ++generation
  if (!hasSpeech()) {
    finishActive('unavailable')
    options.onDone?.('unavailable')
    return id
  }

  await voicesReady()
  if (id !== generation) {
    // Superseded while waiting for the voice list: this response must not speak at all.
    return id
  }

  const body = text.trim()
  if (!body) {
    finishActive('unavailable')
    options.onDone?.('unavailable')
    return id
  }

  const resolved = ravenVoice().voice
  // The one call that makes overlap impossible: whatever the browser is still holding,
  // it goes before the new utterance is queued.
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* ignore */
  }

  const utterance = new SpeechSynthesisUtterance(body)
  utterance.rate = RAVEN_DELIVERY.rate
  utterance.pitch = RAVEN_DELIVERY.pitch
  utterance.volume = RAVEN_DELIVERY.volume
  utterance.lang = resolved?.lang ?? 'en-GB'
  if (resolved) {
    utterance.voice = resolved as unknown as SpeechSynthesisVoice
  }
  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    if (id !== generation) return
    options.onBoundary?.({
      charIndex: Number.isFinite(event.charIndex) ? event.charIndex : 0,
      charLength: Number.isFinite(event.charLength) ? event.charLength : 0,
    })
  }
  // `finishActive` is the only place the completion callback is invoked, so "exactly once"
  // is a property of the module rather than of each handler remembering not to double-fire.
  utterance.onend = () => {
    if (id !== generation) return
    finishActive('end')
  }
  utterance.onerror = () => {
    if (id !== generation) return
    finishActive('error')
  }

  activeDone = (reason) => options.onDone?.(reason)
  speaking = true
  options.onBegin?.({ voice: resolved, text: body })
  activeStall = setTimeout(() => {
    if (id !== generation) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
    finishActive('stall')
  }, RAVEN_DELIVERY.stallMs)

  try {
    window.speechSynthesis.speak(utterance)
  } catch {
    finishActive('error')
    options.onDone?.('error')
  }
  return id
}

/** Test/teardown hook: drops the listener and the cache so nothing leaks between mounts. */
export function resetRavenVoice(): void {
  if (listenerCount > 0 && hasSpeech()) {
    const handler = (installVoicesListener as unknown as { handler?: () => void }).handler
    if (handler) window.speechSynthesis.removeEventListener('voiceschanged', handler)
    listenerCount = 0
  }
  flushWaiters()
  cached = null
  cachedSignature = ''
  waitedForVoices = false
  speaking = false
  if (activeStall !== null) clearTimeout(activeStall)
  activeStall = null
  activeDone = null
}
