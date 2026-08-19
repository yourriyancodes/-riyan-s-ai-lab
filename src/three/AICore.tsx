import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text, Billboard } from '@react-three/drei'
import { useLab } from '../store/useLab'
import { CORE_POS, STATIONS } from '../data/views'
import { WORLD_HUES } from '../data/portfolio'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

const GOLD = '#2dd391'
const TRIAD = ['ai', 'data', 'software']

/**
 * THE TECH KING CORE — heart of the universe.
 * Gold nucleus inside glass + wireframe shell, orbital rings, and an
 * ecosystem of spokes connecting the core to every world station.
 * The AI × DATA × SOFTWARE nexus arcs meet above the core, marking where
 * AI PRODUCT ENGINEERING emerges as an intersection — not a boundary.
 */
export default function AICore({ low }: { low?: boolean }) {
  const shell = useRef<THREE.Mesh>(null)
  const inner = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const orbs = useRef<THREE.Group>(null)
  const spokes = useRef<THREE.LineSegments>(null)
  const nexusA = useRef<THREE.Mesh>(null)
  const nexusB = useRef<THREE.Mesh>(null)
  const nexusC = useRef<THREE.Mesh>(null)
  const nexusNode = useRef<THREE.Mesh>(null)
  const view = useLab((s) => s.view)
  const hoveredStation = useLab((s) => s.hoveredStation)
  const selected = view === 'lab' || view === 'project'

  const orbCount = low ? 22 : 44
  const orbData = useMemo(() => {
    return Array.from({ length: orbCount }, (_, i) => ({
      angle: (i / orbCount) * Math.PI * 2,
      radius: 2.7 + Math.random() * 1.6,
      speed: 0.1 + Math.random() * 0.22,
      y: 0.6 + Math.random() * 2.6,
    }))
  }, [orbCount])

  // spoke geometry: core (at y≈0.9) → each station base (y≈0.4)
  const spokeData = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const baseColor = new THREE.Color('#26262c')
    STATIONS.forEach((s) => {
      positions.push(0, 0.95, 0, s.pos[0], 0.45, s.pos[2])
      const c = new THREE.Color(s.hue).multiplyScalar(0.55)
      colors.push(baseColor.r, baseColor.g, baseColor.b, c.r, c.g, c.b)
    })
    return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
  }, [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const pulse = 1 + Math.sin(t * 1.7) * 0.05
    if (shell.current) {
      shell.current.rotation.y += dt * 0.12
      shell.current.rotation.x += dt * 0.04
      shell.current.scale.setScalar(pulse * (hoveredStation === 'core' || selected ? 1.06 : 1))
    }
    if (inner.current) inner.current.rotation.y -= dt * 0.2
    if (halo.current) {
      const m = halo.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.16 + Math.sin(t * 1.4) * 0.08
    }
    if (ringA.current) ringA.current.rotation.z += dt * 0.3
    if (ringB.current) ringB.current.rotation.x += dt * 0.24
    if (orbs.current) {
      orbs.current.children.forEach((c, i) => {
        const d = orbData[i]
        if (!d) return
        c.position.x = Math.cos(d.angle + t * d.speed) * d.radius
        c.position.z = Math.sin(d.angle + t * d.speed) * d.radius
        c.position.y = d.y + Math.sin(t * 1.2 + i) * 0.12
      })
    }

    // spokes: highlight hovered world + the AI·DATA·SOFTWARE triad
    if (spokes.current) {
      const attr = spokes.current.geometry.attributes.color as THREE.BufferAttribute
      const c = attr.array as Float32Array
      const hot = hoveredStation ? TRIAD.includes(hoveredStation) ? hoveredStation : hoveredStation : null
      STATIONS.forEach((s, i) => {
        const isTriad = TRIAD.includes(s.id)
        const bright = s.id === hoveredStation || (!!hot && isTriad)
        const target = bright ? 1 : isTriad && view === 'lab' ? 0.5 : 0.28
        const cbase = new THREE.Color(s.hue)
        const cur = new THREE.Color(c[i * 6 + 3], c[i * 6 + 4], c[i * 6 + 5])
        cur.lerp(cbase.multiplyScalar(0.35 + target * 0.75), 1 - Math.exp(-5 * dt))
        c[i * 6 + 3] = cur.r; c[i * 6 + 4] = cur.g; c[i * 6 + 5] = cur.b
        const base = new THREE.Color('#26262c')
        const curB = new THREE.Color(c[i * 6], c[i * 6 + 1], c[i * 6 + 2])
        curB.lerp(base.clone().multiplyScalar(0.4 + target * 0.8), 1 - Math.exp(-5 * dt))
        c[i * 6] = curB.r; c[i * 6 + 1] = curB.g; c[i * 6 + 2] = curB.b
      })
      attr.needsUpdate = true
    }

    // nexus arcs — three arcs converging on the AI PRODUCT ENGINEERING node
    const nexusHot = hoveredStation ? TRIAD.includes(hoveredStation) : false
    const spin = dt * 0.35
    ;[nexusA, nexusB, nexusC].forEach((ref, i) => {
      if (!ref.current) return
      ref.current.rotation.y += spin * (i % 2 ? -1 : 1)
      const m = ref.current.material as THREE.MeshBasicMaterial
      m.opacity += ((nexusHot ? 0.85 : 0.4) - m.opacity) * (1 - Math.exp(-5 * dt))
    })
    if (nexusNode.current) {
      const m = nexusNode.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.75 + Math.sin(t * 2.2) * 0.25
      nexusNode.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.12)
    }
  })

  return (
    <group position={CORE_POS}>
      {/* platform */}
      <mesh position={[0, -1.62, 0]}>
        <cylinderGeometry args={[2.7, 3.1, 0.16, 64]} />
        <meshStandardMaterial color="#131316" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.75, 1.86, 64]} />
        <meshBasicMaterial color="#313138" transparent opacity={0.65} depthWrite={false} />
      </mesh>

      {/* ecosystem spokes to every world */}
      <lineSegments ref={spokes}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[spokeData.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[spokeData.colors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.5} />
      </lineSegments>

      {/* outer wireframe shell */}
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.62, 1]} />
        <meshBasicMaterial color="#2dd391" wireframe transparent opacity={0.3} />
      </mesh>

      {/* glass body */}
      <mesh ref={inner}>
        <icosahedronGeometry args={[1.18, 2]} />
        <meshPhysicalMaterial
          color="#191319"
          roughness={0.12}
          metalness={0.35}
          transparent
          opacity={0.62}
          clearcoat={0.6}
        />
      </mesh>

      {/* green nucleus — luminous, like the reference's glowing core */}
      <mesh scale={[1, 1.35, 1]}>
        <sphereGeometry args={[0.46, 24, 24]} />
        <meshBasicMaterial color={GOLD} toneMapped={false} />
      </mesh>
      <mesh scale={[1, 1.5, 1]}>
        <sphereGeometry args={[0.62, 20, 20]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* wide luminous halo */}
      <mesh scale={[1, 1.4, 1]}>
        <sphereGeometry args={[0.95, 20, 20]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* pulsing glow ring */}
      <mesh ref={halo} position={[0, 0, 0]}>
        <ringGeometry args={[0.95, 1.02, 64]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* rotating orbital rings */}
      <mesh ref={ringA} rotation={[Math.PI / 2.4, 0.4, 0]}>
        <torusGeometry args={[2.35, 0.014, 8, 128]} />
        <meshBasicMaterial color="#2dd391" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ringB} rotation={[0.9, 0, 0.7]}>
        <torusGeometry args={[2.85, 0.01, 8, 128]} />
        <meshBasicMaterial color="#8f8468" transparent opacity={0.32} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* orbital data points */}
      <group ref={orbs}>
        {orbData.map((d, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.045, 8, 8]} />
            <meshBasicMaterial color={i % 5 === 0 ? '#e4e4e7' : GOLD} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* AI × DATA × SOFTWARE nexus — the intersection where AI PRODUCT ENGINEERING lives */}
      {!low && (
        <group position={[0, 0.4, 0]}>
          <mesh ref={nexusA} rotation={[0.25, 0, 0]}>
            <torusGeometry args={[1.35, 0.02, 8, 64, Math.PI * 1.25]} />
            <meshBasicMaterial color={WORLD_HUES.ai} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh ref={nexusB} rotation={[0.25, Math.PI * 2 / 3, 0]}>
            <torusGeometry args={[1.35, 0.02, 8, 64, Math.PI * 1.25]} />
            <meshBasicMaterial color={WORLD_HUES.data} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh ref={nexusC} rotation={[0.25, Math.PI * 4 / 3, 0]}>
            <torusGeometry args={[1.35, 0.02, 8, 64, Math.PI * 1.25]} />
            <meshBasicMaterial color={WORLD_HUES.software} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh ref={nexusNode} position={[0, 1.55, 0]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshBasicMaterial color={GOLD} toneMapped={false} />
          </mesh>
          {/* intersection tag — hidden in the hero view, where the DOM hero
              text owns the centre of the screen (prevents label collision) */}
          {view !== 'lab' && (
            <Billboard position={[0, 1.95, 0]}>
              <Text font={monoFont} fontSize={0.11} letterSpacing={0.14} anchorX="center" color="#3ee6a8">
                AI × DATA × SOFTWARE
              </Text>
            </Billboard>
          )}
        </group>
      )}
    </group>
  )
}
