import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text, Billboard } from '@react-three/drei'
import StationChassis from './StationChassis'
import { useLab } from '../store/useLab'
import { STATIONS } from '../data/views'
import { projects, skills, WORLD_HUES } from '../data/portfolio'
import displayFont from '@fontsource/inter/files/inter-latin-500-normal.woff'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

const GOLD = '#2dd391'

/* ------------------------------------------------------------------ */
/*  WORLD 01 · AI — the interactive skill constellation               */
/* ------------------------------------------------------------------ */
function fibonacciSphere(n: number, radius: number) {
  const pts: THREE.Vector3[] = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = phi * i
    pts.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(radius))
  }
  return pts
}

function AiStation({ low }: { low?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const setHoveredSkill = useLab((s) => s.setHoveredSkill)
  const setHoveredStation = useLab((s) => s.setHoveredStation)
  const hoveredSkill = useLab((s) => s.hoveredSkill)
  const view = useLab((s) => s.view)

  const N = low ? 40 : 80
  const sphere = useMemo(() => fibonacciSphere(N, 1.05), [N])
  const skillNodes = useMemo(
    () => skills.map((skill, i) => ({ idx: Math.floor((i * N) / skills.length), skill })),
    [N],
  )
  const linePositions = useMemo(() => {
    const segs: number[] = []
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (sphere[i].distanceTo(sphere[j]) < 0.6) {
          segs.push(...sphere[i].toArray(), ...sphere[j].toArray())
        }
      }
    }
    return new Float32Array(segs)
  }, [sphere])

  useFrame((state, dt) => {
    if (!group.current) return
    group.current.rotation.y += dt * 0.07
    group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.12
  })

  return (
    <group>
      <group ref={group}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <pointsMaterial color="#3a3542" size={0.02} transparent opacity={0.7} depthWrite={false} />
        </points>
        {sphere.map((p, i) => {
          const node = skillNodes.find((n) => n.idx === i)
          const isSkill = !!node
          const skillId = node?.skill.id ?? null
          const hue = node ? WORLD_HUES[node.skill.world] : '#2c2733'
          const hovered = hoveredSkill === skillId
          const isActive = view === 'ai'
          const scale = hovered ? 2 : isSkill ? 1.25 : 0.55
          return (
            <mesh
              key={i}
              position={p}
              scale={scale}
              onClick={(e) => {
                e.stopPropagation()
                if (skillId) setHoveredSkill(skillId)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHoveredStation('ai')
                document.body.style.cursor = 'pointer'
                if (skillId) setHoveredSkill(skillId)
              }}
              onPointerOut={() => {
                setHoveredStation(null)
                document.body.style.cursor = 'auto'
                if (skillId) setHoveredSkill(null)
              }}
            >
              <sphereGeometry args={[0.055, 10, 10]} />
              <meshBasicMaterial
                color={hovered ? '#ffffff' : isSkill ? (isActive ? hue : hue) : '#241f2b'}
                toneMapped={false}
              />
            </mesh>
          )
        })}
      </group>
      {hoveredSkill && (
        <Billboard position={[0, 1.75, 0]}>
          <Text font={displayFont} fontSize={0.26} letterSpacing={0.08} anchorX="center" color="#e4e4e7">
            {hoveredSkill.toUpperCase()}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 02 · DATA — crystal lattice (violet)                        */
/* ------------------------------------------------------------------ */
function DataStation({ low }: { low?: boolean }) {
  const crystals = useRef<THREE.Group>(null)
  const seed = useMemo(
    () =>
      Array.from({ length: low ? 4 : 7 }).map((_, i) => ({
        x: Math.sin(i * 2.4) * 0.52,
        z: Math.cos(i * 1.7) * 0.52,
        s: 0.3 + ((i * 37) % 10) / 13,
        rot: i * 0.9,
        speed: 0.4 + (i % 3) * 0.2,
      })),
    [low],
  )
  useFrame((state, dt) => {
    if (!crystals.current) return
    crystals.current.rotation.y += dt * 0.25
    crystals.current.children.forEach((c, i) => {
      const d = seed[i]
      if (!d) return
      c.position.y = Math.sin(state.clock.elapsedTime * d.speed + i) * 0.06
    })
  })
  return (
    <>
      <group ref={crystals}>
        {seed.map((d, i) => (
          <group key={i} position={[d.x, 0.42 + d.s * 0.62, d.z]} rotation={[0, d.rot, d.rot * 0.4]}>
            <mesh scale={[1, 1.45, 1]}>
              <octahedronGeometry args={[d.s, 0]} />
              <meshPhysicalMaterial color="#211d40" roughness={0.08} metalness={0.35} transparent opacity={0.88} clearcoat={1} />
            </mesh>
            <mesh scale={[1, 1.45, 1]}>
              <octahedronGeometry args={[d.s * 0.74, 0]} />
              <meshBasicMaterial color={i % 3 === 0 ? '#9db2ff' : '#c9c4ef'} wireframe transparent opacity={0.9} />
            </mesh>
            <mesh scale={[1.02, 1.48, 1.02]}>
              <octahedronGeometry args={[d.s, 0]} />
              <meshBasicMaterial color="#9db2ff" wireframe transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh>
        <icosahedronGeometry args={[0.68, 0]} />
        <meshBasicMaterial color="#2a2a52" wireframe transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.85, 16, 16]} />
        <meshBasicMaterial color="#4a4690" transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 03 · SOFTWARE — chip tower (coral)                          */
/* ------------------------------------------------------------------ */
function SoftwareStation({ low }: { low?: boolean }) {
  const tower = useRef<THREE.Group>(null)
  const orb = useRef<THREE.Group>(null)
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (tower.current) {
      tower.current.rotation.y += dt * 0.22
      tower.current.position.y = Math.sin(t * 0.9) * 0.07
    }
    if (orb.current) {
      orb.current.children.forEach((c, i) => {
        const a = t * 0.9 + (i / 3) * Math.PI * 2
        c.position.set(Math.cos(a) * 1.1, Math.sin(a * 1.2) * 0.28, Math.sin(a) * 1.1)
      })
    }
  })
  const layers = [
    { y: -0.42, s: [0.62, 0.1, 0.5] },
    { y: -0.1, s: [0.78, 0.1, 0.62] },
    { y: 0.22, s: [0.62, 0.1, 0.5] },
    { y: 0.54, s: [0.78, 0.1, 0.62] },
  ]
  return (
    <group>
      <group ref={tower}>
        {layers.map((l, i) => (
          <group key={i} rotation={[0, i * 0.5, 0]}>
            <mesh position={[0, l.y, 0]}>
              <boxGeometry args={l.s as [number, number, number]} />
              <meshPhysicalMaterial color="#251a17" roughness={0.18} metalness={0.5} transparent opacity={0.9} clearcoat={0.7} />
            </mesh>
            <lineSegments position={[0, l.y, 0]}>
              <edgesGeometry args={[new THREE.BoxGeometry(...l.s)]} />
              <lineBasicMaterial color="#ffa06a" transparent opacity={0.65} />
            </lineSegments>
            <mesh position={[0, l.y + 0.062, 0]} scale={[0.5, 1, 0.4]}>
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial color="#3d2218" toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={orb}>
        {Array.from({ length: 3 }).map((_, i) => (
          <mesh key={i}>
            <boxGeometry args={[0.07, 0.07, 0.07]} />
            <meshBasicMaterial color={i % 2 ? '#ffb28f' : '#ffa06a'} toneMapped={false} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 04 · MOBILE — floating device slab (green)                  */
/* ------------------------------------------------------------------ */
function MobileStation({ low }: { low?: boolean }) {
  const device = useRef<THREE.Group>(null)
  const chipA = useRef<THREE.Group>(null)
  const chipB = useRef<THREE.Group>(null)
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (device.current) {
      device.current.rotation.y += dt * 0.3
      device.current.position.y = Math.sin(t * 1.1) * 0.08
    }
    if (chipA.current) {
      chipA.current.children.forEach((c, i) => {
        const a = t * 0.8 + (i / 3) * Math.PI * 2
        c.position.set(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05)
      })
    }
    if (chipB.current) {
      chipB.current.children.forEach((c, i) => {
        const a = -t * 0.55 + (i / 2) * Math.PI
        c.position.set(Math.cos(a) * 1.35, Math.sin(a) * 0.3, Math.sin(a) * 1.35)
      })
    }
  })
  return (
    <group>
      <group ref={device}>
        <mesh scale={[0.62, 1.12, 0.06]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshPhysicalMaterial color="#141812" roughness={0.2} metalness={0.5} transparent opacity={0.85} clearcoat={0.7} />
        </mesh>
        <mesh position={[0, 0.06, 0.045]} scale={[0.5, 0.92, 0.02]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#0d2b1c" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.06, 0.058]} scale={[0.5, 0.02, 0.02]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#7fe8a8" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.64, 1.14, 0.1]} />
          <meshBasicMaterial color="#7fe8a8" transparent opacity={0.14} depthWrite={false} />
        </mesh>
      </group>
      <group ref={chipA}>
        {Array.from({ length: 3 }).map((_, i) => (
          <mesh key={i}>
            <boxGeometry args={[0.08, 0.08, 0.08]} />
            <meshBasicMaterial color="#d4e8d0" toneMapped={false} transparent opacity={0.8} />
          </mesh>
        ))}
      </group>
      <group ref={chipB}>
        {Array.from({ length: 2 }).map((_, i) => (
          <mesh key={i}>
            <boxGeometry args={[0.06, 0.06, 0.06]} />
            <meshBasicMaterial color="#7fe8a8" toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 05 · WEB — mesh globe with orbiters (sky)                   */
/* ------------------------------------------------------------------ */
function WebStation({ low }: { low?: boolean }) {
  const globe = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const nodes = useRef<THREE.Group>(null)
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (globe.current) globe.current.rotation.y += dt * 0.14
    if (ring.current) ring.current.rotation.z += dt * 0.5
    if (nodes.current) {
      nodes.current.children.forEach((c, i) => {
        const a = t * 0.7 + (i / 6) * Math.PI * 2
        c.position.set(Math.cos(a) * 1.5, Math.sin(a * 0.9) * 0.2, Math.sin(a) * 1.5)
      })
    }
  })
  return (
    <group>
      <mesh ref={globe}>
        <icosahedronGeometry args={[0.85, 1]} />
        <meshBasicMaterial color="#6fc4f0" wireframe transparent opacity={0.4} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.85, 16, 16]} />
        <meshBasicMaterial color="#6fc4f0" transparent opacity={0.05} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2.6, 0.3, 0]}>
        <torusGeometry args={[1.25, 0.012, 8, 96]} />
        <meshBasicMaterial color="#6fc4f0" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <group ref={nodes}>
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.05, 10, 10]} />
            <meshBasicMaterial color={i % 3 === 0 ? '#d8ecff' : '#6fc4f0'} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 06 · CLOUD — layered drifting arcs (steel blue)             */
/* ------------------------------------------------------------------ */
function CloudStation({ low }: { low?: boolean }) {
  const arcs = useRef<THREE.Group>(null)
  const layers = [
    { y: -0.28, r: 0.72, arc: Math.PI * 1.5, rot: 0.2 },
    { y: 0.0, r: 0.92, arc: Math.PI * 1.15, rot: 2.4 },
    { y: 0.3, r: 0.68, arc: Math.PI * 1.35, rot: 4.1 },
    { y: 0.58, r: 0.5, arc: Math.PI * 1.2, rot: 1.2 },
  ]
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (arcs.current) {
      arcs.current.position.y = Math.sin(t * 0.8) * 0.09
      arcs.current.children.forEach((c, i) => {
        c.rotation.y += dt * (0.1 + i * 0.04)
      })
    }
  })
  return (
    <group>
      <group ref={arcs}>
        {layers.map((l, i) => (
          <mesh key={i} position={[0, l.y, 0]} rotation={[0, l.rot, 0]}>
            <torusGeometry args={[l.r, 0.045, 10, 48, l.arc]} />
            <meshPhysicalMaterial color="#151a24" roughness={0.2} metalness={0.4} transparent opacity={0.75} clearcoat={0.6} />
          </mesh>
        ))}
        {layers.map((l, i) => (
          <mesh key={`e${i}`} position={[0, l.y, 0]} rotation={[0, l.rot, 0]}>
            <torusGeometry args={[l.r, 0.016, 8, 48, l.arc]} />
            <meshBasicMaterial color="#8fa3b8" transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#d8e2f5" toneMapped={false} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 07 · AUTOMATION — rotating gear (lime)                      */
/* ------------------------------------------------------------------ */
function AutomationStation({ low }: { low?: boolean }) {
  const gear = useRef<THREE.Group>(null)
  const spokes = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (gear.current) gear.current.rotation.y += dt * 0.4
    if (spokes.current) spokes.current.rotation.y -= dt * 0.7
  })
  return (
    <group>
      <group ref={gear}>
        <mesh rotation={[Math.PI / 2.4, 0.2, 0]}>
          <torusGeometry args={[0.62, 0.06, 12, 48]} />
          <meshPhysicalMaterial color="#1c1f14" roughness={0.25} metalness={0.6} transparent opacity={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2.4, 0.2, 0]}>
          <torusGeometry args={[0.62, 0.02, 8, 48]} />
          <meshBasicMaterial color="#b8e06e" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2.4, 0.2, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.1, 16]} />
          <meshStandardMaterial color="#2a2c1c" roughness={0.3} metalness={0.7} />
        </mesh>
      </group>
      <group ref={spokes}>
        {Array.from({ length: 5 }).map((_, i) => (
          <mesh key={i} rotation={[0, (i / 5) * Math.PI * 2, Math.PI / 2.6]} position={[0, 0, 0]}>
            <boxGeometry args={[1.5, 0.03, 0.03]} />
            <meshBasicMaterial color="#b8e06e" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  WORLD 08 · EXPERIMENTS — living helix (lavender)                  */
/* ------------------------------------------------------------------ */
function ExperimentsStation({ low }: { low?: boolean }) {
  const helix = useRef<THREE.Points>(null)
  const ring = useRef<THREE.Mesh>(null)
  const count = low ? 80 : 200
  const { positions, radii, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const radii = new Float32Array(count)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const t = i / count
      radii[i] = 0.5 + t * 0.8 + Math.sin(i * 1.7) * 0.06
      speeds[i] = 0.15 + (i % 5) * 0.05
      positions[i * 3 + 1] = t * 2.7
    }
    return { positions, radii, speeds }
  }, [count])

  const phase = useRef(0)
  useFrame((state, dt) => {
    phase.current += dt
    const t = state.clock.elapsedTime
    if (helix.current) {
      const attr = helix.current.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < count; i++) {
        const a = i * 0.55 + t * speeds[i] + phase.current
        attr.array[i * 3] = Math.cos(a) * radii[i]
        attr.array[i * 3 + 2] = Math.sin(a) * radii[i]
      }
      attr.needsUpdate = true
      helix.current.rotation.y += dt * 0.2
    }
    if (ring.current) {
      ring.current.rotation.z += dt * 0.35
      ring.current.scale.setScalar(1 + Math.sin(t * 1.4) * 0.05)
    }
  })

  return (
    <group>
      <points ref={helix} position={[0, -1.35, 0]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#d8bcf0" size={0.06} sizeAttenuation transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <torusGeometry args={[0.9, 0.05, 12, 64]} />
        <meshBasicMaterial color="#c9a8f0" transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[1.02, 1.02, 0.03, 48]} />
        <meshBasicMaterial color="#332844" transparent opacity={0.55} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  09 · PROJECTS — holographic gallery panels (gold)                 */
/* ------------------------------------------------------------------ */
function ProjectsStation({ low }: { low?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const openProject = useLab((s) => s.openProject)
  const setHoveredStation = useLab((s) => s.setHoveredStation)
  const projectId = useLab((s) => s.projectId)

  const layout = useMemo(() => {
    const n = projects.length
    return projects.map((p, i) => {
      const a = (i / (n - 1)) * 1.5 - 0.75
      const r = 2.6
      return {
        p,
        x: Math.sin(a) * r,
        z: -Math.cos(a) * r + r,
        rotY: a * 0.55,
        y: 1.05 - Math.abs(a) * 0.55,
      }
    })
  }, [])

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.05
  })

  return (
    <group ref={group}>
      {layout.map(({ p, x, z, rotY, y }, i) => {
        const selected = projectId === p.id
        return (
          <group key={p.id} position={[x, y, z]} rotation={[0, rotY, 0]}>
            <mesh
              position={[0, 0.42, 0]}
              onClick={(e) => {
                e.stopPropagation()
                openProject(p.id)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHoveredStation('projects')
                document.body.style.cursor = 'pointer'
              }}
              onPointerOut={() => {
                setHoveredStation(null)
                document.body.style.cursor = 'auto'
              }}
            >
              <planeGeometry args={[1.15, 0.8]} />
              <meshPhysicalMaterial
                color="#141417"
                roughness={0.1}
                metalness={0.3}
                transparent
                opacity={selected ? 0.92 : 0.6}
                clearcoat={0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
            <lineSegments position={[0, 0.42, 0.001]}>
              <edgesGeometry args={[new THREE.PlaneGeometry(1.15, 0.8)]} />
              <lineBasicMaterial color={selected ? GOLD : '#2e2e35'} transparent opacity={selected ? 1 : 0.7} />
            </lineSegments>
            <Text font={displayFont} fontSize={0.11} letterSpacing={0.06} anchorX="center" position={[0, 0.62, 0.012]} color={selected ? '#3ee6a8' : '#e4e4e7'}>
              {p.title}
            </Text>
            <Text font={monoFont} fontSize={0.07} letterSpacing={0.12} anchorX="center" position={[0, 0.46, 0.012]} color="#a1a1aa">
              {p.category}
            </Text>
            <Text font={monoFont} fontSize={0.06} letterSpacing={0.1} anchorX="center" position={[0, 0.3, 0.012]} color="#2dd391">
              {selected ? '◉ CASE STUDY OPEN' : i === 0 ? 'CLICK TO EXPLORE' : ''}
            </Text>
            <mesh position={[0, -0.1, 0]}>
              <cylinderGeometry args={[0.05, 0.07, 0.2, 12]} />
              <meshStandardMaterial color="#1a1a1f" roughness={0.4} metalness={0.7} />
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, -0.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.1, 2.24, 48]} />
        <meshBasicMaterial color="#313138" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  10 · CONTACT — calm gold beacon                                   */
/* ------------------------------------------------------------------ */
function ContactStation() {
  const beacon = useRef<THREE.Group>(null)
  const pillar = useRef<THREE.Mesh>(null)
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (beacon.current) {
      beacon.current.rotation.y += dt * 0.1
      beacon.current.scale.setScalar(1 + Math.sin(t * 0.9) * 0.04)
    }
    if (pillar.current) {
      const m = pillar.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.13 + Math.sin(t * 1.3) * 0.05
    }
  })
  return (
    <group>
      <mesh ref={pillar} position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.09, 0.2, 3.6, 20, 1, true]} />
        <meshBasicMaterial color="#3ee6a8" transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={beacon}>
        <mesh position={[0, 0.25, 0]}>
          <torusGeometry args={[0.75, 0.018, 8, 80]} />
          <meshBasicMaterial color="#3ee6a8" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.25, 0]} rotation={[0.6, 0, 0.5]}>
          <torusGeometry args={[1.05, 0.014, 8, 80]} />
          <meshBasicMaterial color="#3ee6a8" transparent opacity={0.38} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.25, 0]} rotation={[-0.45, 0.3, 0]}>
          <torusGeometry args={[1.35, 0.011, 8, 80]} />
          <meshBasicMaterial color="#52525b" transparent opacity={0.32} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.32, 0]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshBasicMaterial color="#fff4dd" toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Assembled ring                                                     */
/* ------------------------------------------------------------------ */
export default function Stations({ low }: { low?: boolean }) {
  const setView = useLab((s) => s.setView)
  const parts: Record<string, (p: { low?: boolean }) => ReactNode> = {
    ai: AiStation,
    data: DataStation,
    software: SoftwareStation,
    mobile: MobileStation,
    web: WebStation,
    cloud: CloudStation,
    automation: AutomationStation,
    experiments: ExperimentsStation,
    projects: ProjectsStation,
    contact: ContactStation,
  }

  return (
    <group>
      {STATIONS.map((def) => {
        const Comp = parts[def.id]
        return (
          <group key={def.id} position={def.pos}>
            <StationChassis id={def.id} label={def.label} index={def.index} sub={def.sub} hue={def.hue} onClick={() => setView(def.view)}>
              {Comp({ low })}
            </StationChassis>
          </group>
        )
      })}
    </group>
  )
}
