import { create } from 'zustand'
import { siteConfig } from '@/data/siteConfig'

export type RavenState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'REASONING'
  | 'SPEAKING'
  | 'ERROR'
  | 'OFFLINE'

export type ChatMessage = {
  id: string
  sender: 'user' | 'raven' | 'system'
  text: string
  timestamp: string
  toolUsed?: string
}

interface RavenStoreState {
  state: RavenState
  isOnline: boolean
  isCheckingHealth: boolean
  healthMessage: string
  messages: ChatMessage[]
  isListening: boolean
  isSpeaking: boolean
  isVoiceOutputEnabled: boolean
  isVisionEnabled: boolean
  facePresent: boolean
  depth: { x: number; y: number }
  
  // Actions
  setState: (state: RavenState) => void
  setIsOnline: (online: boolean) => void
  setHealthMessage: (msg: string) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  setIsListening: (listening: boolean) => void
  setIsSpeaking: (speaking: boolean) => void
  toggleVoiceOutput: () => void
  toggleVision: () => void
  setFacePresent: (present: boolean) => void
  setDepth: (depth: { x: number; y: number }) => void
  checkBackendHealth: () => Promise<void>
  sendMessage: (text: string) => Promise<void>
}

export const useRavenStore = create<RavenStoreState>((set, get) => ({
  state: 'IDLE',
  isOnline: false,
  isCheckingHealth: true,
  healthMessage: 'Checking RAVEN server state...',
  messages: [
    {
      id: 'welcome-1',
      sender: 'raven',
      text: "Greetings. I am RAVEN — Riyan Pasha's Autonomous Virtual Engineering Nexus. How may I assist your exploration today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ],
  isListening: false,
  isSpeaking: false,
  isVoiceOutputEnabled: true,
  isVisionEnabled: false,
  facePresent: false,
  depth: { x: 0, y: 0 },

  setState: (state) => set({ state }),
  setIsOnline: (isOnline) => set({ isOnline }),
  setHealthMessage: (healthMessage) => set({ healthMessage }),
  setIsListening: (isListening) => set({ isListening }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  toggleVoiceOutput: () => set((s) => ({ isVoiceOutputEnabled: !s.isVoiceOutputEnabled })),
  toggleVision: () => set((s) => ({ isVisionEnabled: !s.isVisionEnabled })),
  setFacePresent: (facePresent) => set({ facePresent }),
  setDepth: (depth) => set({ depth }),

  addMessage: (msg) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    set((state) => ({ messages: [...state.messages, newMsg] }))
  },

  checkBackendHealth: async () => {
    set({ isCheckingHealth: true })
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok' && data.apiKeyConfigured) {
          set({
            isOnline: true,
            healthMessage: 'RAVEN LLM Backend Online',
            isCheckingHealth: false,
          })
          return
        }
      }
      set({
        isOnline: false,
        healthMessage: 'Offline Mode: Local Knowledge Engine Active',
        isCheckingHealth: false,
      })
    } catch {
      set({
        isOnline: false,
        healthMessage: 'Offline Mode: Local Knowledge Engine Active',
        isCheckingHealth: false,
      })
    }
  },

  sendMessage: async (text: string) => {
    if (!text.trim()) return
    const { addMessage, setState, isOnline, isVoiceOutputEnabled } = get()

    // Add user message
    addMessage({ sender: 'user', text })
    setState('THINKING')

    try {
      let replyText = ''
      let toolUsed: string | undefined

      if (isOnline) {
        // Query server endpoint
        const res = await fetch('/api/raven', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        })
        if (res.ok) {
          const data = await res.json()
          replyText = data.reply || data.message
          toolUsed = data.toolUsed
        } else {
          throw new Error('API server error')
        }
      } else {
        // Fallback to local intelligent agent response tool
        const { processLocalQuery } = await import('@/lib/agentTools')
        const result = await processLocalQuery(text)
        replyText = result.reply
        toolUsed = result.toolUsed
      }

      setState('SPEAKING')
      addMessage({ sender: 'raven', text: replyText, toolUsed })

      // Trigger Web Speech API voice output if enabled
      if (isVoiceOutputEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(replyText)
        utterance.rate = 1.05
        utterance.pitch = 1.1

        // Attempt to find a female voice
        const voices = window.speechSynthesis.getVoices()
        const femaleVoice = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Female') ||
              v.name.includes('Samantha') ||
              v.name.includes('Zira') ||
              v.name.includes('Victoria') ||
              v.name.includes('Google US English'))
        )
        if (femaleVoice) utterance.voice = femaleVoice

        utterance.onend = () => {
          get().setIsSpeaking(false)
          get().setState('IDLE')
        }
        utterance.onerror = () => {
          get().setIsSpeaking(false)
          get().setState('IDLE')
        }

        get().setIsSpeaking(true)
        window.speechSynthesis.speak(utterance)
      } else {
        setTimeout(() => {
          setState('IDLE')
        }, 1500)
      }
    } catch {
      setState('ERROR')
      addMessage({
        sender: 'system',
        text: 'An error occurred while processing your request. Please try again.',
      })
      setTimeout(() => setState('IDLE'), 2000)
    }
  },
}))
