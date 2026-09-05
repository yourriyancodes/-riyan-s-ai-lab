'use client'

import { Eye } from 'lucide-react'

type RavenHUDProps = {
  state: string
  visionEnabled: boolean
  facePresent: boolean
  isOnline?: boolean
  onToggleVision: () => void
  onCycleState: () => void
}

export default function RavenHUD({
  state,
  visionEnabled,
  facePresent,
  isOnline = false,
  onToggleVision,
  onCycleState,
}: RavenHUDProps) {
  return (
    <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between z-20 font-sans">
      {/* Top Bar: De-cluttered Minimal Status Pill */}
      <div className="flex items-center justify-between w-full">
        <div className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-black/60 border border-cyan-500/20 backdrop-blur-md text-xs">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="mono font-bold text-white tracking-wider">RAVEN</span>
          <span className="text-gray-500">•</span>
          <span className="mono text-[11px] text-cyan-300 uppercase">{state}</span>
        </div>

        <button
          onClick={onToggleVision}
          className={`pointer-events-auto px-3 py-1.5 rounded-full border text-xs mono flex items-center gap-1.5 transition-all ${
            visionEnabled
              ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300 shadow-[0_0_15px_rgba(0,229,255,0.2)]'
              : 'border-white/10 bg-black/40 text-gray-400 hover:text-white'
          }`}
          aria-label="Toggle Camera Tracking"
        >
          <Eye size={13} />
          <span>{visionEnabled ? (facePresent ? 'CAMERA: LOCKED' : 'CAMERA: SEARCHING') : 'CAMERA'}</span>
        </button>
      </div>

      {/* Bottom Bar: Quiet Interaction Hint */}
      <div className="flex items-center justify-between w-full text-[11px] mono text-gray-500">
        <span>MODE: {isOnline ? 'LIVE LLM' : 'LOCAL ENGINE'}</span>
        <button
          onClick={onCycleState}
          className="pointer-events-auto text-cyan-400/80 hover:text-cyan-300 transition-colors uppercase tracking-wider"
        >
          INTERACT →
        </button>
      </div>
    </div>
  )
}
