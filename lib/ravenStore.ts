import { create } from 'zustand'
import { beginSpeech, endSpeech, onBoundary } from '@/lib/speechSync'
import { RAVEN_DELIVERY, ravenSpeechAvailable, speakRaven, stopRavenSpeech } from '@/lib/ravenVoice'
import {
  askRaven,
  getRavenHealth,
  ravenConversationId,
  ravenSessionId,
  type RavenHealth,
  type RavenState,
} from '@/lib/ravenClient'
import { siteConfig } from '@/data/siteConfig'

export type { RavenState }

export type VisionStatus =
  | 'OFFLINE'
  | 'STARTING'
  | 'SEARCHING'
  | 'LOCKED'
  | 'RECOVERING'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED'

export type RavenAnswerMode = 'knowledge' | 'genai' | 'agentic' | 'offline'

type ChatMessage = {
  id: string
  sender: 'user' | 'raven' | 'system'
  text: string
  timestamp: string
  toolUsed?: string
  /**
   * What the answer was built from, straight off the server's own citation list. Kept as
   * plain strings because a transcript renders text, not a debug tree; the structured form
   * stays on `RavenReply.citations` for anything that needs kinds and locators.
   */
  sources?: string[]
  /**
   * The server's phase trace for this turn, one short line per phase that actually ran.
   * Backend events with real timings — not chain-of-thought: the brain reports what it
   * did, never how it deliberated.
   */
  trace?: string[]
}

/** Compile-time guard: siteConfig's state list must stay in sync with the API union. */
type _RavenStatesSync = (typeof siteConfig.ravenStates) extends readonly RavenState[] ? true : never
const _ravenStatesSync: _RavenStatesSync = true

interface RavenStoreState {
  state: RavenState
  isOnline: boolean
  isCheckingHealth: boolean
  healthMessage: string
  /** Raw /api/health payload, so the UI can show capability flags it measured. */
  health: RavenHealth | null
  healthCheckedAt: string | null
  messages: ChatMessage[]
  isListening: boolean
  isSpeaking: boolean
  isVoiceOutputEnabled: boolean
  isVisionEnabled: boolean
  visionStatus: VisionStatus
  visionMessage: string
  facePresent: boolean
  depth: { x: number; y: number }
  /**
   * Which route served the last completed turn: `knowledge`, `genai`, `agentic` or
   * `offline`. Kept separate from `state` because the HUD's `MODE:` line and the
   * execution state answer different questions — one is "which engine answered", the
   * other is "what is RAVEN doing right now". Null until a turn completes, so the UI
   * can never guess a mode.
   */
  lastMode: RavenAnswerMode | null

  // Actions
  setState: (state: RavenState) => void
  setIsOnline: (online: boolean) => void
  setHealthMessage: (msg: string) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  setIsListening: (listening: boolean) => void
  setIsSpeaking: (speaking: boolean) => void
  toggleVoiceOutput: () => void
  toggleVision: () => void
  disableVision: () => void
  setVisionStatus: (status: VisionStatus, message?: string) => void
  setFacePresent: (present: boolean) => void
  setDepth: (depth: { x: number; y: number }) => void
  ensureWelcomeMessage: () => void
  checkBackendHealth: () => Promise<void>
  sendMessage: (text: string) => Promise<void>
}

const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const welcomeText =
  "Greetings. I am RAVEN — Riyan Pasha's Autonomous Virtual Engineering Nexus. How may I assist your exploration today?"

