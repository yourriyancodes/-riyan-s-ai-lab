import PanelShell from './PanelShell'
import ExperienceBody from './ExperienceBody'

/** EDUCATION — the obelisk at the edge of the universe. */
export default function EducationPanel() {
  return (
    <PanelShell label="EDUCATION" wide>
      <ExperienceBody initialTab="EDUCATION" />
    </PanelShell>
  )
}
