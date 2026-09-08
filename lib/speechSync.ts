/**
 * Speech-driven mouth timing.
 *
 * RAVEN's voice is `window.speechSynthesis` (free, built into the browser). The
 * Web Speech API emits `SpeechSynthesisEvent` boundary callbacks as it speaks,
 * carrying the character index and length of the word being pronounced. This module
 * turns those events into a per-frame mouth pose, so the jaw actually moves *with
 * the words* instead of on a decorative sine wave.
 *
 * The mapping is a grapheme-to-viseme approximation, not phoneme analysis: there is
 * no phonemiser available offline, and the audio is not accessible for analysis
 * (speechSynthesis gives no sample buffer). It is accurate enough to read as
 * lip-sync and honest enough to be described that way in the UI.
 *
 * No framework, no DOM: the component polls `sampleSpeech()` inside its render loop
 * and the store writes boundary events, so nothing here triggers a React re-render
 * 60 times a second.
 */

export type VisemeKey =
  | 'vAA'
  | 'vE'
  | 'vI'
  | 'vO'
  | 'vU'
  | 'vPP'
  | 'vFF'
  | 'vTH'
  | 'vDD'
  | 'vKK'
  | 'vNN'
  | 'vRR'
  | 'vSS'
  | 'vCH'

export type SpeechSource = 'none' | 'boundary' | 'estimate'

/** Rough openness per viseme, 0 (closed) to 1 (wide open). */
export const VISEME_OPENNESS: Record<VisemeKey, number> = {
  vAA: 1,
  vE: 0.55,
  vI: 0.35,
  vO: 0.7,
  vU: 0.3,
  vPP: 0.1,
  vFF: 0.12,
  vTH: 0.4,
  vDD: 0.45,
  vKK: 0.5,
  vNN: 0.2,
  vRR: 0.35,
  vSS: 0.18,
  vCH: 0.4,
}

type Boundary = { charIndex: number; charLength: number; word: string }

type SpeechState = {
  speaking: boolean
  text: string
  startedAt: number
  lastEventAt: number
  /** Character cursor as reported (or estimated) so far. */
  charIndex: number
  charLength: number
  /** Where the current word began, so progress within it is measurable. */
  wordStart: number
  word: string
  source: SpeechSource
  /** Smoothed speaking rate in characters per second. */
  rateCps: number
}

