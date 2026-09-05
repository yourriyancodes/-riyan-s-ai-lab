import WorldPanel from './WorldPanel'
import { useLab } from '../store/useLab'
import { skills, intersection, WORLD_HUES } from '../data/portfolio'

/** WORLD 01 · AI — the constellation readout + the AI PRODUCT ENGINEERING intersection. */
export default function AiWorldPanel() {
  const hoveredSkill = useLab((s) => s.hoveredSkill)
  const active = skills.find((s) => s.id === hoveredSkill)

  return (
    <WorldPanel world="ai" sub="AI DOMAIN">
      {/* constellation readout */}
      <div className="rounded-lg border border-line/70 bg-ink/40 p-3.5">
        <span className="tech-label">SKILL CONSTELLATION · HOVER THE SPHERE</span>
        <div className="mt-2 min-h-[62px]">
          {active ? (
            <div key={active.id} className="anim-fade-in">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-[13.5px] tracking-[0.08em] text-snow">
                  {active.name.toUpperCase()}
                </span>
                <span
                  className="rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.16em] uppercase"
                  style={{ color: WORLD_HUES[active.world], borderColor: `${WORLD_HUES[active.world]}55` }}
                >
                  WORLD {['ai', 'data', 'software', 'mobile', 'web', 'cloud', 'automation', 'experiments'].indexOf(active.world) + 1}
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-snow/70">{active.desc}</p>
            </div>
          ) : (
            <p className="font-mono text-[10px] tracking-[0.18em] text-fog/60">◉ HOVER A NODE TO INSPECT</p>
          )}
        </div>
      </div>

      {/* the intersection — AI PRODUCT ENGINEERING */}
      <div className="mt-4 rounded-lg border border-accent/30 bg-accent/[0.06] p-4">
        <span className="tech-label text-accent">THE INTERSECTION</span>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[0.14em]">
          {intersection.formula.map((f, i) => (
            <span key={f} className="flex items-center gap-2">
              <span
                className="rounded-md border px-2 py-1"
                style={{ color: WORLD_HUES[f.toLowerCase() as never] ?? '#fff', borderColor: 'currentColor55' }}
              >
                {f}
              </span>
              {i < intersection.formula.length - 1 && <span className="text-accent">+</span>}
            </span>
          ))}
          <span className="text-accent">=</span>
          <span className="rounded-md border border-accent/60 bg-accent/10 px-2.5 py-1 text-accent">
            {intersection.result}
          </span>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-snow/70">{intersection.note}</p>
      </div>
    </WorldPanel>
  )
}
