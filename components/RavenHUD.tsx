'use client'

import { Eye } from 'lucide-react'
import type { VisionStatus } from '@/lib/ravenStore'

type RavenHUDProps = {
  state: string
  visionEnabled: boolean
  visionStatus?: VisionStatus
  visionMessage?: string
  facePresent: boolean
  isOnline?: boolean
  onToggleVision: () => void
  onCycleState: () => void
  /** What the 3D stage measured about its own assembly. Hover-only, never on screen. */
  modelDetail?: string
}

/**
 * Labels are derived from the *measured* vision status, never from the toggle,
 * so the HUD cannot advertise a camera that failed, was denied, or is unsupported.
 */
const VISION_LABELS: Record<VisionStatus, string> = {
  OFFLINE: 'VISION OFFLINE',
  STARTING: 'VISION STARTING',
  SEARCHING: 'VISION SEARCHING',
  LOCKED: 'VISION LOCKED',
  RECOVERING: 'VISION RECOVERING',
  UNAVAILABLE: 'VISION UNAVAILABLE',
  UNSUPPORTED: 'VISION UNSUPPORTED',
}

/**
 * The portrait is the interface.
 *
 * This used to carry a bottom rail of live telemetry — mode, mesh count, gaze source —
 * under RAVEN's chin. Every token in it was measured rather than decorative, which is a
 * good property for a diagnostic and a bad one for a portrait: the eye landed on the
 * text instead of on the face. What stays visible at rest is one pill (identity, presence,
 * state) and nothing else; the controls fade in when the stage is hovered or focused, so
 * the camera toggle and the state cycle are still reachable, still labelled, and never
 * competing with the bust for the same square centimetre.
 */
export default function RavenHUD({
  state,
  visionEnabled,
  visionStatus = 'OFFLINE',
  visionMessage = '',
  facePresent,
  isOnline = false,
  onToggleVision,
  onCycleState,
  modelDetail = '',
}: RavenHUDProps) {
  // facePresent is only trustworthy while a lock is actually held.
  const locked = visionStatus === 'LOCKED' && facePresent
  const label = locked ? VISION_LABELS.LOCKED : VISION_LABELS[visionStatus] ?? 'VISION OFFLINE'
  const degraded = visionStatus === 'UNAVAILABLE' || visionStatus === 'UNSUPPORTED'

  return (
    <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-start z-20 font-sans">
      <div className="flex items-start justify-between w-full gap-3">
        <div
          className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-black/60 border border-cyan-500/20 backdrop-blur-md text-xs"
          title={modelDetail || undefined}
        >
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="mono font-bold text-white tracking-wider">RAVEN</span>
          <span className="text-gray-500">•</span>
          <span className={`mono text-[11px] ${isOnline ? 'text-cyan-300' : 'text-amber-300/80'}`}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
          <span className="text-gray-500">•</span>
          <span className="mono text-[11px] text-cyan-300 uppercase">{state}</span>
        </div>

        {/* Reachable, not shouty: the controls live in the same corner as the identity
            pill and only appear when someone is actually pointing at the stage. The
            `hover:none` clause is not decoration — Tailwind gates `group-hover:` behind
            `@media (hover:hover)`, so a phone has no way to reveal these at all, and a
            control that cannot be reached is a feature that was removed. */}
        <div className="opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 flex items-center gap-2">
          <button
            onClick={onToggleVision}
            title={visionMessage || (visionEnabled ? 'Camera tracking on' : 'Camera tracking off')}
            className={`pointer-events-auto px-3 py-1.5 rounded-full border text-xs mono flex items-center gap-1.5 transition-all ${
              degraded
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : locked
                  ? 'border-lime-500/50 bg-lime-500/10 text-lime-300 shadow-[0_0_15px_rgba(184,255,0,0.2)]'
                  : visionEnabled
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300 shadow-[0_0_15px_rgba(0,229,255,0.2)]'
                    : 'border-white/10 bg-black/40 text-gray-400 hover:text-white'
            }`}
            aria-label="Toggle Camera Tracking"
            aria-pressed={visionEnabled}
          >
            <Eye size={13} />
            <span>{label}</span>
          </button>

          <button
            onClick={onCycleState}
            className="pointer-events-auto px-3 py-1.5 rounded-full border border-white/10 bg-black/40 text-xs mono uppercase tracking-wider text-cyan-300 transition-colors hover:border-cyan-500/40 hover:text-white"
          >
            Interact
          </button>
        </div>
      </div>
    </div>
  )
}