export const useRavenStore = create<RavenStoreState>((set, get) => ({
  state: 'IDLE',
  isOnline: false,
  isCheckingHealth: true,
  healthMessage: 'Checking RAVEN server state...',
  health: null,
  healthCheckedAt: null,
  // Seeded on mount (see ensureWelcomeMessage) — never during module init, so the
  // server render and the first client render cannot disagree.
  messages: [],
  isListening: false,
  isSpeaking: false,
  isVoiceOutputEnabled: true,
  isVisionEnabled: false,
  visionStatus: 'OFFLINE',
  visionMessage: '',
  facePresent: false,
  depth: { x: 0, y: 0 },
  lastMode: null,

  setState: (state) => set({ state }),
  setIsOnline: (isOnline) => set({ isOnline }),
  setHealthMessage: (healthMessage) => set({ healthMessage }),
  setIsListening: (isListening) => set({ isListening }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  toggleVoiceOutput: () =>
    set((s) => {
      // Muting mid-sentence must actually mute: the utterance is cancelled and the jaw
      // driver released, otherwise the button changes label while RAVEN keeps talking.
      if (s.isSpeaking) {
        stopRavenSpeech()
        endSpeech()
      }
      return { isVoiceOutputEnabled: !s.isVoiceOutputEnabled, isSpeaking: false }
    }),
  toggleVision: () =>
    set((s) => (s.isVisionEnabled ? { isVisionEnabled: false } : { isVisionEnabled: true })),
  disableVision: () => set((s) => (s.isVisionEnabled ? { isVisionEnabled: false } : {})),
  setVisionStatus: (visionStatus, visionMessage = '') => {
    set({ visionStatus, visionMessage })
    if (visionStatus !== 'LOCKED') set({ facePresent: false })
  },
  setFacePresent: (facePresent) => set({ facePresent }),
  setDepth: (depth) => set({ depth }),

  ensureWelcomeMessage: () => {
    if (get().messages.length > 0) return
    set({
      messages: [{ id: 'welcome-1', sender: 'raven', text: welcomeText, timestamp: formatTime() }],
    })
  },

  addMessage: (msg) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: formatTime(),
    }
    set((state) => ({ messages: [...state.messages, newMsg] }))
  },

  checkBackendHealth: async () => {
    // Cleared first, so a previous probe can never be shown as current.
    set({ isCheckingHealth: true, health: null, healthCheckedAt: null })
    try {
      const data = await getRavenHealth()
      const probedAt = formatTime()
      // "Online" means the brain itself answered. It answers from local knowledge with
      // no provider and no database, so a missing key is a capability note below, not
      // an outage — and the console must not claim offline when it is working.
      const knowledgeLive = Boolean(data.knowledge && data.knowledge.documents > 0)
      const providerLive = Boolean(data.providerConfigured && data.providerReachable)
      set({
        isOnline: knowledgeLive || providerLive,
        healthMessage: providerLive
          ? 'RAVEN brain online — knowledge engine + provider live'
          : knowledgeLive
            ? 'RAVEN brain online — deterministic knowledge engine (no provider configured)'
            : 'Brain answered, but its knowledge layer reported nothing',
        isCheckingHealth: false,
        health: data,
        healthCheckedAt: probedAt,
      })
    } catch {
      // No payload at all: the console reports the probe as failed, it does not guess.
      set({
        isOnline: false,
        healthMessage: 'Backend unreachable — the brain cannot answer from the browser',
        isCheckingHealth: false,
        health: null,
        healthCheckedAt: null,
      })
    }
  },

  sendMessage: async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const { addMessage, setState, isVisionEnabled, isVoiceOutputEnabled, facePresent, depth } = get()

    addMessage({ sender: 'user', text: trimmed })
    // Interrupt on intent. RAVEN stops talking the moment a new turn is sent, so an
    // answer that is on its way out is never layered under the next one, and its stale
    // speech callbacks belong to a superseded generation and cannot fire into this turn.
    if (get().isSpeaking) {
      stopRavenSpeech()
      endSpeech()
    }
    // One working state to show something is happening; every state after this one comes
    // back from the server's real phase, not from a timer in here.
    setState('LISTENING')

    let replyText = ''
    let toolUsed: string | undefined
    let sources: string[] | undefined
    let trace: string[] | undefined
    let failed = false

    try {
      // Vision is passed through as client-reported context; the brain never claims to
      // have looked at a camera on its own.
      const visionContext = isVisionEnabled
        ? { facePresent, depth, reportedBy: 'raven-console-camera-loop', reportedAt: new Date().toISOString() }
        : null

      const result = await askRaven(trimmed, {
        conversationId: ravenConversationId(),
        sessionId: ravenSessionId(),
        inputType: 'text',
        visionContext,
        // The only side effect a browser turn may approve on its own: moving the page.
        approvedActions: ['request_navigation'],
      })

      const notes: string[] = []
      if (result.error?.code && result.error.code !== 'no_grounding') notes.push(`error: ${result.error.code}`)
      if (result.error?.code === 'no_grounding') notes.push('nothing grounded')
      if (result.metadata?.route.degradedFrom) notes.push(`fell back from ${result.metadata.route.degradedFrom}`)
      if (!result.verified) notes.push('unverified')
      if (result.memoryUpdates?.length) notes.push(`${result.memoryUpdates.length} memory update(s)`)
      if (result.metadata?.truncated) notes.push('truncated')

      const tools = result.metadata?.toolsUsed ?? []
      const prefix = result.mode === 'agentic' ? `agent (${result.metadata?.steps ?? 0} steps)` : `${result.mode} engine`
      toolUsed = [prefix, tools.length ? tools.join(' + ') : null, notes.length ? notes.join(', ') : null]
        .filter(Boolean)
        .join(' · ')

      // Both lists are assembled from fields the route already returns, so there is nothing
      // here to fabricate a busy-looking turn: if retrieval found nothing, `sources` stays
      // empty and the console draws no source line at all.
      const cited = (result.citations ?? []).slice(0, 4).map((citation) =>
        citation.locator ? `${citation.label} · ${citation.locator}` : citation.label,
      )
      const phases = (result.metadata?.trace ?? []).map(
        (phase) => `${phase.phase}${phase.ms ? ` · ${phase.ms} ms` : ''}${phase.note ? ` — ${phase.note}` : ''}`,
      )
      sources = cited.length ? cited : undefined
      trace = phases.length ? phases : undefined

      replyText = (result.output || result.response || '').trim()

      if (!replyText) {
        failed = true
      } else {
        // Apply the actions the server proposed and the client approved. The server only
        // ever proposes; the browser is the thing that can actually scroll.
        for (const action of result.actions) {
          if (action.tool !== 'request_navigation') continue
          const section = typeof action.input.section === 'string' ? action.input.section : ''
          const element = section ? document.getElementById(section) : null
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' })
            addMessage({ sender: 'system', text: `Scrolled to #${section} (performed in the browser, at your request).` })
          } else {
            addMessage({ sender: 'system', text: `No #${section || 'unknown'} element exists on this page, so nothing moved.` })
          }
        }
        if (!result.verified) {
          addMessage({
            sender: 'system',
            text: 'The brain could not fully verify that against its retrieved evidence; the reason is in the trace.',
          })
        }
        if (!result.success && result.error?.code === 'no_grounding') {
          addMessage({ sender: 'system', text: 'No portfolio record cleared the relevance floor — nothing was invented to fill the gap.' })
        }
      }
      setState(result.state ?? 'SPEAKING')
      // Recorded from the response, not inferred: `mode` is what the route says it used.
      set({ lastMode: (result.mode as RavenAnswerMode | undefined) ?? null })
    } catch (error) {
      failed = true
      replyText = ''
      set({ lastMode: null })
      void error
    }

    if (failed || !replyText) {
      setState('ERROR')
      addMessage({
        sender: 'system',
        text: 'The brain could not complete this turn. Nothing was invented to fill the gap — try rephrasing, or check /api/health.',
      })
      setTimeout(() => {
        if (get().state === 'ERROR') setState('IDLE')
      }, 2000)
      return
    }

    setState('SPEAKING')
    addMessage({ sender: 'raven', text: replyText, toolUsed, sources, trace })

    const settle = () => {
      get().setIsSpeaking(false)
      endSpeech()
      if (get().state === 'SPEAKING') get().setState('IDLE')
    }

    const canSpeak =
      isVoiceOutputEnabled && ravenSpeechAvailable()

    if (!canSpeak) {
      // Voice output is off (or the browser has no synthesis engine). The answer is still
      // delivered as text — nothing about the reply is faked — the jaw driver is told there
      // is nothing to follow, and SPEAKING settles on a timer instead of hanging.
      endSpeech()
      setTimeout(settle, 1500)
      return
    }

    // ONE controller owns cancel, voice selection, prosody and the stall net. `settle`
    // therefore runs exactly once per response, whether the utterance ends, errors, gets
    // interrupted by a newer answer or never ends at all; a superseded response's late
    // `onend` is dropped by the controller's generation guard, which is what stops a
    // cancelled answer from resetting the interface out from under the current one.
    void speakRaven(replyText, {
      onBegin: () => {
        set({ isSpeaking: true })
        // Feed the speech driver from the moment audio actually starts, not from the
        // moment the answer was ready: browsers without boundary events fall back to a
        // rate estimate, and sampleSpeech() labels which one is live.
        beginSpeech(replyText, { rate: RAVEN_DELIVERY.rate })
      },
      onBoundary: (boundary) => onBoundary({ ...boundary, word: '' }),
      onDone: () => {
        endSpeech()
        settle()
      },
    })
  },
}))

void _ravenStatesSync
