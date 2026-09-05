import { useState } from 'react'
import PanelShell from './PanelShell'
import { useLab } from '../store/useLab'
import { projects } from '../data/portfolio'

type TabKey =
  | 'PROBLEM'
  | 'APPROACH'
  | 'ARCHITECTURE'
  | 'TECHNOLOGY'
  | 'IMPLEMENTATION'
  | 'RESULTS'
  | 'DEMO'
  | 'SOURCE'

const TABS: TabKey[] = ['PROBLEM', 'APPROACH', 'ARCHITECTURE', 'TECHNOLOGY', 'IMPLEMENTATION', 'RESULTS', 'DEMO', 'SOURCE']

/** PROJECT CASE STUDY — deep-dive environment with the 3D architecture diagram. */
export default function ProjectCase() {
  const projectId = useLab((s) => s.projectId)
  const closeProject = useLab((s) => s.closeProject)
  const activeLayer = useLab((s) => s.activeLayer)
  const setActiveLayer = useLab((s) => s.setActiveLayer)
  const [tab, setTab] = useState<TabKey>('PROBLEM')

  const project = projects.find((p) => p.id === projectId)
  if (!project) return null

  const bullets = (arr: string[]) => (
    <ul className="mt-2 space-y-2">
      {arr.map((b, i) => (
        <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-snow/75">
          <span className="mt-0.5 text-accent">▪</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <PanelShell
      label={`CASE STUDY · PROJECT ${project.index}`}
      wide
      onClose={closeProject}
      showClose
    >
      <div className="anim-fade-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.24em] text-accent">
              {project.category}
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.1em] text-snow">
              {project.title}
            </h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-fog">{project.tagline}</p>
          </div>
        </div>

        {/* tab bar */}
        <div className="mt-4 flex flex-wrap gap-1.5 border-b border-line/70 pb-3">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                if (t === 'ARCHITECTURE' && activeLayer < 0) setActiveLayer(0)
              }}
              className={`cursor-pointer rounded-full px-2.5 py-1 font-mono text-[8.5px] tracking-[0.14em] transition-all ${
                tab === t
                  ? 'bg-accent/15 text-accent border border-accent/40'
                  : 'border border-line/60 text-fog hover:text-snow'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[190px]">
          {tab === 'PROBLEM' && (
            <div className="anim-fade-in">
              <span className="tech-label">PROBLEM</span>
              {bullets(project.problem)}
            </div>
          )}
          {tab === 'APPROACH' && (
            <div className="anim-fade-in">
              <span className="tech-label">APPROACH</span>
              {bullets(project.approach)}
            </div>
          )}
          {tab === 'ARCHITECTURE' && (
            <div className="anim-fade-in">
              <span className="tech-label">ARCHITECTURE · CLICK LAYERS IN 3D</span>
              {bullets(
                project.architecture.map(
                  (a, i) => `${i + 1}. ${a}`,
                ),
              )}
              <p className="mt-3 font-mono text-[9.5px] tracking-[0.16em] text-accent/80">
                ▸ THE 3D DIAGRAM IS IN FRONT OF YOU — CLICK A LAYER TO HIGHLIGHT IT
              </p>
            </div>
          )}
          {tab === 'TECHNOLOGY' && (
            <div className="anim-fade-in">
              <span className="tech-label">TECHNOLOGY</span>
              {bullets(project.technology)}
            </div>
          )}
          {tab === 'IMPLEMENTATION' && (
            <div className="anim-fade-in">
              <span className="tech-label">IMPLEMENTATION</span>
              {bullets(project.implementation)}
            </div>
          )}
          {tab === 'RESULTS' && (
            <div className="anim-fade-in">
              <span className="tech-label">RESULTS</span>
              {bullets(project.results)}
            </div>
          )}
          {tab === 'DEMO' && (
            <div className="anim-fade-in">
              <span className="tech-label">DEMO</span>
              <p className="mt-2 text-[12px] text-fog">
                A live demo of this project is on its way.
              </p>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="mt-3 inline-block cursor-not-allowed rounded-full border border-line px-5 py-2 font-mono text-[10px] tracking-[0.22em] text-fog/70"
              >
                {project.demo}
              </a>
            </div>
          )}
          {tab === 'SOURCE' && (
            <div className="anim-fade-in">
              <span className="tech-label">SOURCE CODE</span>
              <p className="mt-2 text-[12px] text-fog">
                The repository will be linked here once published.
              </p>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="mt-3 inline-block cursor-not-allowed rounded-full border border-line px-5 py-2 font-mono text-[10px] tracking-[0.22em] text-fog/70"
              >
                {project.source}
              </a>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-line/60 pt-3">
          <span className="tech-label">PIPELINE</span>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {project.pipeline.map((l, i) => (
              <button
                key={i}
                onClick={() => setActiveLayer(activeLayer === i ? -1 : i)}
                className={`cursor-pointer rounded border px-2 py-1 font-mono text-[8.5px] tracking-[0.1em] transition-all ${
                  activeLayer === i
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line/70 text-fog hover:border-accent/40 hover:text-snow'
                }`}
              >
                {l.label}
                {i < project.pipeline.length - 1 && <span className="ml-1.5 text-accent/60">→</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PanelShell>
  )
}
