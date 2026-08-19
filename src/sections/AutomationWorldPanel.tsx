import WorldPanel from './WorldPanel'

/** WORLD 07 · AUTOMATION */
export default function AutomationWorldPanel() {
  return (
    <WorldPanel world="automation">
      <p className="rounded-lg border border-dashed border-line/70 p-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.16em] text-fog/60">
        AUTOMATION × AI = AGENTS THAT DO THE WORK
        <br />
        AUTOMATION × DATA = PIPELINES THAT RUN THEMSELVES
      </p>
    </WorldPanel>
  )
}
