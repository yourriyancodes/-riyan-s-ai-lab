import { Canvas } from '@react-three/fiber'
import { useLab, type Quality } from '../store/useLab'
import CameraRig from './CameraRig'
import EnvironmentFX from './EnvironmentFX'
import LabFloor from './LabFloor'
import Particles from './Particles'
import AICore from './AICore'
import Stations from './Stations'
import ExperimentsZone from './ExperimentsZone'
import TimelinePath from './TimelinePath'
import ArchitectureDiagram from './ArchitectureDiagram'
import PortraitHologram from './PortraitHologram'
import Effects from './Effects'

export default function LabScene({ quality }: { quality: Quality }) {
  const low = quality === 'low'
  const mode = useLab((s) => s.mode)

  return (
    <Canvas
      dpr={low ? [0.75, 1.3] : [1, 1.75]}
      gl={{
        antialias: !low,
        alpha: false,
        stencil: false,
        depth: true,
        powerPreference: 'high-performance',
      }}
      camera={{ fov: 45, near: 0.1, far: 140, position: [0, 4.8, 15.8] }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.12
      }}
      style={{ position: 'fixed', inset: 0, touchAction: 'none' }}
      aria-label="Interactive 3D Tech Universe — use the menu or click stations to navigate"
      role="img"
    >
      <color attach="background" args={['#0a0e0c']} />
      <fog attach="fog" args={['#0a0e0c', 20, 46]} />

      <EnvironmentFX />
      <CameraRig />

      <LabFloor low={low} />
      <Particles low={low} />

      <AICore low={low} />
      <PortraitHologram low={low} />
      <Stations low={low} />
      <ExperimentsZone low={low} />
      <TimelinePath low={low} />
      <ArchitectureDiagram low={low} />

      {!low && mode === 'dark' && (
        <Effects />
      )}
    </Canvas>
  )
}
