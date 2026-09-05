import { useLab } from '../store/useLab'
import { profile } from '../data/portfolio'

/**
 * Graceful DOM fallback for devices without WebGL — the portfolio content
 * stays fully usable behind a calm warm starfield instead of the 3D universe.
 */
export default function WebGLFallback() {
  const failed = useLab((s) => s.webglFailed)
  if (!failed) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 50% 38%, rgba(14,48,34,0.5), transparent 70%), radial-gradient(ellipse 90% 60% at 50% 110%, rgba(10,30,22,0.5), transparent 70%), #09090b',
        }}
      />
      {Array.from({ length: 90 }).map((_, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-snow/40"
          style={{
            left: `${(i * 37) % 100}%`,
            top: `${(i * 53) % 100}%`,
            width: i % 7 === 0 ? 2 : 1,
            height: i % 7 === 0 ? 2 : 1,
            opacity: 0.15 + ((i * 13) % 60) / 100,
          }}
        />
      ))}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.35em] text-fog/60">
        2D COMPATIBILITY MODE · FULL CONTENT AVAILABLE · {profile.name.toUpperCase()} · {profile.brand}
      </div>
    </div>
  )
}
