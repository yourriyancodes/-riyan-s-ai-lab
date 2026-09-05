import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text, Billboard } from '@react-three/drei'
import { useLab } from '../store/useLab'
import { MILESTONE_POS, EDUCATION_POS } from '../data/views'
import { timeline, education } from '../data/portfolio'
import displayFont from '@fontsource/inter/files/inter-latin-500-normal.woff'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

/**
 * EXPERIENCE — career path: milestone pedestals from the MOBILE sector
 * outward to the EDUCATION obelisk at the edge of the universe.
 */
export default function TimelinePath({ low }: { low?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const view = useLab((s) => s.view)

  const path = useMemo(() => {
    const pts: THREE.Vector3[] = [
      new THREE.Vector3(2.97, 0.04, 9.13), // from the MOBILE station
      ...MILESTONE_POS.map((p) => new THREE.Vector3(p[0], 0.04, p[2])),
      new THREE.Vector3(EDUCATION_POS[0], 0.04, EDUCATION_POS[2]),
    ]
    const segs: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push(...pts[i].toArray(), ...pts[i + 1].toArray())
    }
    return new Float32Array(segs)
  }, [])

  const pulse = useRef(0)
  useFrame((state, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.02
    pulse.current += dt
    const m = pulse.current % 1
    const dots = group.current?.children[1] as THREE.Points | undefined
    if (dots) {
      const attr = dots.geometry.attributes.position as THREE.BufferAttribute
      const n = attr.count
      const segs = path.length / 6
      for (let i = 0; i < n; i++) {
        const t = (i / n + m) % 1
        const seg = Math.min(Math.floor(t * segs), segs - 1)
        const st = (t * segs) % 1
        const next = (seg + 1) % segs
        attr.array[i * 3] = THREE.MathUtils.lerp(path[seg * 6], path[next * 6], st)
        attr.array[i * 3 + 1] = 0.1
        attr.array[i * 3 + 2] = THREE.MathUtils.lerp(path[seg * 6 + 2], path[next * 6 + 2], st)
      }
      attr.needsUpdate = true
    }
  })

  return (
    <group ref={group}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[path, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#26262c" transparent opacity={0.8} />
      </lineSegments>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(24 * 3), 3]} />
        </bufferGeometry>
        <pointsMaterial color="#2dd391" size={0.09} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {MILESTONE_POS.map((pos, i) => {
        const ms = timeline[i]
        return (
          <group key={ms.id} position={pos}>
            <mesh position={[0, 0.42, 0]}>
              <cylinderGeometry args={[0.42, 0.52, 0.84, 32]} />
              <meshStandardMaterial color="#131316" roughness={0.45} metalness={0.7} />
            </mesh>
            <mesh position={[0, 0.88, 0]} rotation={[0, 0.4 + i * 0.3, 0]}>
              <boxGeometry args={[0.9, 0.05, 0.6]} />
              <meshPhysicalMaterial color="#141417" roughness={0.15} metalness={0.4} transparent opacity={0.85} clearcoat={0.6} />
            </mesh>
            <Billboard position={[0, 1.55, 0]}>
              <Text font={monoFont} fontSize={0.12} letterSpacing={0.28} anchorX="center" color={view === 'experience' ? '#2dd391' : '#52525b'}>
                MILESTONE {String(i + 1).padStart(2, '0')}
              </Text>
              {!low && (
                <Text font={displayFont} fontSize={0.14} anchorX="center" position={[0, -0.26, 0]} color="#9a93a1">
                  {ms.org.replace('[PLACEHOLDER — ', '').replace(']', '')}
                </Text>
              )}
            </Billboard>
          </group>
        )
      })}

      {/* education obelisk */}
      <group position={EDUCATION_POS}>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.42, 0.55, 1.0, 32]} />
          <meshStandardMaterial color="#131316" roughness={0.45} metalness={0.7} />
        </mesh>
        <mesh position={[0, 1.35, 0]} scale={[0.5, 1.15, 0.16]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshPhysicalMaterial color="#141417" roughness={0.12} metalness={0.4} transparent opacity={0.88} clearcoat={0.7} />
        </mesh>
        <lineSegments position={[0, 1.35, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(0.5, 1.15, 0.16)]} />
          <lineBasicMaterial color={view === 'education' ? '#2dd391' : '#2e2e35'} transparent opacity={view === 'education' ? 1 : 0.65} />
        </lineSegments>
        <Billboard position={[0, 2.35, 0]}>
          <Text font={displayFont} fontSize={0.22} letterSpacing={0.12} anchorX="center" color="#e4e4e7">
            EDUCATION
          </Text>
          <Text font={monoFont} fontSize={0.11} letterSpacing={0.16} anchorX="center" position={[0, -0.32, 0]} color="#52525b">
            {education.degree}
          </Text>
        </Billboard>
      </group>
    </group>
  )
}
