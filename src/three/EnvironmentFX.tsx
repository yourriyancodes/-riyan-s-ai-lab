import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useLab } from '../store/useLab'
import { VIEWS } from '../data/views'

/**
 * Environment FX — warm, gold-tinted lighting rig. Lerps background, fog
 * and light intensities toward the active view's configuration.
 */
/** light-mode lift: a slightly brighter lab so light UI panels don't clash */
const LIGHT_BG = new THREE.Color('#1a211d')

export default function EnvironmentFX() {
  const view = useLab((s) => s.view)
  const mode = useLab((s) => s.mode)
  const { scene } = useThree()

  const amb = useRef<THREE.AmbientLight>(null)
  const key = useRef<THREE.DirectionalLight>(null)
  const rim = useRef<THREE.DirectionalLight>(null)
  const coreGlow = useRef<THREE.PointLight>(null)

  const cur = useRef({
    bg: new THREE.Color('#0a0e0c'),
    fogNear: 20,
    fogFar: 46,
    ambient: 0.34,
    key: 1.0,
    accent: 1.0,
  })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const cfg = VIEWS[view]
    const c = cur.current

    const bgTarget = mode === 'light' ? LIGHT_BG : new THREE.Color(cfg.bg)
    const ambTarget = mode === 'light' ? 0.62 : cfg.ambient
    const keyTarget = mode === 'light' ? 1.35 : cfg.key

    c.bg.lerp(bgTarget, 1 - Math.exp(-2.2 * dt))
    c.fogNear += ((mode === 'light' ? 26 : cfg.fogNear) - c.fogNear) * (1 - Math.exp(-2.2 * dt))
    c.fogFar += ((mode === 'light' ? 80 : cfg.fogFar) - c.fogFar) * (1 - Math.exp(-2.2 * dt))
    c.ambient += (ambTarget - c.ambient) * (1 - Math.exp(-2.2 * dt))
    c.key += (keyTarget - c.key) * (1 - Math.exp(-2.2 * dt))
    c.accent += (cfg.accent - c.accent) * (1 - Math.exp(-2.2 * dt))

    const bg = scene.background as THREE.Color
    if (bg) bg.copy(c.bg)
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(c.bg)
      scene.fog.near = c.fogNear
      scene.fog.far = c.fogFar
    }
    if (amb.current) amb.current.intensity = c.ambient
    if (key.current) key.current.intensity = c.key * 1.15
    if (rim.current) rim.current.intensity = 0.3 + c.accent * 0.18
    if (coreGlow.current) coreGlow.current.intensity = 2.2 * (0.55 + c.accent * 0.45)
  })

  return (
    <>
      <ambientLight ref={amb} intensity={0.34} color="#3d3a42" />
      <directionalLight ref={key} position={[6, 10, 7]} intensity={1.15} color="#f4f4f5" />
      <directionalLight ref={rim} position={[-7, 5, -9]} intensity={0.4} color="#2dd391" />
      <pointLight ref={coreGlow} position={[0, 1.7, 0]} intensity={2.2} distance={17} decay={2} color="#2dd391" />
    </>
  )
}
