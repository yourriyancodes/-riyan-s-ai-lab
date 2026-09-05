import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Sparkles } from '@react-three/drei'

/** floating dust + slow data streams orbiting the core (warm tones) */
export default function Particles({ low }: { low?: boolean }) {
  const streamA = useRef<THREE.Group>(null)
  const streamB = useRef<THREE.Group>(null)
  const streamC = useRef<THREE.Group>(null)

  const ringPoints = useMemo(() => {
    const count = low ? 48 : 110
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      arr[i * 3] = Math.cos(a)
      arr[i * 3 + 1] = 0
      arr[i * 3 + 2] = Math.sin(a)
    }
    return arr
  }, [low])

  useFrame((_, dt) => {
    if (streamA.current) streamA.current.rotation.y += dt * 0.06
    if (streamB.current) streamB.current.rotation.y -= dt * 0.045
    if (streamC.current) streamC.current.rotation.y += dt * 0.03
  })

  const stream = (radius: number, y: number, color: string, opacity: number) => (
    <group ref={radius === 4.8 ? streamA : radius === 7.2 ? streamB : streamC} position={[0, y, 0]}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[ringPoints, 3]} />
        </bufferGeometry>
        <pointsMaterial color={color} size={0.085} sizeAttenuation transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  )

  return (
    <>
      <Sparkles
        count={low ? 140 : 380}
        scale={[26, 11, 26]}
        size={low ? 2.2 : 1.8}
        speed={low ? 0.12 : 0.2}
        opacity={0.42}
        color="#a1a1aa"
      />
      {stream(4.8, 0.5, '#71717a', 0.34)}
      {stream(7.2, 1.6, '#52525b', 0.28)}
      {!low && stream(10.2, 2.9, '#2dd391', 0.16)}
    </>
  )
}
