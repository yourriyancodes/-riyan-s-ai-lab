import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { useLab } from '../store/useLab'
import { DIAGRAM_POS } from '../data/views'
import { projects } from '../data/portfolio'
import displayFont from '@fontsource/inter/files/inter-latin-500-normal.woff'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

/**
 * Interactive 3D architecture diagram — USER → APPLICATION → MODEL →
 * DATA/KNOWLEDGE → OUTPUT. Appears inside the project case-study view.
 * Click a layer to highlight it; the case-study panel stays in sync.
 */
export default function ArchitectureDiagram({ low }: { low?: boolean }) {
  const view = useLab((s) => s.view)
  const projectId = useLab((s) => s.projectId)
  const activeLayer = useLab((s) => s.activeLayer)
  const setActiveLayer = useLab((s) => s.setActiveLayer)
  const group = useRef<THREE.Group>(null)
  const pulses = useRef<THREE.Points>(null)

  const project = projects.find((p) => p.id === projectId) ?? projects[2]
  const layers = project.pipeline

  const visible = view === 'project'

  const pulseData = useMemo(() => new Float32Array(30 * 3), [])

  useFrame((state, dt) => {
    if (!visible) return
    if (group.current) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.16
      group.current.position.y = DIAGRAM_POS[1] + Math.sin(state.clock.elapsedTime * 0.6) * 0.05
    }
    if (pulses.current) {
      const attr = pulses.current.geometry.attributes.position as THREE.BufferAttribute
      const t = (state.clock.elapsedTime * 0.9) % 1
      for (let i = 0; i < 30; i++) {
        const p = (i / 30 + t) % 1
        const seg = Math.floor(p * 4)
        const st = (p * 4) % 1
        const y0 = 1.9 - seg * 0.62
        attr.array[i * 3] = 0
        attr.array[i * 3 + 1] = y0 - st * 0.62
        attr.array[i * 3 + 2] = 0.55
      }
      attr.needsUpdate = true
    }
  })

  if (!visible) return null

  const layerY = (i: number) => 1.9 - i * 0.62

  return (
    <group position={DIAGRAM_POS}>
      {/* frame */}
      <mesh>
        <cylinderGeometry args={[0.95, 1.05, 3.6, 48, 1, true]} />
        <meshBasicMaterial color="#1d3b49" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      <group ref={group}>
        {/* connectors */}
        {layers.slice(0, -1).map((_, i) => (
          <mesh key={i} position={[0, layerY(i) - 0.31, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.62, 6]} />
            <meshBasicMaterial color="#177a55" transparent opacity={0.6} />
          </mesh>
        ))}
        {/* flow arrows */}
        {layers.slice(0, -1).map((_, i) => (
          <mesh key={`a${i}`} position={[0, layerY(i) - 0.31, 0]} rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[0.05, 0.1, 8]} />
            <meshBasicMaterial color="#2dd391" transparent opacity={0.8} />
          </mesh>
        ))}

        {/* layers */}
        {layers.map((layer, i) => {
          const active = activeLayer === i
          return (
            <group key={i} position={[0, layerY(i), 0]}>
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveLayer(active ? -1 : i)
                }}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  document.body.style.cursor = 'pointer'
                }}
                onPointerOut={() => {
                  document.body.style.cursor = 'auto'
                }}
              >
                <boxGeometry args={[1.85, 0.34, 0.42]} />
                <meshPhysicalMaterial
                  color={active ? '#2a2417' : '#141417'}
                  roughness={0.15}
                  metalness={0.5}
                  transparent
                  opacity={active ? 0.95 : 0.8}
                  clearcoat={0.7}
                />
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(1.85, 0.34, 0.42)]} />
                <lineBasicMaterial color={active ? '#2dd391' : '#2e2e35'} transparent opacity={active ? 1 : 0.6} />
              </lineSegments>
              <Text
                font={monoFont}
                fontSize={0.13}
                letterSpacing={0.22}
                anchorX="center"
                position={[0, 0.09, 0.24]}
                color={active ? '#3ee6a8' : '#b0a68d'}
              >
                {layer.label}
              </Text>
              <Text
                font={monoFont}
                fontSize={0.09}
                letterSpacing={0.12}
                anchorX="center"
                position={[0, -0.1, 0.24]}
                color={active ? '#2dd391' : '#45677c'}
              >
                {layer.sub}
              </Text>
              {!low && (
                <Text
                  font={monoFont}
                  fontSize={0.1}
                  letterSpacing={0.2}
                  anchorX="center"
                  position={[0, 0, -0.3]}
                  color="#2c4a5e"
                >
                  {String(i + 1).padStart(2, '0')}
                </Text>
              )}
            </group>
          )
        })}

        {/* travelling data pulses */}
        <points ref={pulses}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pulseData, 3]} />
          </bufferGeometry>
          <pointsMaterial color="#9df0ff" size={0.09} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
        </points>
      </group>

      {/* title */}
      <Text
        font={displayFont}
        fontSize={0.26}
        letterSpacing={0.16}
        anchorX="center"
        position={[0, -2.15, 0]}
        color="#d7e5ef"
      >
        SYSTEM ARCHITECTURE
      </Text>
    </group>
  )
}
