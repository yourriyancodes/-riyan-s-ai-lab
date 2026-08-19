import { useEffect, useRef, useState } from 'react'
import PanelShell from './PanelShell'
import { useLab } from '../store/useLab'
import { experiments } from '../data/portfolio'
import { retrieveAnswer, SUGGESTED_QUESTIONS } from '../data/knowledge'

type Tab = 'EXPERIMENTS' | 'ASK MY PORTFOLIO'

const STATUS_STYLE: Record<string, string> = {
  PROTOTYPE: 'text-accent border-accent/40 bg-accent/10',
  EXPLORING: 'text-w-experiments border-w-experiments/30 bg-w-experiments/5',
  ACTIVE: 'text-snow border-snow/30 bg-snow/5',
}

/** WORLD 08 · EXPERIMENTS — floating modules + the verified portfolio assistant. */
export default function ExperimentsPanel() {
  const [tab, setTab] = useState<Tab>('EXPERIMENTS')

  return (
    <PanelShell label="WORLD 08 · EXPERIMENTS" wide>
      <div className="anim-fade-up">
        <div className="flex items-center gap-1.5">
          {(['EXPERIMENTS', 'ASK MY PORTFOLIO'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded-full px-3 py-1 font-mono text-[9px] tracking-[0.2em] transition-all ${
                tab === t
                  ? 'border border-accent/40 bg-accent/15 text-accent'
                  : 'border border-line/60 text-fog hover:text-snow'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'EXPERIMENTS' ? <ExperimentsBody /> : <AssistantBody active />}
      </div>
    </PanelShell>
  )
}

/* ------------------------------------------------------------------ */
/*  EXPERIMENTS BODY                                                   */
/* ------------------------------------------------------------------ */
function ExperimentsBody() {
  const selected = useLab((s) => s.experiment)
  const setExperiment = useLab((s) => s.setExperiment)

  return (
    <div className="mt-4">
      <p className="font-mono text-[10px] tracking-[0.22em] text-accent">
        "EXPERIMENTS, PROTOTYPES AND IDEAS I'M EXPLORING."
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-fog">
        Research modules float above this station. Select one in the
        environment — or below — to inspect it.
      </p>

      <ul className="mt-4 space-y-2">
        {experiments.map((e) => {
          const isSel = selected === e.id
          return (
            <li key={e.id}>
              <button
                onClick={() => setExperiment(isSel ? null : e.id)}
                className={`w-full cursor-pointer rounded-lg border p-3.5 text-left transition-all ${
                  isSel
                    ? 'border-accent/50 bg-accent/8 shadow-[0_0_24px_rgba(45,211,145,0.12)]'
                    : 'border-line/60 bg-ink/30 hover:border-accent/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9.5px] tracking-[0.2em] text-fog">
                    {e.code} · {e.name}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.18em] ${STATUS_STYLE[e.status]}`}>
                    {e.status}
                  </span>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-snow/70">{e.desc}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {e.stack.map((s) => (
                    <span key={s} className="tech-chip">{s}</span>
                  ))}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ASSISTANT BODY — ASK MY PORTFOLIO                                  */
/* ------------------------------------------------------------------ */
interface Message {
  role: 'user' | 'ai'
  text: string
  source?: string
  done?: boolean
}

const WELCOME: Message = {
  role: 'ai',
  text: 'Hello. I am the portfolio assistant — a retrieval agent wired to Riyan\'s verified data. Ask me about his worlds, projects, skills, Android work, RAG systems and more. I only answer from the portfolio database; I never invent facts.',
  source: 'SYSTEM.DB',
  done: true,
}

function AssistantBody({ active }: { active?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(SUGGESTED_QUESTIONS)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => inputRef.current?.focus(), 500)
      return () => clearTimeout(t)
    }
  }, [active])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  const ask = (raw: string) => {
    const q = raw.trim()
    if (!q || typing) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: q, done: true }])
    setTyping(true)
    setTimeout(() => {
      const hit = retrieveAnswer(q)
      const answer = hit
        ? hit.entry.answer
        : `I couldn't map that to verified portfolio data. Ask me about:\n${SUGGESTED_QUESTIONS.map((s) => `- ${s}`).join('\n')}`
      const source = hit ? hit.entry.source : 'NO MATCH'
      setMessages((m) => [...m, { role: 'ai', text: answer, source }])
      setTyping(false)
    }, 420)
  }

  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-lg border border-[#2a3b34] bg-[#0b0f0d]">
        <div className="flex items-center justify-between border-b border-line/70 px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#2a2530]" />
            <span className="h-2 w-2 rounded-full bg-[#2a2530]" />
            <span className="h-2 w-2 rounded-full bg-accent/70" />
            <span className="ml-2 font-mono text-[9px] tracking-[0.2em] text-[#8ba598]">
              PORTFOLIO-ASSISTANT · v1.0
            </span>
          </div>
          <span className="font-mono text-[8px] tracking-[0.2em] text-[#2dd391]/90">
            RETRIEVAL MODE · VERIFIED DATA ONLY
          </span>
        </div>

        <div className="relative">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#2dd391]/10 to-transparent"
            style={{ animation: 'terminalScan 4.5s linear infinite' }}
          />
          <div ref={scrollRef} className="h-[240px] space-y-3 overflow-y-auto px-3.5 py-3 md:h-[280px]">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[92%] rounded-md px-3 py-2 text-left font-mono text-[11px] leading-relaxed ${
                    m.role === 'user'
                      ? 'border border-[#2dd391]/30 bg-[#2dd391]/10 text-[#7ff0c8]'
                      : 'border border-[#2a3b34] bg-white/[0.03] text-[#e8efe9]'
                  }`}
                >
                  {m.role === 'user' ? (
                    <>
                      <span className="mr-1.5 text-[#2dd391]">❯</span>
                      {m.text}
                    </>
                  ) : (
                    <>
                      <span className="mb-1 block text-[8.5px] tracking-[0.2em] text-[#8ba598]/70">[ {m.source} ]</span>
                      <span className="whitespace-pre-line">{m.text}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="inline-block rounded-md border border-[#2a3b34] bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-[#8ba598]">
                <span className="cursor-blink">▊</span> thinking…
              </div>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="flex items-center gap-2 border-t border-line/70 px-3.5 py-2.5"
        >
          <span className="font-mono text-[11px] text-[#2dd391]">riyaN@tech-king:~$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Riyan's work…"
            className="flex-1 bg-transparent font-mono text-[11px] text-[#e8efe9] placeholder:text-[#8ba598]/40 focus:outline-none"
            aria-label="Ask the portfolio assistant"
            autoComplete="off"
          />
          <button
            type="submit"
            className="cursor-pointer rounded border border-[#2dd391]/40 px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] text-[#2dd391] transition-all hover:bg-[#2dd391]/10"
          >
            ASK
          </button>
        </form>
      </div>

      <div className="mt-3">
        <span className="tech-label">SUGGESTED QUERIES</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="cursor-pointer rounded-full border border-[#2a3b34] px-2.5 py-1 font-mono text-[9px] tracking-[0.06em] text-[#8ba598] transition-all hover:border-[#2dd391]/60 hover:text-[#2dd391]"
            >
              {s}
            </button>
          ))}
        </div>
        <p className="mt-3 border-t border-[#2a3b34] pt-2.5 font-mono text-[8.5px] leading-relaxed tracking-[0.14em] text-[#8ba598]/60">
          INTEGRITY PROTOCOL: THIS ASSISTANT RETRIEVES FROM THE PORTFOLIO
          DATABASE ONLY. IT WILL NEVER INVENT EXPERIENCE, PROJECTS, METRICS,
          CERTIFICATIONS OR ACHIEVEMENTS.
        </p>
      </div>
    </div>
  )
}
