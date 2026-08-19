import PanelShell from './PanelShell'
import { useLab } from '../store/useLab'
import { projects } from '../data/portfolio'

/** PROJECTS — gallery list. Each entry opens its 3D case-study environment. */
export default function ProjectsPanel() {
  const openProject = useLab((s) => s.openProject)

  return (
    <PanelShell label="PROJECTS · GALLERY" wide>
      <div className="anim-fade-up">
        <h2 className="font-display text-xl font-semibold tracking-[0.14em] text-snow">
          PROJECT GALLERY
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-fog">
          Five holographic displays float in front of you. Click a panel in
          the environment — or an entry below — to enter its case study.
        </p>

        <ul className="mt-4 space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => openProject(p.id)}
                className="group w-full cursor-pointer rounded-lg border border-line/60 bg-ink/30 p-3.5 text-left transition-all hover:border-accent/40 hover:bg-accent/5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-accent">
                    PROJECT {p.index}
                  </span>
                  <span className="text-fog/50 transition-all group-hover:translate-x-1 group-hover:text-accent">
                    →
                  </span>
                </div>
                <div className="mt-1.5 font-display text-[15px] tracking-[0.08em] text-snow group-hover:text-accent transition-colors">
                  {p.title}
                </div>
                <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.16em] text-fog">
                  {p.category}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {p.tech.map((t) => (
                    <span key={t} className="tech-chip">{t}</span>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-4 border-t border-line/60 pt-3 font-mono text-[9px] tracking-[0.2em] text-fog/60">
          * LINKS & METRICS ARE PLACEHOLDERS — READY FOR YOUR REAL DATA
        </p>
      </div>
    </PanelShell>
  )
}
