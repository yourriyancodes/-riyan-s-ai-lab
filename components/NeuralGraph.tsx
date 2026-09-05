'use client'

import { useState } from 'react'
import { Cpu, Sparkles, Network, Database, ShieldCheck, Zap } from 'lucide-react'
import { siteConfig } from '@/data/siteConfig'

type SkillNode = {
  id: string
  name: string
  category: string
  description: string
  x: number
  y: number
}

const SKILL_NODES: SkillNode[] = [
  { id: 'ai', name: 'AI Systems', category: 'Core', description: 'Autonomous agentic frameworks, reasoning loops, and model orchestration.', x: 50, y: 30 },
  { id: 'agentic', name: 'Agentic AI', category: 'Architecture', description: 'Systems that observe, plan, execute tools, and self-verify outcomes.', x: 25, y: 45 },
  { id: 'rag', name: 'RAG Architecture', category: 'Retrieval', description: 'Dense vector retrieval, contextual chunking, and grounded synthesis.', x: 75, y: 45 },
  { id: 'ml', name: 'Machine Learning', category: 'Intelligence', description: 'Supervised/unsupervised algorithms, model evaluation, and inference optimization.', x: 35, y: 70 },
  { id: 'dl', name: 'Deep Learning', category: 'Neural', description: 'Neural networks, transformer architectures, and embedding representations.', x: 65, y: 70 },
  { id: 'ds', name: 'Data Science', category: 'Analytics', description: 'Statistical modeling, signal extraction, and data-driven decision support.', x: 15, y: 75 },
  { id: 'vision', name: 'Computer Vision', category: 'Sensing', description: 'Real-time gesture detection, MediaPipe landmark tracking, and image models.', x: 85, y: 75 },
  { id: 'android', name: 'Android Engineering', category: 'Mobile', description: 'Performant mobile systems, native integration, and edge intelligence.', x: 40, y: 90 },
  { id: 'swe', name: 'Software Engineering', category: 'Systems', description: 'Full-stack architecture, clean code principles, and reliable execution.', x: 60, y: 90 },
]

export default function NeuralGraph() {
  const [selectedNode, setSelectedNode] = useState<SkillNode | null>(SKILL_NODES[0])

  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 sm:p-8 rounded-2xl relative overflow-hidden">
        {/* Ambient Spatial Background Grid */}
        <div className="absolute inset-0 bg-radial from-cyan-500/10 via-transparent to-transparent opacity-60 pointer-events-none" />

        {/* Spatial Node Map Stage */}
        <div className="relative w-full h-[360px] sm:h-[420px] rounded-xl bg-black/50 border border-cyan-500/20 overflow-hidden flex items-center justify-center p-4">
          {/* Animated Connecting Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
            <line x1="50%" y1="30%" x2="25%" y2="45%" stroke="#00e5ff" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="50%" y1="30%" x2="75%" y2="45%" stroke="#00e5ff" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="25%" y1="45%" x2="35%" y2="70%" stroke="#b8ff00" strokeWidth="1.5" />
            <line x1="75%" y1="45%" x2="65%" y2="70%" stroke="#8b5cf6" strokeWidth="1.5" />
            <line x1="35%" y1="70%" x2="15%" y2="75%" stroke="#00e5ff" strokeWidth="1.5" />
            <line x1="65%" y1="70%" x2="85%" y2="75%" stroke="#00e5ff" strokeWidth="1.5" />
            <line x1="35%" y1="70%" x2="40%" y2="90%" stroke="#b8ff00" strokeWidth="1.5" />
            <line x1="65%" y1="70%" x2="60%" y2="90%" stroke="#b8ff00" strokeWidth="1.5" />
          </svg>

          {/* Interactive Floating Nodes */}
          {SKILL_NODES.map((node) => {
            const isSelected = selectedNode?.id === node.id
            return (
              <button
                key={node.id}
                onClick={() => setSelectedNode(node)}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full text-xs font-mono transition-all duration-300 flex items-center gap-1.5 shadow-lg ${
                  isSelected
                    ? 'bg-cyan-500 text-black font-bold scale-110 shadow-[0_0_20px_#00e5ff] z-20'
                    : 'bg-surface-glass border border-cyan-500/30 text-cyan-300 hover:border-lime-400 hover:text-lime-300 z-10'
                }`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
              >
                <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-black' : 'bg-cyan-400'}`} />
                <span>{node.name}</span>
              </button>
            )
          })}
        </div>

        {/* Selected Capability Details Card */}
        {selectedNode && (
          <div className="mt-6 p-5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="mono text-xs font-bold text-cyan-400 uppercase tracking-wider">
                CAPABILITY NODE // {selectedNode.category}
              </span>
              <span className="text-[10px] mono text-lime-400 px-2 py-0.5 rounded bg-lime-500/10 border border-lime-500/20">
                ACTIVE FOCUS
              </span>
            </div>
            <h4 className="font-serif text-xl text-white">{selectedNode.name}</h4>
            <p className="text-xs text-gray-300 leading-relaxed font-sans">{selectedNode.description}</p>
          </div>
        )}
      </div>
    </div>
  )
}
