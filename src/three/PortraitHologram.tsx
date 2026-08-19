import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture, Billboard, Sparkles } from '@react-three/drei'
import { Text } from '@react-three/drei'
import { useLab } from '../store/useLab'
import portraitUrl from '../assets/portrait-v2.jpg'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'

const W = 1.92
const H = W * (1080 / 720) // 2.88 — matches the photo's 2:3 aspect

/**
 * ANIMATED HOLOGRAPHIC PORTRAIT — Riyan's photo rendered as a living
 * holographic display in the hero view:
 *  - gentle float + sway
 *  - travelling scanline sweep
 *  - soft hologram flicker
 *  - rising data particles + glow frame
 * Fades out whenever the camera leaves the core view.
 */
export default function PortraitHologram({ low }: { low?: boolean }) {
  const view = useLab((s) => s.view)
  const texture = useTexture(portraitUrl)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  const group = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const frameMat = useRef<THREE.MeshBasicMaterial>(null)
  const scan = useRef<THREE.Mesh>(null)
  const scanMat = useRef<THREE.MeshBasicMaterial>(null)
  const baseY = useRef(2.3)

  // travelling scanline band (canvas gradient)
  const scanTexture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 256
    const ctx = c.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, 'rgba(45,211,145,0)')
    grad.addColorStop(0.5, 'rgba(190,242,228,0.55)')
    grad.addColorStop(1, 'rgba(45,211,145,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const visible = view === 'lab'
    const target = visible ? 1 : 0
    const k = 1 - Math.exp(-5 * dt)

    if (group.current) {
      // float + sway
      group.current.position.y = baseY.current + Math.sin(t * 0.85) * 0.09
      group.current.rotation.y = Math.sin(t * 0.35) * 0.06
      // fade in/out with the view
      const g = group.current
      g.visible = target > 0.01
    }

    if (mat.current) {
      // hologram flicker (subtle)
      const flicker = 0.93 + Math.sin(t * 9.7) * 0.04 + Math.sin(t * 23.3) * 0.02
      mat.current.opacity += (target * flicker - mat.current.opacity) * k
    }
    if (frameMat.current) {
      frameMat.current.opacity += (target * (0.55 + Math.sin(t * 1.8) * 0.15) - frameMat.current.opacity) * k
    }
    if (scan.current && scanMat.current) {
      // sawtooth sweep top → bottom
      const p = (t * 0.28) % 1
      scan.current.position.y = -H / 2 + p * H
      scanMat.current.opacity = target * (0.45 + 0.3 * Math.sin(Math.PI * p))
    }
  })

  return (
    <group position={[3.75, 2.3, 0.45]}>
      <group ref={group}>
        {/* glow backdrop */}
        <mesh position={[0, 0, -0.06]}>
          <planeGeometry args={[W + 0.3, H + 0.3]} />
          <meshBasicMaterial
            ref={frameMat}
            color="#2dd391"
            transparent
            opacity={0.12}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {/* the photo */}
        <mesh>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial ref={mat} map={texture} transparent toneMapped={false} />
        </mesh>

        {/* frame outline */}
        <lineSegments position={[0, 0, 0.005]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(W, H)]} />
          <lineBasicMaterial color="#2dd391" transparent opacity={0.85} />
        </lineSegments>

        {/* travelling scanline */}
        <mesh ref={scan} position={[0, 0, 0.01]}>
          <planeGeometry args={[W, 0.2]} />
          <meshBasicMaterial
            ref={scanMat}
            map={scanTexture}
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {/* HUD corner ticks */}
        {[
          [-W / 2, H / 2, 0.35, 0],
          [W / 2, H / 2, -Math.PI / 2, 0],
          [-W / 2, -H / 2, Math.PI / 2, 0],
          [W / 2, -H / 2, Math.PI, 0],
        ].map(([x, y, rot], i) => (
          <mesh key={i} position={[x as number, y as number, 0.012]} rotation={[0, 0, rot as number]}>
            <planeGeometry args={[0.22, 0.02]} />
            <meshBasicMaterial color="#3ee6a8" transparent opacity={0.7} depthWrite={false} />
          </mesh>
        ))}

        {/* rising data particles */}
        {!low && (
          <Sparkles
            count={16}
            scale={[W + 0.6, H + 0.4, 0.4]}
            position={[0, 0, 0.1]}
            size={1.6}
            speed={0.35}
            opacity={0.5}
            color="#2dd391"
          />
        )}

        {/* caption */}
        <Billboard position={[0, -H / 2 - 0.34, 0]}>
          <Text font={monoFont} fontSize={0.15} letterSpacing={0.34} anchorX="center" color="#e4e4e7">
            RIYAN PASHA
          </Text>
          <Text font={monoFont} fontSize={0.1} letterSpacing={0.4} anchorX="center" position={[0, -0.24, 0]} color="#3ee6a8">
            TECH KING
          </Text>
        </Billboard>
      </group>
    </group>
  )
}
