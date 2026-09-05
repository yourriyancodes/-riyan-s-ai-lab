import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useLab } from '../store/useLab'
import { profile, worlds, WORLD_HUES } from '../data/portfolio'

/**
 * HERO — TECH KING over the core.
 * Deliberately width-limited (≤38vw on desktop) so the text block can never
 * reach the centre of the screen and collide with the 3D environment.
 */
export default function HeroPanel() {
  const setView = useLab((s) => s.setView)
  const root = useRef<HTMLDivElement>(null)
  const booted = useLab((s) => s.booted)
  const [term, setTerm] = useState(0)

  useEffect(() => {
    if (!root.current) return
    const els = root.current.querySelectorAll('[data-hero]')
    gsap.fromTo(
      els,
      { opacity: 0, y: 22 },
      { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: 'power3.out', delay: 0.15 },
    )
  }, [booted])

  useEffect(() => {
    const t = setInterval(() => setTerm((i) => (i + 1) % profile.heroFormula.length), 2600)
    return () => clearInterval(t)
  }, [])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10 flex items-center">
      <div className="pointer-events-auto ml-5 w-[calc(100vw-40px)] md:ml-[6vw] md:w-[min(500px,38vw)]">
        {/* status line — terminal prompt style */}
        <div data-hero className="mb-4 flex items-center gap-2.5">
          <span className="anim-pulse-dot block h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="font-mono text-[9px] tracking-[0.35em] text-accent md:text-[10px]">
            ❯ {profile.status}
          </span>
        </div>

        {/* identity */}
        <h1
          data-hero
          className="font-display text-[40px] font-bold leading-[1.02] tracking-[0.06em] text-snow md:text-[58px]"
        >
          RIYAN
          <span className="block text-[34px] md:text-[50px]">PASHA</span>
        </h1>

        {/* brand line — terminal bracket style */}
        <div data-hero className="mt-3.5 flex items-center gap-3">
          <span className="h-px w-8 bg-accent/60" />
          <span className="font-mono text-[11px] tracking-[0.4em] text-snow/90 md:text-[12px]">
            <span className="text-accent">[ </span>
            {profile.brand}
            <span className="text-accent"> ]</span>
          </span>
        </div>

        {/* rotating formula — colour-only highlight, no scale (avoids smearing) */}
        <div
          data-hero
          className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[10.5px] tracking-[0.16em] text-fog md:text-[11.5px]"
        >
          {profile.heroFormula.map((t, i) => (
            <span key={t} className="flex items-center gap-x-2">
              {i > 0 && <span className="text-fog/40">×</span>}
              <span
                className={`transition-colors duration-500 ${
                  i === term ? 'text-accent' : 'text-fog'
                }`}
              >
                {t}
              </span>
            </span>
          ))}
        </div>

        {/* statement */}
        <p data-hero className="mt-4 max-w-[420px] text-[13.5px] leading-relaxed text-snow/85 md:text-[14.5px]">
          {profile.tagline}
        </p>
        <p data-hero className="mt-2 max-w-[420px] font-mono text-[10.5px] leading-relaxed text-fog">
          “{profile.coreMessage}”
        </p>

        {/* actions */}
        <div data-hero className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setView('projects')}
            className="cursor-pointer rounded-full bg-accent px-6 py-2.5 font-mono text-[10px] font-medium tracking-[0.25em] text-ink transition-all hover:bg-snow"
          >
            EXPLORE MY WORK
          </button>
          <button
            onClick={() => setView('contact')}
            className="cursor-pointer rounded-full border border-line px-6 py-2.5 font-mono text-[10px] tracking-[0.25em] text-snow/85 transition-all hover:border-accent/60 hover:text-accent"
          >
            CONTACT ME
          </button>
        </div>

        {/* contact links */}
        <div data-hero className="mt-5 flex items-center gap-5 font-mono text-[10px] tracking-[0.22em]">
          <a href={profile.contact.github} target="_blank" rel="noreferrer" className="text-fog transition-colors hover:text-accent">
            GITHUB ↗
          </a>
          <a href={profile.contact.linkedin} target="_blank" rel="noreferrer" className="text-fog transition-colors hover:text-accent">
            LINKEDIN ↗
          </a>
          <a href={`mailto:${profile.contact.email}`} className="text-fog transition-colors hover:text-accent">
            EMAIL
          </a>
        </div>

        {/* the eight worlds — compact interactive map */}
        <div data-hero className="mt-6 hidden md:block">
          <span className="tech-label">EIGHT WORLDS · HOVER TO IDENTIFY · CLICK TO TRAVEL</span>
          <div className="mt-2.5 flex gap-4">
            {worlds.map((w) => (
              <button
                key={w.id}
                onClick={() => setView(w.id as never)}
                title={`WORLD ${w.index} · ${w.title}`}
                className="group flex cursor-pointer flex-col items-center gap-1"
                aria-label={`World ${w.index} ${w.title}`}
              >
                <span
                  className="block h-2.5 w-2.5 rounded-full transition-transform duration-200 group-hover:scale-150"
                  style={{ background: WORLD_HUES[w.id], boxShadow: `0 0 8px ${WORLD_HUES[w.id]}55` }}
                />
                <span className="font-mono text-[7px] tracking-[0.14em] text-fog/0 transition-colors duration-200 group-hover:text-fog/90">
                  {w.id.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* mobile: compact world dots row */}
        <div data-hero className="mt-5 flex flex-wrap gap-2.5 md:hidden">
          {worlds.map((w) => (
            <button
              key={w.id}
              onClick={() => setView(w.id as never)}
              aria-label={`World ${w.index} ${w.title}`}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line/70 px-2.5 py-1"
            >
              <span
                className="block h-1.5 w-1.5 rounded-full"
                style={{ background: WORLD_HUES[w.id] }}
              />
              <span className="font-mono text-[7.5px] tracking-[0.14em] text-fog">
                {w.id.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
