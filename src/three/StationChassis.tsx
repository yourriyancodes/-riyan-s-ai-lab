import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text, Billboard } from '@react-three/drei'
import { useLab } from '../store/useLab'
import displayFont from '@fontsource/inter/files/inter-latin-500-normal.woff'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

interface Props {
  id: string
  label: string
  index: string
  sub?: string
  hue: string
  children?: ReactNode
  onClick?: () => void
  labelY?: number
}

const VIEW_BY_STATION: Record<string, string> = {
  ai: 'ai',
  data: 'data',
  software: 'software',
  mobile: 'mobile',
  web: 'web',
  cloud: 'cloud',
  automation: 'automation',
  experiments: 'experiments',
  projects: 'projects',
  contact: 'contact',
}

/**
 * Shared world-station plinth, tinted by the world's hue.
 * Selection/hover states: ring glow, emissive plinth, label brightening.
 */
export default function StationChassis({ id, label, index, sub, hue, children, onClick, labelY = 3.3 }: Props) {
  const setHoveredStation = useLab((s) => s.setHoveredStation)
  const hoveredStation = useLab((s) => s.hoveredStation)
  const view = useLab((s) => s.view)
  const selected = view === VIEW_BY_STATION[id]
  const hovered = hoveredStation === id

  const glow = useRef<THREE.Mesh>(null)
  const plinthMat = useRef<THREE.MeshStandardMaterial>(null)

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const target = hovered || selected ? 1 : 0
    if (glow.current) {
      const m = glow.current.material as THREE.MeshBasicMaterial
      m.opacity += (0.1 + target * 0.5 - m.opacity) * (1 - Math.exp(-6 * dt))
      glow.current.scale.setScalar(1 + target * 0.18 + Math.sin(t * 2) * 0.03)
    }
    if (plinthMat.current) {
      const e = plinthMat.current.emissive
      const c = new THREE.Color(hue).multiplyScalar(0.28)
      e.lerp(target > 0.5 ? c : new THREE.Color('#000000'), 1 - Math.exp(-6 * dt))
    }
  })

  return (
    <group>
      {/* plinth */}
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.42, 0.55, 0.76, 40]} />
        <meshStandardMaterial ref={plinthMat} color="#121215" roughness={0.45} metalness={0.7} emissive="#000000" />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.08, 40]} />
        <meshStandardMaterial color="#1a1a1f" roughness={0.35} metalness={0.8} />
      </mesh>
      {/* selection glow ring */}
      <mesh ref={glow} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.52, 0.6, 48]} />
        <meshBasicMaterial color={hue} transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* the world's own object */}
      <group position={[0, 1.28, 0]}>{children}</group>

      {/* label */}
      <Billboard position={[0, labelY, 0]}>
        <Text font={displayFont} fontSize={0.3} letterSpacing={0.1} anchorX="center" color={hovered || selected ? hue : '#cfc8ba'}>
          {label}
        </Text>
        <Text font={monoFont} fontSize={0.14} letterSpacing={0.38} anchorX="center" position={[0, -0.34, 0]} color={hovered || selected ? '#2dd391' : '#4c4552'}>
          {sub ?? `STATION ${index}`}
        </Text>
      </Billboard>

      {/* invisible interaction volume */}
      <mesh
        position={[0, 1.7, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHoveredStation(id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHoveredStation(null)
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[1.5, 12, 12]} />
        <meshBasicMaterial visible={false} transparent opacity={0} />
      </mesh>
    </group>
  )
}
