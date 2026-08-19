import WorldPanel from './WorldPanel'
import { useLab } from '../store/useLab'

/** WORLD 05 · WEB */
export default function WebWorldPanel() {
  const setView = useLab((s) => s.setView)
  return (
    <WorldPanel world="web">
      <button
        onClick={() => setView('projects')}
        className="w-full cursor-pointer rounded-lg border border-line/70 bg-ink/30 p-3 text-left transition-all hover:border-accent/40 hover:bg-accent/5"
      >
        <span className="font-mono text-[9px] tracking-[0.2em] text-accent">PROOF IN PRACTICE</span>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-snow/70">
          You are standing inside one: this 3D universe is built with React,
          Three.js and WebGL. Explore the project gallery →
        </p>
      </button>
    </WorldPanel>
  )
}
