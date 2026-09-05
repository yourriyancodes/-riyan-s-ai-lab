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

export default function RavenConsole() {
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const {
    state,
    isOnline,
    healthMessage,
    messages,
    isListening,
    isVoiceOutputEnabled,
    checkBackendHealth,
    sendMessage,
    setIsListening,
    toggleVoiceOutput,
  } = useRavenStore()

  useEffect(() => {
    checkBackendHealth()
  }, [checkBackendHealth])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputText.trim()) return
    const text = inputText
    setInputText('')
    await sendMessage(text)
  }

  // Web Speech Recognition
  const toggleSpeechRecognition = () => {
    if (typeof window === 'undefined') return
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported by your browser.')
      return
    }

    if (isListening) {
      setIsListening(false)
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'

      recognition.onstart = () => setIsListening(true)
      recognition.onend = () => setIsListening(false)
      recognition.onerror = () => setIsListening(false)

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript
        if (transcript) {
          setInputText(transcript)
          sendMessage(transcript)
        }
      }

      recognition.start()
    } catch {
      setIsListening(false)
    }
  }

  return (
    <div className="w-full max-w-[440px] mx-auto rounded-2xl p-5 sm:p-6 bg-[rgba(8,11,16,0.82)] border border-[rgba(0,229,255,0.20)] backdrop-blur-xl shadow-2xl space-y-4 font-sans">
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
            <p className="text-[11px] text-[rgba(245,247,250,0.62)] mt-0.5">{healthMessage}</p>
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

      {/* Offline Mode Notice */}
      {!isOnline && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2 text-xs text-amber-200/90 font-sans">
          <Info size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-300">Truthful Local Engine Active:</span> RAVEN answers queries directly using Riyan Pasha&apos;s siteConfig knowledge base. Configure <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300">RAVEN_API_KEY</code> in <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300">.env.local</code> for live LLM backend.
          </div>
        </div>
      )}

      {/* Message Feed */}
      <div className="h-[260px] sm:h-[300px] overflow-y-auto space-y-3.5 pr-2 custom-scrollbar">
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
                  : 'bg-black/60 border border-[rgba(0,229,255,0.20)] text-[#F5F7FA] rounded-tl-none shadow-md'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>

              {msg.toolUsed && (
                <div className="mt-2 pt-2 border-t border-cyan-500/20 flex items-center gap-1 text-[10px] mono text-cyan-400/80">
                  <Terminal size={11} />
                  <span>Executed: {msg.toolUsed}</span>
                </div>
              )}
            </div>
          </div>
        ))}
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
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask RAVEN about Riyan's work or tech..."
          className="flex-1 bg-black/70 border border-cyan-500/30 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#F5F7FA] placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition-all font-sans"
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
