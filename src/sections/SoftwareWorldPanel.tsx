import WorldPanel from './WorldPanel'

/** WORLD 03 · SOFTWARE */
export default function SoftwareWorldPanel() {
  return (
    <WorldPanel world="software">
      <p className="rounded-lg border border-dashed border-line/70 p-3 text-center font-mono text-[9px] leading-relaxed tracking-[0.16em] text-fog/60">
        SOFTWARE × AI = AI SYSTEMS
        <br />
        SOFTWARE × DATA = DATA PRODUCTS
        <br />
        SOFTWARE × MOBILE × WEB = SHIPPED PRODUCTS
      </p>
    </WorldPanel>
  )
}
