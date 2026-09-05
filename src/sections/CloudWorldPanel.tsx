import WorldPanel from './WorldPanel'

/** WORLD 06 · CLOUD */
export default function CloudWorldPanel() {
  return (
    <WorldPanel world="cloud">
      <p className="rounded-lg border border-dashed border-line/70 p-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.16em] text-fog/60">
        CLOUD × SOFTWARE = SYSTEMS THAT SCALE
        <br />
        CLOUD × AI = DEPLOYED INTELLIGENCE
      </p>
    </WorldPanel>
  )
}