const state: SpeechState = {
  speaking: false,
  text: '',
  startedAt: 0,
  lastEventAt: 0,
  charIndex: 0,
  charLength: 0,
  wordStart: 0,
  word: '',
  source: 'none',
  rateCps: 13,
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Typical English speech is 12-16 characters per second at rate 1.0. */
const BASE_RATE_CPS = 13

export function beginSpeech(text: string, options: { rate?: number } = {}): void {
  const rate = Math.max(0.5, Math.min(2.5, options.rate ?? 1))
  state.speaking = true
  state.text = text ?? ''
  state.startedAt = now()
  state.lastEventAt = state.startedAt
  state.charIndex = 0
  state.charLength = 0
  state.wordStart = 0
  state.word = ''
  // Until the first boundary event arrives we are estimating; that flag is
  // reported by sampleSpeech() so the UI can say which mode is active.
  state.source = 'estimate'
  state.rateCps = BASE_RATE_CPS * rate
}

export function onBoundary(boundary: Boundary): void {
  if (!state.speaking) return
  state.source = 'boundary'
  const t = now()
  const elapsed = Math.max(0.001, (t - state.lastEventAt) / 1000)
  const advanced = Math.max(0, boundary.charIndex - state.charIndex)
  if (advanced > 0) {
    // Smoothed so one long word does not spike the measured rate.
    const instant = advanced / elapsed
    state.rateCps = state.rateCps * 0.65 + instant * 0.35
  }
  state.charIndex = boundary.charIndex
  state.wordStart = boundary.charIndex
  const located = wordAt(state.text, boundary.charIndex)
  state.charLength = boundary.charLength > 0 ? boundary.charLength : Math.max(1, located.end - located.start)
  state.word = located.text || boundary.word || ''
  state.lastEventAt = t
}

export function endSpeech(): void {
  state.speaking = false
  state.word = ''
  state.charLength = 0
}

export function resetSpeech(): void {
  endSpeech()
  state.text = ''
  state.charIndex = 0
  state.wordStart = 0
  state.source = 'none'
  state.rateCps = BASE_RATE_CPS
}

/**
 * The word containing `charIndex`, with its span. Whitespace never ends up inside
 * the result. A cursor sitting between words resolves to the word just *finished*
 * rather than the next one, because the mouth should complete the shape it started
 * instead of jumping ahead — that is what keeps lip-sync from stuttering in gaps.
 */
export function wordAt(text: string, charIndex: number): { text: string; start: number; end: number } {
  const source = text || ''
  if (!source.length) return { text: '', start: 0, end: 0 }
  let start = Math.max(0, Math.min(source.length - 1, Math.floor(charIndex)))
  while (start > 0 && /\s/.test(source[start])) start--
  while (start > 0 && !/\s/.test(source[start - 1])) start--
  if (/\s/.test(source[start])) {
    // The cursor is in a gap: advance to the next word instead of returning ''.
    let cursor = start
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++
    if (cursor >= source.length) return { text: '', start: source.length, end: source.length }
    start = cursor
  }
  let end = start
  while (end < source.length && !/\s/.test(source[end])) end++
  return { text: source.slice(start, end), start, end }
}

/**
 * Grapheme-to-viseme. Looks at the current character plus a peek at the next one so
 * digraphs (`th`, `sh`, `ch`, `oo`, `ee`) resolve properly.
 */
export function visemeForPair(current: string, next?: string): VisemeKey {
  const a = (current || '').toLowerCase()
  const b = (next || '').toLowerCase()
  const digraph = a + b
  if (digraph === 'th') return 'vTH'
  if (digraph === 'sh' || digraph === 'ch') return 'vCH'
  if (digraph === 'oo' || digraph === 'ou' || digraph === 'ow') return 'vU'
  if (digraph === 'ee' || digraph === 'ea' || digraph === 'ie') return 'vI'
  if (digraph === 'ai' || digraph === 'ay' || digraph === 'ei') return 'vE'
  if (digraph === 'aw' || digraph === 'au') return 'vO'
  if (digraph === 'ng') return 'vNN'
  if (a === 'p' || a === 'b' || a === 'm') return 'vPP'
  if (a === 'f' || a === 'v') return 'vFF'
  if (a === 'k' || a === 'g' || a === 'c' || a === 'q' || a === 'x') return 'vKK'
  if (a === 't' || a === 'd') return 'vDD'
  if (a === 's' || a === 'z') return 'vSS'
  if (a === 'j') return 'vCH'
  if (a === 'n') return 'vNN'
  if (a === 'r') return 'vRR'
  if (a === 'l') return 'vRR'
  if (a === 'i' || a === 'y') return 'vI'
  if (a === 'e') return 'vE'
  if (a === 'o') return 'vO'
  if (a === 'u' || a === 'w') return 'vU'
  if (a === 'a') return 'vAA'
  return 'vAA'
}

/**
 * The mouth pose for this instant. `energy` is derived from the measured speaking
 * rate, and falls when the cursor stalls (a pause between words), which is what
 * makes it read as synced rather than decorative.
 */
export function sampleSpeech(atTime?: number): {
  speaking: boolean
  source: SpeechSource
  viseme: VisemeKey
  openness: number
  energy: number
  word: string
  progress: number
} {
  const t = atTime ?? now()
  if (!state.speaking) {
    return { speaking: false, source: state.source, viseme: 'vAA', openness: 0, energy: 0, word: '', progress: 0 }
  }

  // Without boundary support, advance the cursor from measured rate.
  if (state.source === 'estimate') {
    const elapsedSeconds = Math.max(0, (t - state.startedAt) / 1000)
    state.charIndex = Math.min(state.text.length, elapsedSeconds * state.rateCps)
    const located = wordAt(state.text, state.charIndex)
    state.word = located.text
    state.wordStart = located.start
    state.charLength = Math.max(1, located.end - located.start)
  }

  const wordLength = Math.max(1, state.charLength)
  const word = state.word || ''

  // How far through the current word we are. With boundary events this is the
  // characters advanced since the event; estimating, it is the cursor offset from
  // the start of the word that was located. Going *past* the word means a pause
  // between words, which must reduce energy rather than keep chewing.
  const offset =
    state.source === 'boundary'
      ? Math.max(0, ((t - state.lastEventAt) / 1000) * state.rateCps)
      : Math.max(0, state.charIndex - state.wordStart)
  const withinWord = Math.min(1, offset / wordLength)
  const overrun = Math.max(0, offset - wordLength)
  const stallPenalty = Math.min(0.7, (overrun / Math.max(3, wordLength)) * 0.5)
  const progress = state.text.length ? Math.min(1, state.charIndex / state.text.length) : 0

  const letters = word.replace(/[^A-Za-z]/g, '')
  const letterIndex = Math.min(Math.max(0, letters.length - 1), Math.floor(withinWord * letters.length))
  const viseme = letters.length ? visemeForPair(letters[letterIndex], letters[letterIndex + 1]) : 'vAA'

  // Rate-relative loudness: a normal pace is full energy, a stall is not.
  const pace = Math.min(1.35, state.rateCps / (BASE_RATE_CPS * 1.15))
  const syllabic = 0.72 + 0.28 * Math.sin(withinWord * Math.PI * 2)
  const energy = Math.max(0, Math.min(1, pace * syllabic - stallPenalty))

  return {
    speaking: true,
    source: state.source,
    viseme,
    openness: VISEME_OPENNESS[viseme],
    energy,
    word,
    progress,
  }
}

/** Test/introspection helper. */
export function speechState(): Readonly<SpeechState> {
  return state
}
