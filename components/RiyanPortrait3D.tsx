'use client'

import { useState, type PointerEvent } from 'react'
import Image from 'next/image'
import { ShieldCheck, Sparkles, User, Terminal } from 'lucide-react'

export default function RiyanPortrait3D() {
  const [rotate, setRotate] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5

    setRotate({
      x: -py * 16, // Rotate X up/down
      y: px * 20,  // Rotate Y left/right
    })
  }

  const handlePointerLeave = () => {
    setIsHovered(false)
    setRotate({ x: 0, y: 0 })
  }

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={handlePointerLeave}
      className="relative group perspective-1000 w-full max-w-md mx-auto"
    >
      <div
        className="relative transition-transform duration-200 ease-out transform-gpu rounded-2xl overflow-hidden glass-panel-glow p-4 sm:p-6"
        style={{
          transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) scale3d(${isHovered ? 1.02 : 1}, ${isHovered ? 1.02 : 1}, 1)`,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Layer 1: Background Cybernetic Depth Glow */}
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-950/40 via-transparent to-lime-950/30 opacity-70 group-hover:opacity-100 transition-opacity" />

        {/* Layer 2: Main Image Frame with 3D Offset */}
        <div
          className="relative w-full aspect-[4/5] rounded-xl overflow-hidden border border-cyan-500/30 shadow-2xl transition-transform duration-300"
          style={{ transform: 'translateZ(25px)' }}
        >
          <Image
            src="/riyan-portrait.png"
            alt="Riyan Pasha — Technologist & Developer"
            fill
            className="object-cover object-center filter contrast-[1.05] brightness-95 group-hover:scale-105 transition-transform duration-700"
            priority
          />

          {/* Dark Vignette Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#05070a] via-transparent to-transparent opacity-80" />

          {/* Glowing Border Line */}
          <div className="absolute inset-0 border border-cyan-400/20 rounded-xl pointer-events-none group-hover:border-cyan-400/50 transition-colors" />
        </div>

        {/* Layer 3: Floating Identity Badge (Pushed forward in Z-space) */}
        <div
          className="mt-4 p-4 rounded-xl bg-black/70 border border-cyan-500/20 backdrop-blur-md transition-transform duration-300 space-y-2"
          style={{ transform: 'translateZ(40px)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User size={15} className="text-cyan-400" />
              <span className="mono text-xs font-bold text-white tracking-wider">RIYAN PASHA</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-lime-500/10 text-lime-400 mono border border-lime-500/20">
              CREATOR / BUILDER
            </span>
          </div>

          <p className="text-xs text-gray-300 leading-relaxed font-sans">
            TECHNOLOGIST · DEVELOPER · PROBLEM SOLVER · BUILDER
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {['AI', 'Agentic AI', 'RAG', 'Data', 'Systems'].map((tag) => (
              <span key={tag} className="text-[10px] mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/20">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
