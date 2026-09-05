import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useLab } from '../store/useLab'
import { VIEWS } from '../data/views'

/**
 * Camera choreography:
 *  - damped position/lookAt toward the active view's pose
 *  - gentle auto-orbit around the AI CORE while idle in the lab
 *  - subtle mouse parallax
 *  - drag to orbit (lab view), wheel to dolly
 */
export default function CameraRig() {
  const view = useLab((s) => s.view)
  const booted = useLab((s) => s.booted)
  const reducedMotion = useLab((s) => s.reducedMotion)

  const cur = useRef({
    pos: new THREE.Vector3(0, 7.5, 23),
    tgt: new THREE.Vector3(0, 1.9, 0),
    radius: 15.8,
  })
  const drag = useRef({ active: false, lastX: 0, lastY: 0, moved: false })
  const idleAt = useRef(Date.now())
  const orbitAngle = useRef(-0.35)

  const { gl, camera } = useThree()

  // pointer handling on the GL canvas
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      drag.current = { active: true, lastX: e.clientX, lastY: e.clientY, moved: false }
      idleAt.current = Date.now()
    }
    const move = (e: PointerEvent) => {
      if (!drag.current.active) return
      if (Math.abs(e.clientX - drag.current.lastX) + Math.abs(e.clientY - drag.current.lastY) > 3) {
        drag.current.moved = true
      }
      const dx = e.clientX - drag.current.lastX
      const dy = e.clientY - drag.current.lastY
      drag.current.lastX = e.clientX
      drag.current.lastY = e.clientY
      const s = useLab.getState()
      if (s.view !== 'lab') {
        // at station views, dragging nudges the parallax target slightly
        cur.current.pos.x += dx * 0.008
        cur.current.pos.y -= dy * 0.006
        cur.current.radius = Math.min(20, Math.max(10, cur.current.radius - dy * 0.004))
      } else {
        orbitAngle.current -= dx * 0.0035
      }
    }
    const up = () => {
      drag.current.active = false
      idleAt.current = Date.now()
    }
    const wheel = (e: WheelEvent) => {
      idleAt.current = Date.now()
      const s = useLab.getState()
      if (s.view === 'lab') {
        cur.current.radius = THREE.MathUtils.clamp(cur.current.radius + e.deltaY * 0.02, 12.5, 19.5)
      }
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const cfg = VIEWS[view]

    const target = new THREE.Vector3(...cfg.pos)
    const look = new THREE.Vector3(...cfg.look)

    // lab view: position derived from orbit angle + wheel-controlled radius
    // so wheel zoom and drag-orbit always take effect immediately
    const idle = Date.now() - idleAt.current > 6500
    if (view === 'lab') {
      if (idle && !reducedMotion && !drag.current.active) {
        orbitAngle.current += dt * 0.045
      }
      const r = THREE.MathUtils.clamp(cur.current.radius, 12.5, 19.5)
      target.x = Math.sin(orbitAngle.current) * r * 0.82
      target.y = 4.8 + Math.sin(orbitAngle.current * 0.6) * 0.9
      target.z = Math.cos(orbitAngle.current) * r
    }

    // mouse parallax (skip while dragging)
    if (!drag.current.active) {
      const px = state.pointer.x
      const py = state.pointer.y
      const dist = camera.position.distanceTo(look) || 1
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      target.addScaledVector(right, px * dist * 0.028)
      target.addScaledVector(up, -py * dist * 0.02)
    }

    // damped arrival — fast cinematic transitions (~0.8s)
    const lambda = view === 'lab' ? 2.4 : 3.6
    const l = 1 - Math.exp(-lambda * dt)
    cur.current.pos.lerp(target, l)
    cur.current.tgt.lerp(look, l)

    camera.position.copy(cur.current.pos)
    camera.lookAt(cur.current.tgt)

    // entrance glide from the far approach
    if (!booted) {
      camera.position.set(cur.current.pos.x, cur.current.pos.y, cur.current.pos.z + 9)
      camera.lookAt(0, 2.4, 0)
    }
  })

  return null
}
