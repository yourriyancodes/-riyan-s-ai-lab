import { useEffect, useState } from 'react'
import { useLab, type ViewKey } from '../store/useLab'
import { profile } from '../data/portfolio'

const NAV: { label: string; view: ViewKey }[] = [
  { label: 'AI', view: 'ai' },
  { label: 'DATA', view: 'data' },
  { label: 'SOFTWARE', view: 'software' },
  { label: 'WORK', view: 'projects' },
  { label: 'CONTACT', view: 'contact' },
]

const VIEW_TITLES: Record<ViewKey, string> = {
  lab: 'TECH UNIVERSE · THE CORE',
  ai: 'WORLD 01 · ARTIFICIAL INTELLIGENCE',
  data: 'WORLD 02 · DATA',
  software: 'WORLD 03 · SOFTWARE',
  mobile: 'WORLD 04 · MOBILE',
  web: 'WORLD 05 · WEB',
  cloud: 'WORLD 06 · CLOUD',
  automation: 'WORLD 07 · AUTOMATION',
  experiments: 'WORLD 08 · EXPERIMENTS',
  projects: 'PROJECTS · GALLERY',
  project: 'PROJECT · CASE STUDY',
  experience: 'EXPERIENCE · CAREER PATH',
  education: 'EDUCATION',
  contact: 'CONTACT',
}

export default function HUD() {
  const booted = useLab((s) => s.booted)
  const view = useLab((s) => s.view)
  const setView = useLab((s) => s.setView)
  const setMenuOpen = useLab((s) => s.setMenuOpen)
  const mode = useLab((s) => s.mode)
  const setMode = useLab((s) => s.setMode)
  const [hintHidden, setHintHidden] = useState(false)
  const [interacted, setInteracted] = useState(false)

  useEffect(() => {
    if (!booted) return
    const t = setTimeout(() => setHintHidden(true), 9000)
    const onAny = () => setInteracted(true)
    window.addEventListener('pointerdown', onAny, { once: true })
    window.addEventListener('wheel', onAny, { once: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onAny)
      window.removeEventListener('wheel', onAny)
    }
  }, [booted])

  if (!booted) return null

  const showScrollHint = view === 'lab' && !hintHidden && !interacted

  return (
    <>
      {/* top-left identity */}
      <header className="pointer-events-none fixed left-4 top-4 z-30 md:left-6 md:top-6">
        <button onClick={() => setView('lab')} className="pointer-events-auto group text-left" aria-label="Return to the core">
          <div className="flex items-center gap-2.5">
            <span className="block h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_rgba(45,211,145,0.9)]" />
            <span className="font-display text-sm font-semibold tracking-[0.22em] text-snow group-hover:text-accent transition-colors">
              {profile.name.toUpperCase()}
            </span>
            <span className="hidden border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.24em] text-accent md:block">
              {profile.brand}
            </span>
          </div>
          <div className="mt-1 pl-4.5 font-mono text-[9px] tracking-[0.3em] text-fog">
            TECHNOLOGIST · BUILDER
          </div>
        </button>
      </header>

      {/* top-right controls */}
      <div className="fixed right-4 top-4 z-30 flex items-center gap-2 md:right-6 md:top-6">
        <button
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          className="glass flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-snow/80 transition-all hover:border-accent/40 hover:text-accent"
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {mode === 'dark' ? (
            /* sun */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
            </svg>
          ) : (
            /* moon */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setMenuOpen(true)}
          className="glass cursor-pointer rounded-full px-4 py-2 font-mono text-[10px] tracking-[0.3em] text-snow/85 transition-all hover:border-accent/40 hover:text-accent"
        >
          MENU
        </button>
      </div>

      {/* current sector readout */}
      <div className="pointer-events-none fixed left-1/2 top-5 z-20 hidden -translate-x-1/2 md:block">
        <div className="font-mono text-[9px] tracking-[0.4em] text-fog/70">{VIEW_TITLES[view]}</div>
      </div>

      {/* bottom navigation */}
      <nav className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 md:bottom-6" aria-label="Primary">
        <div className="glass flex items-center gap-1 rounded-full px-2 py-1.5">
          {NAV.map((n) => {
            const active = view === n.view || (n.view === 'projects' && view === 'project')
            return (
              <button
                key={n.label}
                onClick={() => setView(n.view)}
                className={`relative cursor-pointer rounded-full px-3 py-1.5 font-mono text-[9px] tracking-[0.22em] transition-all md:text-[10px] ${
                  active ? 'text-accent' : 'text-fog hover:text-snow'
                }`}
              >
                {n.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-px bg-accent shadow-[0_0_8px_rgba(45,211,145,0.8)]" />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* scroll hint */}
      <div
        className={`pointer-events-none fixed bottom-14 left-1/2 z-20 -translate-x-1/2 transition-opacity duration-700 md:bottom-20 ${
          showScrollHint ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[9px] tracking-[0.4em] text-fog/80">SCROLL TO EXPLORE</span>
          <span className="relative block h-8 w-px overflow-hidden bg-line">
            <span
              className="absolute left-0 top-0 h-full w-full bg-accent"
              style={{ animation: 'scrollHint 1.8s cubic-bezier(0.65,0,0.35,1) infinite' }}
            />
          </span>
        </div>
      </div>
    </>
  )
}
