'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Bot,
  User,
  Terminal,
  Info,
} from 'lucide-react'
import { useRavenStore } from '@/lib/ravenStore'
import type { RavenHealth } from '@/lib/ravenClient'

/**
 * Capability chips. Every flag is read from the backend's own /api/health answer
 * — nothing is inferred, and nothing is shown as available that the probe did not
 * report as available.
 */
const CAPABILITY_FLAGS: Array<[keyof RavenHealth, string, string, string]> = [
  ['providerConfigured', 'LLM KEY', 'PRESENT', 'ABSENT'],
  ['providerAdapterImplemented', 'ADAPTER', 'WIRED', 'NOT WIRED'],
  ['providerReachable', 'LLM REACH', 'YES', 'NO'],
  // Only rendered when the backend actually probed: see the filter below.
  ['providerAuthorized', 'LLM AUTH', 'ACCEPTED', 'REFUSED'],
  ['databaseConfigured', 'DATABASE', 'CONFIGURED', 'NOT CONFIGURED'],
  ['databaseReachable', 'DB REACH', 'YES', 'NO'],
  ['voiceConfigured', 'VOICE', 'CONFIGURED', 'NOT CONFIGURED'],
  ['ownerAuthConfigured', 'OWNER AUTH', 'SET', 'UNSET'],
]

/** States in which RAVEN is working on an answer right now. */
const WORKING_STATES = new Set([
  'LISTENING',
  'THINKING',
  'UNDERSTANDING',
  'RESEARCHING',
  'REASONING',
  'PLANNING',
  'WAITING',
  'EXECUTING',
  'VERIFYING',
])

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
}

