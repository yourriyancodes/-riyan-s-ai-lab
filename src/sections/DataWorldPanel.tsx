import { useState } from 'react'
import PanelShell from './PanelShell'
import { about, profile, worlds } from '../data/portfolio'

type Tab = 'ABOUT ME' | 'DATA'

/** WORLD 02 · DATA — profile (who Riyan is) + the data domain. */
export default function DataWorldPanel() {
  const [tab, setTab] = useState<Tab>('ABOUT ME')
  const w = worlds.find((x) => x.id === 'data')!
  const hue = '#9db2ff'

  return (
    <PanelShell label="WORLD 02 · DATA">
      <div className="anim-fade-up">
        <div className="flex items-center gap-1.5">
          {(['ABOUT ME', 'DATA'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded-full px-3 py-1 font-mono text-[9px] tracking-[0.2em] transition-all ${
                tab === t
                  ? 'border border-accent/40 bg-accent/15 text-accent'
                  : 'border border-line/60 text-fog hover:text-snow'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'ABOUT ME' ? (
          <div className="mt-4">
            <div className="flex items-center gap-2.5">
              <span className="block h-2.5 w-2.5 rounded-full bg-w-data shadow-[0_0_10px_rgba(138,150,255,0.5)]" />
              <h2 className="font-display text-lg font-semibold tracking-[0.14em] text-snow">ABOUT ME</h2>
            </div>
            <p className="mt-1 font-mono text-[9px] tracking-[0.28em] text-w-data">
              {profile.brand} · {profile.identity.toUpperCase()}
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-snow/75">{about.intro}</p>
            <p className="mt-3 text-[12px] leading-relaxed text-fog">{about.detail}</p>

            <div className="mt-5">
              <span className="tech-label">FOCUS AREAS</span>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {about.tags.map((t) => (
                  <span key={t} className="tech-chip">{t}</span>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-line/70 bg-ink/40 p-3.5">
              <span className="tech-label">CORE MESSAGE</span>
              <p className="mt-2 font-display text-[14px] leading-snug text-snow/90">
                “{profile.coreMessage}”
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <h2 className="font-display text-lg font-semibold tracking-[0.14em] text-snow">{w.title}</h2>
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
                    style={{ color: hue, borderColor: `${hue}55`, background: `${hue}0d` }}
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-4 rounded-lg border border-dashed border-line/70 p-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.16em] text-fog/60">
              DATA × AI = INTELLIGENT SYSTEMS
              <br />
              DATA × SOFTWARE = DATA PRODUCTS
            </p>
          </div>
        )}
      </div>
    </PanelShell>
  )
}
