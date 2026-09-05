import * as THREE from 'three'
import { Grid } from '@react-three/drei'

export default function LabFloor({ low }: { low?: boolean }) {
  return (
    <group>
      {/* solid floor disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#0a090d" roughness={0.95} metalness={0.1} />
      </mesh>

      {/* fine technical grid — warm graphite */}
      <Grid
        position={[0, 0, 0]}
        infiniteGrid
        cellSize={1.4}
        cellThickness={0.55}
        cellColor="#1a161f"
        sectionSize={7}
        sectionThickness={1}
        sectionColor="#262030"
        fadeDistance={34}
        fadeStrength={1.6}
      />

      {/* concentric technical rings */}
      {[3.4, 6.4, 9.6, 12.6].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[r, r + 0.016, 96]} />
          <meshBasicMaterial
            color={i === 1 ? '#313138' : '#211c28'}
            transparent
            opacity={i === 1 ? 0.5 : 0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* faint radial holo lines */}
      {!low &&
        Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2
          return (
            <mesh key={i} rotation={[-Math.PI / 2, 0, a]} position={[0, 0.001, 0]}>
              <planeGeometry args={[0.012, 13.6]} />
              <meshBasicMaterial color="#16121c" transparent opacity={0.8} depthWrite={false} />
            </mesh>
          )
        })}
    </group>
  )
}
