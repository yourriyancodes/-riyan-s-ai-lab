import { useState } from 'react'
import { useLab } from '../store/useLab'
import { timeline, education } from '../data/portfolio'

type Tab = 'TIMELINE' | 'EDUCATION'

/** Career timeline + education content. Rendered inside panels via tabs. */
export default function ExperienceBody({ initialTab = 'TIMELINE' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const setView = useLab((s) => s.setView)

  return (
    <div className="anim-fade-up">
      <div className="flex items-center gap-1.5">
        {(['TIMELINE', 'EDUCATION'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`cursor-pointer rounded-full px-3 py-1 font-mono text-[9px] tracking-[0.2em] transition-all ${
              tab === t
                ? 'bg-accent/15 text-accent border border-accent/40'
                : 'border border-line/60 text-fog hover:text-snow'
            }`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => setView(tab === 'EDUCATION' ? 'education' : 'experience')}
          className="ml-auto cursor-pointer font-mono text-[9px] tracking-[0.2em] text-accent/80 transition-colors hover:text-accent"
        >
          VIEW IN 3D →
        </button>
      </div>

      {tab === 'TIMELINE' && (
        <div className="mt-4 space-y-3">
          {timeline.map((ms, i) => (
            <div key={ms.id} className="relative rounded-lg border border-line/60 bg-ink/30 p-3.5 pl-9">
              <span className="absolute left-3 top-3.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_rgba(45,211,145,0.7)]" />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] tracking-[0.24em] text-accent">
                  MILESTONE {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-fog/70">{ms.duration}</span>
              </div>
              <div className="mt-1.5 font-display text-[14px] tracking-[0.08em] text-snow">{ms.role}</div>
              <div className="font-mono text-[9.5px] tracking-[0.18em] text-fog">{ms.org}</div>
              <div className="mt-2.5 space-y-1">
                {ms.responsibilities.map((r, j) => (
                  <p key={j} className="text-[11px] leading-relaxed text-snow/65">▪ {r}</p>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {ms.technologies.map((t) => (
                  <span key={t} className="tech-chip">{t}</span>
                ))}
              </div>
              {ms.achievements.some((a) => a.includes('PLACEHOLDER')) && (
                <p className="mt-2 font-mono text-[8.5px] tracking-[0.14em] text-fog/50">
                  + ACHIEVEMENTS PENDING
                </p>
              )}
            </div>
          ))}
          <p className="rounded-lg border border-dashed border-line/80 p-3 text-center font-mono text-[9px] tracking-[0.2em] text-fog/60">
            READY FOR YOUR REAL MILESTONES — EDIT src/data/portfolio.ts
          </p>
        </div>
      )}

      {tab === 'EDUCATION' && (
        <div className="mt-4">
          <div className="rounded-lg border border-line/60 bg-ink/30 p-4">
            <span className="tech-label">DEGREE</span>
            <h3 className="mt-2 font-display text-[16px] font-semibold tracking-[0.1em] text-snow">
              {education.degree}
            </h3>
            <p className="mt-1 font-mono text-[10px] tracking-[0.24em] text-accent">{education.field}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <span className="tech-label">INSTITUTION</span>
                <p className="mt-1.5 text-[12px] text-snow/80">{education.institution}</p>
              </div>
              <div>
                <span className="tech-label">GRADUATION</span>
                <p className="mt-1.5 text-[12px] text-snow/80">{education.graduation}</p>
              </div>
            </div>
            <p className="mt-3 border-t border-line/60 pt-2.5 text-[11px] leading-relaxed text-fog">
              {education.note}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
