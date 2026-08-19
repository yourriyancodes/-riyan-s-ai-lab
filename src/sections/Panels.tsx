import { lazy, Suspense } from 'react'
import { useLab } from '../store/useLab'
import HeroPanel from './HeroPanel'
import AiWorldPanel from './AiWorldPanel'
import DataWorldPanel from './DataWorldPanel'
import SoftwareWorldPanel from './SoftwareWorldPanel'
import MobileWorldPanel from './MobileWorldPanel'
import WebWorldPanel from './WebWorldPanel'
import CloudWorldPanel from './CloudWorldPanel'
import AutomationWorldPanel from './AutomationWorldPanel'
import ExperimentsPanel from './ExperimentsPanel'
import ProjectsPanel from './ProjectsPanel'
import ExperiencePanel from './ExperiencePanel'
import EducationPanel from './EducationPanel'
import ContactPanel from './ContactPanel'

// The case study is the heaviest overlay — code-split it.
const ProjectCase = lazy(() => import('./ProjectCase'))

/** View → panel routing. Panels render only for their active sector. */
export default function Panels() {
  const view = useLab((s) => s.view)
  const booted = useLab((s) => s.booted)

  if (!booted) return null

  return (
    <>
      {view === 'lab' && <HeroPanel />}
      {view === 'ai' && <AiWorldPanel />}
      {view === 'data' && <DataWorldPanel />}
      {view === 'software' && <SoftwareWorldPanel />}
      {view === 'mobile' && <MobileWorldPanel />}
      {view === 'web' && <WebWorldPanel />}
      {view === 'cloud' && <CloudWorldPanel />}
      {view === 'automation' && <AutomationWorldPanel />}
      {view === 'experiments' && <ExperimentsPanel />}
      {view === 'projects' && <ProjectsPanel />}
      {view === 'project' && (
        <Suspense fallback={null}>
          <ProjectCase />
        </Suspense>
      )}
      {view === 'experience' && <ExperiencePanel />}
      {view === 'education' && <EducationPanel />}
      {view === 'contact' && <ContactPanel />}
    </>
  )
}
