import WorldPanel from './WorldPanel'
import { useLab } from '../store/useLab'

/** WORLD 04 · MOBILE */
export default function MobileWorldPanel() {
  const setView = useLab((s) => s.setView)
  return (
    <WorldPanel world="mobile">
      <button
        onClick={() => setView('experience')}
        className="w-full cursor-pointer rounded-lg border border-line/70 bg-ink/30 p-3 text-left transition-all hover:border-accent/40 hover:bg-accent/5"
      >
        <span className="font-mono text-[9px] tracking-[0.2em] text-accent">CAREER PATH</span>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-snow/70">
          Milestones and roles rendered as a path through the universe →
        </p>
      </button>
    </WorldPanel>
  )
}
