import type { ReactNode } from 'react'
import PanelShell from './PanelShell'
import { worlds, WORLD_HUES, type WorldId } from '../data/portfolio'

interface Props {
  world: WorldId
  children?: ReactNode
  /** extra sub-label, e.g. a section name for tabbed panels */
  sub?: string
}

/** Shared panel chrome for the eight world stations. */
export default function WorldPanel({ world, children, sub }: Props) {
  const w = worlds.find((x) => x.id === world)!
  const hue = WORLD_HUES[world]

  return (
    <PanelShell label={`WORLD ${w.index} · ${sub ?? w.title}`}>
      <div className="anim-fade-up">
        <div className="flex items-center gap-2.5">
          <span className="block h-2.5 w-2.5 rounded-full" style={{ background: hue, boxShadow: `0 0 10px ${hue}77` }} />
          <h2 className="font-display text-lg font-semibold tracking-[0.14em] text-snow">{w.title}</h2>
        </div>
        <p className="mt-1 font-mono text-[9px] tracking-[0.28em]" style={{ color: hue }}>
          {w.tagline.toUpperCase()}
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-snow/75">{w.blurb}</p>

        <div className="mt-4">
          <span className="tech-label">DOMAINS</span>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {w.domains.map((d) => (
              <span
                key={d}
                className="rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.08em] uppercase"
                style={{
                  color: hue,
                  borderColor: `${hue}55`,
                  background: `${hue}0d`,
                }}
              >
                {d}
              </span>
            ))}
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}
      </div>
    </PanelShell>
  )
}
