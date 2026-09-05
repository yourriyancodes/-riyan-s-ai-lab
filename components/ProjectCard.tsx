'use client'

import { useState, type PointerEvent } from 'react'
import { ArrowUpRight, Cpu, Database, Eye, Network, BookOpen } from 'lucide-react'
import { siteConfig } from '@/data/siteConfig'

export type ProjectItem = (typeof siteConfig.projects)[number]

type ProjectCardProps = {
  project: ProjectItem
  index: number
  onSelect: (project: ProjectItem) => void
}

export default function ProjectCard({ project, index, onSelect }: ProjectCardProps) {
  const [rotate, setRotate] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5

    setRotate({
      x: -py * 12,
      y: px * 14,
    })
  }

  const handlePointerLeave = () => {
    setIsHovered(false)
    setRotate({ x: 0, y: 0 })
  }

  // Render project-specific visual technology node icon
  const renderTechGraphic = (tech: string) => {
    if (tech.includes('RETRIEVAL') || tech.includes('RAG')) {
      return (
        <div className="relative w-full h-24 rounded-lg bg-black/40 border border-cyan-500/20 overflow-hidden flex items-center justify-center p-3">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded bg-cyan-500/10 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
              <Database size={16} />
            </div>
            <div className="flex-1 h-0.5 bg-gradient-to-r from-cyan-400 to-lime-400 animate-pulse" />
            <div className="w-8 h-8 rounded bg-lime-500/10 border border-lime-400/40 flex items-center justify-center text-lime-300">
              <Network size={16} />
            </div>
          </div>
        </div>
      )
    }

    if (tech.includes('VISION') || tech.includes('ML')) {
      return (
        <div className="relative w-full h-24 rounded-lg bg-black/40 border border-cyan-500/20 overflow-hidden flex items-center justify-center">
          <div className="relative w-16 h-16 rounded-full border border-cyan-400/40 flex items-center justify-center animate-spin" style={{ animationDuration: '10s' }}>
            <Eye size={20} className="text-cyan-300" />
            <div className="absolute top-0 right-0 w-2 h-2 rounded-full bg-lime-400" />
          </div>
        </div>
      )
    }

    if (tech.includes('AGENTS')) {
      return (
        <div className="relative w-full h-24 rounded-lg bg-black/40 border border-violet-500/20 overflow-hidden flex items-center justify-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-400/40 flex items-center justify-center text-violet-300">
            <Cpu size={15} />
          </div>
          <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
            <Network size={15} />
          </div>
        </div>
      )
    }

    // Default Tech Visualization
    return (
      <div className="relative w-full h-24 rounded-lg bg-black/40 border border-gray-800 flex items-center justify-center p-3">
        <div className="flex items-center gap-2 text-xs mono text-cyan-400">
          <BookOpen size={16} />
          <span>{tech}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={handlePointerLeave}
      onClick={() => onSelect(project)}
      role="button"
      tabIndex={0}
      className="perspective-1000 cursor-pointer group"
    >
      <div
        className="glass-panel p-6 rounded-2xl transition-transform duration-200 ease-out transform-gpu space-y-4 h-full flex flex-col justify-between"
        style={{
          transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) scale3d(${isHovered ? 1.02 : 1}, ${isHovered ? 1.02 : 1}, 1)`,
          transformStyle: 'preserve-3d',
        }}
      >
        <div className="space-y-3">
          {/* Header Tag */}
          <div className="flex items-center justify-between">
            <span className="mono text-xs text-lime-400 font-bold">
              [{project.number}] {project.status}
            </span>
            <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500 group-hover:text-black transition-colors">
              <ArrowUpRight size={16} />
            </div>
          </div>

          {/* Project Title */}
          <h3 className="font-serif text-xl sm:text-2xl text-white group-hover:text-cyan-300 transition-colors">
            {project.name}
          </h3>

          <p className="text-xs text-gray-400 leading-relaxed font-sans line-clamp-3">
            {project.description}
          </p>
        </div>

        {/* Specialized Tech Visualization Graphic */}
        <div className="pt-2">
          {renderTechGraphic(project.technology)}
        </div>

        {/* Footer Technology Label */}
        <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[11px] mono text-gray-400">
          <span>{project.technology}</span>
          <span className="text-cyan-400/80 group-hover:underline">Inspect System →</span>
        </div>
      </div>
    </div>
  )
}
