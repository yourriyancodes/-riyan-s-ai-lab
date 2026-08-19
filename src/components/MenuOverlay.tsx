import { useLab, type ViewKey } from '../store/useLab'
import { profile, worlds, WORLD_HUES } from '../data/portfolio'

const EXTRA: { label: string; desc: string; view: ViewKey }[] = [
  { label: 'OVERVIEW', desc: 'The core — who Riyan is', view: 'lab' },
]

const TAIL: { label: string; desc: string; view: ViewKey }[] = [
  { label: 'PROJECTS', desc: 'Holographic gallery & case studies', view: 'projects' },
  { label: 'EXPERIENCE', desc: 'Career path through the universe', view: 'experience' },
  { label: 'EDUCATION', desc: 'Academic foundation', view: 'education' },
  { label: 'CONTACT', desc: 'Build something together', view: 'contact' },
]

export default function MenuOverlay() {
  const open = useLab((s) => s.menuOpen)
  const setMenuOpen = useLab((s) => s.setMenuOpen)
  const view = useLab((s) => s.view)
  const setView = useLab((s) => s.setView)

  if (!open) return null

  const isActive = (v: ViewKey) => view === v || (v === 'projects' && view === 'project')

  return (
    <div className="fixed inset-0 z-40">
      <div className="anim-fade-in absolute inset-0 bg-ink/70 backdrop-blur-md" onClick={() => setMenuOpen(false)} />
      <div className="absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
        <div className="glass-bright panel-hairline anim-panel-in relative w-full max-w-md overflow-hidden rounded-2xl p-6 md:p-8">
          <div className="flex items-center justify-between">
            <span className="tech-label">UNIVERSE DIRECTORY</span>
            <button
              onClick={() => setMenuOpen(false)}
              className="cursor-pointer rounded-full border border-line px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-fog transition-all hover:border-accent/40 hover:text-snow"
              aria-label="Close menu"
            >
              ESC / CLOSE
            </button>
          </div>

          <ul className="mt-6 space-y-1">
            {EXTRA.map((s) => (
              <MenuItem key={s.view} active={isActive(s.view)} hue="#2dd391" {...s} onClick={() => setView(s.view)} />
            ))}

            <li className="py-1 pl-3 font-mono text-[8.5px] tracking-[0.3em] text-fog/50">THE EIGHT WORLDS</li>
            {worlds.map((w) => (
              <MenuItem
                key={w.id}
                label={`WORLD ${w.index} · ${w.title}`}
                desc={w.tagline}
                active={isActive(w.id as ViewKey)}
                hue={WORLD_HUES[w.id]}
                onClick={() => setView(w.id as ViewKey)}
              />
            ))}

            <li className="py-1 pl-3 font-mono text-[8.5px] tracking-[0.3em] text-fog/50">SECTORS</li>
            {TAIL.map((s) => (
              <MenuItem key={s.view} active={isActive(s.view)} hue="#2dd391" {...s} onClick={() => setView(s.view)} />
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
            <span className="font-mono text-[9px] tracking-[0.3em] text-fog/60">{profile.status}</span>
            <span className="hidden font-mono text-[8px] tracking-[0.2em] text-fog/40 md:block">
              KEYS 1–0 JUMP WORLDS
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MenuItem({
  label,
  desc,
  active,
  hue,
  onClick,
}: {
  label: string
  desc: string
  active: boolean
  hue: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`group flex w-full cursor-pointer items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-all ${
          active ? 'bg-accent/10' : 'hover:bg-snow/5'
        }`}
      >
        <span
          className="block h-2 w-2 shrink-0 rounded-full"
          style={{ background: hue, boxShadow: active ? `0 0 10px ${hue}` : 'none', opacity: active ? 1 : 0.55 }}
        />
        <span className="flex-1">
          <span className={`block font-display text-[13px] tracking-[0.12em] ${active ? 'text-accent' : 'text-snow/85 group-hover:text-snow'}`}>
            {label}
          </span>
          <span className="block font-mono text-[9px] tracking-[0.14em] text-fog/60">{desc}</span>
        </span>
        <span className="text-accent/60 opacity-0 transition-opacity group-hover:opacity-100">→</span>
      </button>
    </li>
  )
}
