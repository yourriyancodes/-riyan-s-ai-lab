'use client'

import { useEffect, type KeyboardEvent } from 'react'
import { X, ArrowUpRight, Cpu, Layers, Terminal, CheckCircle2 } from 'lucide-react'
import type { ProjectItem } from './ProjectCard'

type ProjectDetailModalProps = {
  project: ProjectItem | null
  onClose: () => void
}

export default function ProjectDetailModal({ project, onClose }: ProjectDetailModalProps) {
  useEffect(() => {
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (project) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.body.style.overflow = 'auto'
      window.removeEventListener('keydown', handleEscape)
    }
  }, [project, onClose])

  if (!project) return null

  // Detailed mock specs tailored to each project
  const getProjectDetails = (name: string) => {
    switch (name) {
      case 'Akshara Deepa Tutor':
        return {
          architecture: 'Android SDK · On-Device Neural Pipeline · Speech & Script Alignment Engine',
          overview:
            'A specialized educational tool built to bridge linguistic structure and interactive learning feedback for foundational multi-lingual literacy.',
          highlights: [
            'Real-time phonetic feedback and speech-to-symbol mapping.',
            'Offline-first architecture tailored for resource-constrained Android devices.',
            'Adaptive feedback loops to boost engagement and retention.',
          ],
          stack: ['Android', 'Kotlin', 'TensorFlow Lite', 'Edge Speech ML', 'UI/UX Design'],
        }
      case 'Sign Language Detector':
        return {
          architecture: 'MediaPipe Vision · Custom Landmark Classifier · WebGL Rendering',
          overview:
            'A computer vision system that maps complex hand gesture vectors into linguistic tokens in real-time.',
          highlights: [
            '3D hand landmark tracking at 60 FPS with low latency.',
            'Spatial vector normalizer for scale-invariant gesture detection.',
            'Custom gesture dataset trained for high confidence gesture recognition.',
          ],
          stack: ['Computer Vision', 'MediaPipe', 'TypeScript', 'TensorFlow.js', 'Canvas API'],
        }
      case 'RAG Knowledge Assistant':
        return {
          architecture: 'Hybrid Vector Search · Context Reranker · LLM Orchestration',
          overview:
            'An intelligent retrieval pipeline that converts unstructured enterprise documents into verifiable, grounded context streams.',
          highlights: [
            'Hierarchical document chunking and metadata enrichment.',
            'Hybrid dense-sparse retrieval combining vector similarity with BM25 keyword weighting.',
            'Context reranking layer reducing hallucination rates.',
          ],
          stack: ['Python', 'LangChain / LlamaIndex', 'Vector Databases', 'RAG', 'FastAPI'],
        }
      case 'Agentic AI Project':
        return {
          architecture: 'ReAct Agentic Loop · Tool Schema Registry · Verification Gatekeepers',
          overview:
            'An autonomous agent system designed to plan multi-step workflows, execute code tools, and self-correct errors prior to output.',
          highlights: [
            'Structured reasoning loops with step-by-step reflection traces.',
            'Dynamic tool calling environment for web, filesystem, and API execution.',
            'Built-in verification boundary ensuring safe, deterministic side-effects.',
          ],
          stack: ['Agentic AI', 'LLM Agents', 'Python', 'AsyncIO', 'JSON Schema Tools'],
        }
      case 'Data Science Project':
      default:
        return {
          architecture: 'Exploratory Data Pipeline · Signal Extraction · Predictive Modeling',
          overview:
            'Analytical data framework focused on turning noisy raw event streams into actionable statistical insights.',
          highlights: [
            'Automated feature engineering and anomaly detection.',
            'Statistical modeling for high-dimensional dataset exploration.',
            'Interactive data visualization dashboards.',
          ],
          stack: ['Python', 'Pandas', 'NumPy', 'Scikit-Learn', 'Plotly'],
        }
    }
  }

  const details = getProjectDetails(project.name)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Project detail: ${project.name}`}
      >
        <button className="modal-close-btn" onClick={onClose} aria-label="Close detail view">
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-meta-strip mono">
            <span>PROJECT {project.number}</span>
            <span className="text-lime">// {project.technology}</span>
            <span className="modal-status-badge">{project.status}</span>
          </div>
          <h2 className="modal-title">{project.name}</h2>
          <p className="modal-lead">{details.overview}</p>
        </div>

        {/* Architecture Specs */}
        <div className="modal-section">
          <div className="modal-section-title">
            <Terminal size={14} className="text-cyan inline mr-2" />
            <span className="mono">SYSTEM ARCHITECTURE</span>
          </div>
          <div className="modal-box mono text-sm">{details.architecture}</div>
        </div>

        {/* Key Innovations */}
        <div className="modal-section">
          <div className="modal-section-title">
            <Layers size={14} className="text-lime inline mr-2" />
            <span className="mono">KEY INNOVATIONS & CAPABILITIES</span>
          </div>
          <ul className="modal-list">
            {details.highlights.map((item, idx) => (
              <li key={idx} className="modal-list-item">
                <CheckCircle2 size={15} className="text-cyan flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Tech Stack Chips */}
        <div className="modal-section">
          <div className="modal-section-title">
            <Cpu size={14} className="text-violet inline mr-2" />
            <span className="mono">TECHNOLOGY STACK</span>
          </div>
          <div className="modal-chips">
            {details.stack.map((tech) => (
              <span key={tech} className="tech-chip">
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button className="button primary" onClick={onClose}>
            CLOSE SPECIFICATION
          </button>
        </div>
      </div>
    </div>
  )
}