export default function RavenConsole() {
  const [inputText, setInputText] = useState('')
  const [notice, setNotice] = useState('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const {
    state,
    isOnline,
    healthMessage,
    health,
    healthCheckedAt,
    isCheckingHealth,
    messages,
    isListening,
    isVoiceOutputEnabled,
    checkBackendHealth,
    ensureWelcomeMessage,
    sendMessage,
    setIsListening,
    toggleVoiceOutput,
  } = useRavenStore()

  useEffect(() => {
    ensureWelcomeMessage()
    checkBackendHealth()
  }, [checkBackendHealth, ensureWelcomeMessage])

  // Abandon the microphone if the console unmounts, otherwise the recognizer
  // keeps the input device open for the rest of the session.
  useEffect(
    () => () => {
      const recognition = recognitionRef.current
      recognitionRef.current = null
      if (!recognition) return
      try {
        recognition.onresult = null
        recognition.onend = null
        recognition.onerror = null
        recognition.abort()
      } catch {
        /* already finished */
      }
    },
    [],
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, state])

  // Cmd/Ctrl+K focuses the prompt. Registered on the window but ignored while the
  // user is typing in another field (a modal, the console itself) so it can never
  // hijack typing elsewhere on the page.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typingElsewhere =
        !!target &&
        target !== inputRef.current &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !typingElsewhere) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const [busy, setBusy] = useState(false)

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputText.trim() || busy) return
    const text = inputText
    setInputText('')
    setBusy(true)
    try {
      await sendMessage(text)
    } finally {
      setBusy(false)
    }
  }

  // Web Speech Recognition — browser-native, local, no voice API key required.
  const toggleSpeechRecognition = () => {
    if (typeof window === 'undefined') return

    if (isListening) {
      const active = recognitionRef.current
      recognitionRef.current = null
      try {
        active?.stop()
      } catch {
        /* ignore */
      }
      setIsListening(false)
      return
    }

    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition

    if (!Ctor) {
      setNotice('Speech recognition is not available in this browser. Type your question instead — no microphone or voice service is required.')
      return
    }

    setNotice('')
    try {
      const recognition = new Ctor()
      recognitionRef.current = recognition
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'

      recognition.onstart = () => setIsListening(true)
      recognition.onend = () => {
        setIsListening(false)
        recognitionRef.current = null
      }
      recognition.onerror = (event) => {
        setIsListening(false)
        recognitionRef.current = null
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          setNotice('Microphone access was blocked. Allow it in the browser prompt to use voice input, or keep typing.')
        } else if (event?.error === 'no-speech') {
          setNotice('No speech detected. Try again or type your question.')
        } else {
          setNotice('Voice input failed. Typing still works.')
        }
      }
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript
        if (transcript) {
          setInputText(transcript)
          void sendMessage(transcript)
        }
      }

      recognition.start()
    } catch {
      recognitionRef.current = null
      setIsListening(false)
      setNotice('Voice input could not start. Typing still works.')
    }
  }

  return (
    <div className="w-full max-w-[440px] mx-auto rounded-2xl p-5 sm:p-6 raven-console-panel border border-[rgba(0,229,255,0.20)] backdrop-blur-xl shadow-2xl space-y-4 font-sans">
      {/* Console Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isOnline ? 'bg-cyan-400 animate-ping absolute opacity-75' : 'bg-amber-400'
              }`}
            />
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isOnline ? 'bg-cyan-400 shadow-[0_0_10px_#00e5ff]' : 'bg-amber-400'
              }`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="mono text-xs font-bold text-cyan-400 tracking-wider">
                RAVEN CONSOLE
              </span>
              <span className="text-[10px] mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                {state}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">{healthMessage}</p>
          </div>
        </div>

        {/* Audio Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleVoiceOutput}
            className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1.5 ${
              isVoiceOutputEnabled
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                : 'border-gray-800 bg-black/40 text-gray-400'
            }`}
            title="Toggle Voice Output"
          >
            {isVoiceOutputEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span className="hidden sm:inline mono text-[10px]">
              {isVoiceOutputEnabled ? 'VOICE ON' : 'MUTED'}
            </span>
          </button>

          <button
            onClick={toggleSpeechRecognition}
            className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1.5 ${
              isListening
                ? 'border-lime-500 bg-lime-500/20 text-lime-300 animate-pulse'
                : 'border-gray-800 bg-black/40 text-gray-400 hover:border-gray-700'
            }`}
            title="Toggle Speech Input"
          >
            {isListening ? <Mic size={14} /> : <MicOff size={14} />}
            <span className="hidden sm:inline mono text-[10px]">
              {isListening ? 'LISTENING' : 'MIC'}
            </span>
          </button>
        </div>
      </div>

      {/* Measured capability flags, refreshed on demand */}
      <div className="flex flex-wrap items-center gap-1.5 -mt-1">
        {isCheckingHealth ? (
          <span className="text-[10px] mono px-2 py-0.5 rounded border border-white/10 bg-black/40 text-gray-400">
            PROBING BACKEND…
          </span>
        ) : health ? (
          <>
            <span
              className={`text-[10px] mono px-2 py-0.5 rounded border ${
                health.status === 'PARTIALLY_READY'
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              }`}
            >
              STATUS: {health.status}
            </span>
            {CAPABILITY_FLAGS.filter(([key]) => !(key === 'providerAuthorized' && health[key] === null)).map(([key, label, on, off]) => {
              const value = Boolean(health[key])
              return (
                <span
                  key={key}
                  title={`/api/health reported ${String(key)} = ${String(health[key])}`}
                  className={`text-[10px] mono px-2 py-0.5 rounded border ${
                    value ? 'border-lime-500/30 bg-lime-500/10 text-lime-300' : 'border-white/10 bg-black/40 text-gray-500'
                  }`}
                >
                  {label}: {value ? on : off}
                </span>
              )
            })}
          </>
        ) : (
          <span className="text-[10px] mono px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-200">
            PROBE FAILED: /api/health gave no payload
          </span>
        )}

        <button
          type="button"
          onClick={() => void checkBackendHealth()}
          className="text-[10px] mono px-2 py-0.5 rounded border border-cyan-500/20 text-cyan-300/80 hover:text-cyan-200 hover:border-cyan-400/40 transition-colors"
          title={healthCheckedAt ? `Last probe at ${healthCheckedAt}` : 'Query /api/health again'}
        >
          RE-PROBE{healthCheckedAt ? ` · ${healthCheckedAt}` : ''}
        </button>
      </div>

      {/* Offline Mode Notice */}
      {!isOnline && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2 text-xs text-amber-200/90 font-sans">
          <Info size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-300">Truthful Local Engine Active:</span> RAVEN answers queries directly using Riyan Pasha&apos;s siteConfig knowledge base. Configure <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300">RAVEN_API_KEY</code> in <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300">.env.local</code> for live LLM backend.
          </div>
        </div>
      )}

      {notice && (
        <div
          className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-start gap-2 text-xs text-cyan-100/90 font-sans"
          role="status"
        >
          <Info size={15} className="text-cyan-400 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* Message Feed */}
      <div
        className="max-h-[42vh] min-h-[180px] sm:max-h-[300px] overflow-y-auto space-y-3.5 pr-2 custom-scrollbar"
        aria-live="polite"
        aria-label="Conversation with RAVEN"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              {msg.sender === 'raven' ? (
                <span className="flex items-center gap-1 text-[11px] mono text-cyan-400">
                  <Bot size={13} /> RAVEN AI
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] mono text-lime-400">
                  <User size={13} /> YOU
                </span>
              )}
              <span className="text-[10px] text-gray-500 mono">{msg.timestamp}</span>
            </div>

            <div
              className={`p-3 rounded-xl max-w-[90%] text-xs sm:text-sm leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-lime-500/10 border border-lime-500/30 text-lime-100 rounded-tr-none'
                  : 'bg-black/60 border border-[rgba(0,229,255,0.20)] text-white rounded-tl-none shadow-md'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>

              {msg.toolUsed && (
                <div className="mt-2 pt-2 border-t border-cyan-500/20 flex items-center gap-1 text-[10px] mono text-cyan-400/80">
                  <Terminal size={11} />
                  <span>Executed: {msg.toolUsed}</span>
                </div>
              )}

              {/* Evidence, not decoration. Both blocks only exist when the server actually
                  returned them, and they are collapsed by design: a source list you have to
                  ask for is still a source list, while one that dominates the bubble turns
                  the console into a debug panel again. */}
              {msg.sources?.length ? (
                <div className="mt-2 pt-2 border-t border-cyan-500/15 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] mono text-gray-500 mr-0.5">SOURCES</span>
                  {msg.sources.map((source, index) => (
                    <span
                      key={`${source}-${index}`}
                      className="text-[10px] mono px-1.5 py-0.5 rounded border border-cyan-500/20 bg-cyan-500/5 text-cyan-300/90"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              ) : null}

              {msg.trace?.length ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer list-none text-[10px] mono text-gray-500 hover:text-cyan-300 transition-colors">
                    what ran · {msg.trace.length} phase{msg.trace.length === 1 ? '' : 's'}
                  </summary>
                  <ol className="mt-1.5 space-y-0.5 pl-4 list-decimal text-[10px] mono text-gray-400/90">
                    {msg.trace.map((line, index) => (
                      <li key={`${line}-${index}`}>{line}</li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
          </div>
        ))}
        {busy || WORKING_STATES.has(state) ? (
          <div className="flex items-center gap-2 text-[11px] mono text-cyan-400/80">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="w-1.5 h-1.5 rounded-full bg-cyan-400/70 animate-pulse"
                  style={{ animationDelay: `${dot * 140}ms` }}
                />
              ))}
            </span>
            <span>RAVEN · {state.toLowerCase().replace(/_/g, ' ')}</span>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Action Chips */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {[
          "What has Riyan built?",
          "What technologies does Riyan use?",
          "Tell me about Riyan.",
          "How can I contact Riyan?",
        ].map((chip) => (
          <button
            key={chip}
            onClick={() => sendMessage(chip)}
            className="text-[11px] font-sans px-3 py-1 rounded-full bg-black/40 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 transition-all text-left"
          >
            + {chip}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="relative flex items-center gap-2 pt-1">
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setInputText('')
              inputRef.current?.blur()
            }
          }}
          aria-label="Message RAVEN"
          placeholder="Ask RAVEN about Riyan's work or tech... (Ctrl/Cmd+K)"
          className="flex-1 bg-black/70 border border-cyan-500/30 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition-all font-sans"
        />

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-semibold px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(0,229,255,0.4)]"
        >
          <Send size={14} />
          <span className="hidden sm:inline text-xs mono font-bold">SEND</span>
        </button>
      </form>
    </div>
  )
}
