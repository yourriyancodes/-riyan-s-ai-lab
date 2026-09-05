import { useEffect, useState } from 'react'
import { useLab } from '../store/useLab'
import { profile } from '../data/portfolio'

const STAGES = ['3D ENVIRONMENT', 'TECHNOLOGY WORLDS', 'SYSTEM NETWORK', 'PORTFOLIO']

/**
 * Premium boot sequence: staged system checks, then a smooth hand-off
 * to the universe. Respects prefers-reduced-motion.
 */
export default function LoadingScreen({ onDone }: { onDone: () => void }) {
  const reducedMotion = useLab((s) => s.reducedMotion)
  const [stage, setStage] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (reducedMotion) {
      const t = setTimeout(onDone, 350)
      return () => clearTimeout(t)
    }
    const step = 430
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 1; i <= STAGES.length; i++) {
      timers.push(setTimeout(() => setStage(i), i * step))
    }
    timers.push(
      setTimeout(() => {
        setFading(true)
        timers.push(setTimeout(onDone, 750))
      }, STAGES.length * step + 480),
    )
    return () => timers.forEach(clearTimeout)
  }, [reducedMotion, onDone])

  const progress = Math.round((stage / STAGES.length) * 100)

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink transition-opacity duration-700 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
      aria-label="Loading the Tech Universe"
    >
      {/* core glyph */}
      <div className="relative mb-10 h-20 w-20">
        <div className="absolute inset-0 rounded-full border border-accent/40" />
        <div className="absolute inset-3 rounded-full border border-accent/20" />
        <div className="absolute inset-0 m-auto h-4 w-4 rounded-full bg-accent shadow-[0_0_30px_rgba(45,211,145,0.9)]" />
        <div className="absolute inset-0 rounded-full border border-accent/30 anim-pulse-dot" />
      </div>

      <h1 className="font-mono text-[11px] tracking-[0.45em] text-snow/90">
        INITIALIZING THE TECH UNIVERSE
      </h1>

      <div className="mt-8 w-72 max-w-[80vw]">
        <ul className="space-y-2.5 font-mono text-[11px] tracking-[0.18em]">
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={`flex items-center justify-between transition-colors duration-300 ${
                i < stage ? 'text-snow/80' : i === stage ? 'text-accent' : 'text-snow/25'
              }`}
            >
              <span>{s}</span>
              <span>{i < stage ? '✓' : i === stage ? '…' : '·'}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 h-px w-full bg-line">
          <div
            className="h-px bg-accent shadow-[0_0_12px_rgba(45,211,145,0.8)] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[9px] tracking-[0.3em] text-fog/60">
          <span>{profile.name.toUpperCase()} · {profile.brand}</span>
          <span>{String(progress).padStart(3, '0')}%</span>
        </div>
      </div>
    </div>
  )
}
