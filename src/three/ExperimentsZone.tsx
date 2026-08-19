import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text, Billboard } from '@react-three/drei'
import { useLab } from '../store/useLab'
import { EXPERIMENTS_ANCHOR } from '../data/views'
import { experiments } from '../data/portfolio'
import displayFont from '@fontsource/inter/files/inter-latin-500-normal.woff'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

const STATUS_COLOR: Record<string, string> = {
  PROTOTYPE: '#2dd391',
  EXPLORING: '#c9a8f0',
  ACTIVE: '#d8d2c0',
}

/**
 * WORLD 08 · EXPERIMENTS — floating research modules above the station.
 */
export default function ExperimentsZone({ low }: { low?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const selected = useLab((s) => s.experiment)
  const setExperiment = useLab((s) => s.setExperiment)
  const setHoveredStation = useLab((s) => s.setHoveredStation)

  const layout = useMemo(() => {
    const n = experiments.length
    return experiments.map((_, i) => {
      const t = n === 1 ? 0 : i / (n - 1)
      const angle = -0.9 + t * 1.8
      const radius = 2.5
      return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius + 0.4,
        y: 1.15 + Math.sin(t * Math.PI) * 0.55,
        ry: -angle * 0.5,
        float: i * 0.7,
      }
    })
  }, [])

  useFrame((state, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.06
    group.current?.children.forEach((child, i) => {
      if (!layout[i]) return
      child.position.y = layout[i].y + Math.sin(state.clock.elapsedTime * 0.8 + layout[i].float) * 0.07
    })
  })

  return (
    <group position={EXPERIMENTS_ANCHOR}>
      <mesh position={[0, -0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.7, 2.84, 48]} />
        <meshBasicMaterial color="#332844" transparent opacity={0.55} />
      </mesh>
      <Billboard position={[0, 3.9, 0]}>
        <Text font={displayFont} fontSize={0.42} letterSpacing={0.3} anchorX="center" color="#e4e4e7">
          EXPERIMENTS
        </Text>
        <Text font={monoFont} fontSize={0.15} letterSpacing={0.3} anchorX="center" position={[0, -0.46, 0]} color="#8a6b9e">
          PROTOTYPES · IDEAS IN PROGRESS
        </Text>
      </Billboard>

      <group ref={group}>
        {layout.map((pos, i) => {
          const exp = experiments[i]
          const isSel = selected === exp.id
          const color = STATUS_COLOR[exp.status] ?? '#2dd391'
          return (
            <group key={exp.id} position={[pos.x, pos.y, pos.z]} rotation={[0, pos.ry, 0]}>
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  setExperiment(isSel ? null : exp.id)
                }}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  setHoveredStation('experiments')
                  document.body.style.cursor = 'pointer'
                }}
                onPointerOut={() => {
                  setHoveredStation(null)
                  document.body.style.cursor = 'auto'
                }}
              >
                <boxGeometry args={[0.62, 0.62, 0.62]} />
                <meshPhysicalMaterial color="#141417" roughness={0.1} metalness={0.4} transparent opacity={isSel ? 0.92 : 0.55} clearcoat={0.8} />
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(0.62, 0.62, 0.62)]} />
                <lineBasicMaterial color={isSel ? color : '#3a3344'} transparent opacity={isSel ? 1 : 0.6} />
              </lineSegments>
              <mesh>
                <sphereGeometry args={[0.08, 10, 10]} />
                <meshBasicMaterial color={color} toneMapped={false} />
              </mesh>
              {!low && (
                <Text font={monoFont} fontSize={0.085} letterSpacing={0.14} anchorX="center" position={[0, -0.5, 0]} color={isSel ? color : '#6e5f78'}>
                  {exp.code} · {exp.name}
                </Text>
              )}
            </group>
          )
        })}
      </group>
    </group>
  )
}
