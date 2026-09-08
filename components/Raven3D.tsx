'use client'

/**
 * RAVEN — the stage.
 *
 * There is no character file to load. RAVEN is built in code, from
 * `lib/ravenMachine.ts`: a lofted mechanical skull, layered armour plates,
 * recessed sensor housings with shutters, a segmented jaw, a neck column,
 * shoulder armour, and a reactor set into the chest under the sternum. Every
 * visible change in this component is driven by the real state machine
 * (`lib/ravenStore.ts` → `RAVEN_STATES`) through `STATE_LOOK` in
 * `lib/ravenStudio.ts`; there is no timer anywhere in this file that decides to
 * make something blink, flash or breathe on its own schedule.
 *
 * What this component owns:
 *   • one WebGL context per mounted stage, and the disposal of every resource it
 *     creates — including on context loss, which is a real event on mobile Safari;
 *   • the studio rig (`STUDIO_LIGHTS`) and the ACES tone-mapping path, re-applied
 *     when the site theme changes;
 *   • adaptive quality: the tier decides geometry segment counts, DPR, the IBL and
 *     the dust field, and a frame-time governor keeps lowering DPR if the GPU
 *     disagrees with the tier we guessed.
 *
 * What it deliberately does not own: no second render loop, no post-processing
 * stack, no physics, no lip-sync model, no idle animation loop that would run
 * while the stage is off-screen.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { STAGE_RIGS, currentTheme, subscribeTheme, type RavenTheme } from '@/lib/theme'
import {
  framingFor,
  ravenDiagnosticsEnabled,
  STUDIO_ENV_INTENSITY,
  STUDIO_EXPOSURE,
  STUDIO_LIGHTS,
  studioEnvScale,
  type FramingVariant,
  type StudioTheme,
} from '@/lib/ravenStudio'
import {
  buildRavenMachine,
  disposeRavenMachine,
  driveRavenMachine,
  machineBounds,
  type MachineQuality,
  type MachineReadout,
} from '@/lib/ravenMachine'
import { sampleSpeech } from '@/lib/speechSync'

/**
 * Kept as an export because the HUD and the lab panel print it. It is not a URL:
 * the bust is procedural, so there is nothing to download and nothing that can be
 * "missing". That is the honest value for `ravenModelReport()` consumers.
 */
export const RAVEN_MODEL_URL = 'procedural://raven/machine-bust'

/** Statuses are unchanged so `RavenHUD` keeps compiling; `missing` can no longer occur. */
export type RavenModelStatus = 'loading' | 'ready' | 'missing' | 'error' | 'no-webgl'

export type Raven3DProps = {
  /** Pointer- or vision-driven offset, in the units `lib/ravenStore` publishes. */
  depth: { x: number; y: number }
  state: string
  speaking: boolean
  /** External trigger from the app; the machine treats it as a shutter re-seat. */
  blinking: boolean
  /** Reports readiness upward (used for honest HUD labelling). */
  onStatusChange?: (status: RavenModelStatus, detail?: string) => void
  /** `hero` = head and shoulders, `stage` = bust so posture is visible. */
  variant?: 'hero' | 'stage'
  className?: string
}

type QualityTier = 'high' | 'medium' | 'low'

const TIER: Record<QualityTier, { quality: MachineQuality; dpr: number; antialias: boolean; ibl: boolean; dust: number }> = {
  // Desktop discrete/iGPU: full segment counts, IBL, 2x DPR, dust field.
  high: { quality: 'high', dpr: 2, antialias: true, ibl: true, dust: 320 },
  // Laptop / small desktop: same silhouette, cheaper textures and 1.6x.
  medium: { quality: 'medium', dpr: 1.6, antialias: true, ibl: true, dust: 150 },
  // Phone: no IBL (it costs a render target and per-material shader branches),
  // fewer plates, 1.1x DPR, no dust. The design is identical, the finish is not.
  low: { quality: 'low', dpr: 1.1, antialias: false, ibl: false, dust: 0 },
}

const clamp = THREE.MathUtils.clamp

/** Exponential smoothing that behaves the same at 30, 60 and 120 fps. */
const damp = (current: number, target: number, lambda: number, dt: number) =>
  target + (current - target) * Math.exp(-lambda * dt)

function pickTier(): QualityTier {
  if (typeof window === 'undefined') return 'medium'
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const cores = Number(navigator.hardwareConcurrency) || 8
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8
  const small = window.innerWidth < 820
  // `deviceMemory` is Chrome-only; the `|| 8` default means a phone reports a
  // healthy number, which is why the viewport and pointer checks carry the weight.
  if (coarse || small) return cores >= 6 ? 'medium' : 'low'
  if (cores >= 8 && memory >= 8) return 'high'
  return cores >= 4 ? 'medium' : 'low'
}

export default function Raven3D({
  depth,
  state,
  speaking,
  blinking,
  onStatusChange,
  variant = 'hero',
  className,
}: Raven3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef({ depth, state, speaking, blinking, variant })
  const [status, setStatus] = useState<RavenModelStatus>('loading')
  // Read once per mount: a query flag must not re-render a live 3D stage.
  const [diagnostics] = useState(() => ravenDiagnosticsEnabled())
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [readout, setReadout] = useState<MachineReadout | null>(null)

  useEffect(() => {
    stateRef.current = { depth, state, speaking, blinking, variant }
  }, [depth, state, speaking, blinking, variant])

  const publishRef = useRef<(next: RavenModelStatus, detail?: string) => void>(() => {})
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    publishRef.current = (next: RavenModelStatus, detail?: string) => {
      setStatus(next)
      setStatusDetail(detail ?? '')
      onStatusChangeRef.current?.(next, detail)
    }
  }, [])

  // Rebuilt when `variant` changes: the crop and the lens are part of the rig, and
  // trying to retrofit them onto a live scene is how you get a frame with a camera
  // that no longer matches its own framing constants.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const reducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let tier = pickTier()
    let settings = TIER[tier]

    // ---------------------------------------------------------------- WebGL
    let renderer: THREE.WebGLRenderer | null = null
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: settings.antialias,
        alpha: true,
        powerPreference: tier === 'low' ? 'default' : 'high-performance',
        failIfMajorPerformanceCaveat: false,
      })
    } catch (error) {
      // WebGL unavailable or blocked: disabled GPU, enterprise policy, low-power
      // mode. The card keeps its layout and says so plainly.
      publishRef.current(
        'no-webgl',
        error instanceof Error ? `3D is unavailable in this browser: ${error.message}` : '3D is unavailable in this browser.',
      )
      return
    }

    let disposed = false
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'pan-y'
    canvas.setAttribute('aria-hidden', 'true')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.dpr))
    renderer.setClearColor(0x000000, 0)
    // One tone-mapping path for the whole scene, at exposure below the clip point of
    // the emissive budget. Emissive materials stay `toneMapped: true`, which is why
    // the ceilings in `lib/ravenStudio.ts` are what actually control the glow.
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = STUDIO_EXPOSURE.dark
    mount.appendChild(canvas)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 20)

    const disposables: Array<{ dispose: () => void }> = []
    const track = <T extends { dispose: () => void }>(resource: T): T => {
      disposables.push(resource)
      return resource
    }

    const characterRoot = new THREE.Group()
    characterRoot.name = 'RAVEN_CHARACTER_ROOT'
    scene.add(characterRoot)
    const orientation = new THREE.Group()
    orientation.name = 'RAVEN_ORIENTATION'
    characterRoot.add(orientation)

    // ------------------------------------------------------------------ dust
    const particleMaterial = track(
      new THREE.PointsMaterial({
        size: 0.0125,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    )
    let dustCount = reducedMotion ? 0 : settings.dust
    const dustGeometry = track(new THREE.BufferGeometry())
    const buildDust = (count: number) => {
      const positions = new Float32Array(Math.max(count, 1) * 3)
      let seed = 0x5eed
      const random = () => {
        seed = (seed + 0x6d2b79f5) >>> 0
        let t = seed
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      for (let i = 0; i < count; i++) {
        const radius = 0.55 + random() * 1.5
        const theta = random() * Math.PI * 2
        const phi = Math.acos(2 * random() - 1)
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
        positions[i * 3 + 1] = radius * Math.cos(phi) * 0.75
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) * 0.6
      }
      dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      dustGeometry.setDrawRange(0, count)
    }
    buildDust(dustCount)
    const particles = new THREE.Points(dustGeometry, particleMaterial)
    particles.visible = dustCount > 0
    scene.add(particles)

    // ---------------------------------------------------------------- machine
    let machine: ReturnType<typeof buildRavenMachine> | null = null
    try {
      machine = buildRavenMachine(settings.quality)
    } catch (error) {
      publishRef.current('error', error instanceof Error ? `RAVEN could not be assembled: ${error.message}` : 'RAVEN could not be assembled.')
      return
    }
    orientation.add(machine.root)

    // Real, measured bounds: the crop is solved from what was actually built, so a
    // geometry change moves the framing with it instead of silently clipping the crown.
    const bounds = machineBounds(machine)
    let framing = framingFor(variant as FramingVariant, bounds.height, { bustWidth: bounds.width, aspect: 1 })
    const aim = new THREE.Vector3(bounds.center.x, bounds.center.y + framing.lookY, bounds.center.z)

    // ------------------------------------------------------- lights + IBL / theme
    const studio: { lights: THREE.Light[] } = { lights: [] }
    const surfaceMaterials = Object.values(machine.materials) as THREE.MeshPhysicalMaterial[]
    const envBase = new Map<THREE.MeshPhysicalMaterial, number>()
    for (const material of surfaceMaterials) {
      envBase.set(material, material.envMapIntensity)
    }

    let envTexture: THREE.Texture | null = null
    if (settings.ibl) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer)
        const room = new RoomEnvironment()
        const target = pmrem.fromScene(room, 0.04)
        scene.environment = target.texture
        envTexture = target.texture
        track(target.texture)
        room.dispose()
        pmrem.dispose()
      } catch {
        scene.environment = null // image-based lighting is a quality option, never a requirement
      }
    }

    const applyRig = (theme: RavenTheme) => {
      const rig = STAGE_RIGS[theme]
      const studioTheme: StudioTheme = theme === 'light' ? 'light' : 'dark'
      renderer!.toneMappingExposure = STUDIO_EXPOSURE[studioTheme]

      for (const light of studio.lights) scene.remove(light)
      studio.lights = []
      for (const spec of STUDIO_LIGHTS[studioTheme]) {
        const light =
          spec.kind === 'ambient'
            ? new THREE.AmbientLight(spec.color, spec.intensity)
            : spec.kind === 'directional'
              ? new THREE.DirectionalLight(spec.color, spec.intensity)
              : new THREE.PointLight(spec.color, spec.intensity, spec.distance, spec.decay)
        if (spec.position) light.position.set(spec.position[0], spec.position[1], spec.position[2])
        scene.add(light)
        studio.lights.push(light)
      }

      particleMaterial.color.setHex(rig.particles.color)
      particleMaterial.size = rig.particles.size
      particleMaterial.opacity = dustCount > 0 ? rig.particles.opacity : 0

      // Metal is relit, not recoloured: only the environment strength follows the
      // theme. The tint the UI uses would wash gunmetal back to grey.
      const envScale = studioEnvScale(studioTheme)
      for (const material of surfaceMaterials) {
        const base = envBase.get(material) ?? STUDIO_ENV_INTENSITY[studioTheme]
        material.envMapIntensity = base * envScale * (scene.environment ? 1 : 0)
        material.needsUpdate = true
      }
      // Light theme needs a little more key or the silhouette reads against white.
      const key = studio.lights.find((light) => light instanceof THREE.DirectionalLight)
      if (key) key.intensity = (key as THREE.DirectionalLight).intensity * (theme === 'light' ? 1.08 : 1)
    }

    applyRig(currentTheme() ?? 'dark')
    const unsubscribeTheme = subscribeTheme(() => {
      if (!disposed) applyRig(currentTheme() ?? 'dark')
    })

    // ----------------------------------------------------------------- sizing
    const resize = () => {
      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)
      renderer!.setSize(width, height, false)
      const aspect = width / height
      camera.aspect = aspect
      // Narrow frames get a wider crop (never a zoom-in), which is what keeps the
      // pauldrons inside the frame on a phone in portrait.
      framing = framingFor(variant as FramingVariant, bounds.height, { bustWidth: bounds.width, aspect })
      camera.fov = framing.fov
      camera.position.set(aim.x, aim.y, aim.z + framing.distance)
      camera.lookAt(aim.x, aim.y, aim.z)
      camera.updateProjectionMatrix()
    }
    resize()
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(mount)
    } else {
      window.addEventListener('resize', resize)
    }

    // ------------------------------------------------------- visibility gating
    let inView = true
    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) inView = entry.isIntersecting
        },
        { rootMargin: '120px' },
      )
      observer.observe(mount)
    }

    // --------------------------------------------------------------- the loop
    let frame = 0
    let last = performance.now() / 1000
    let clock = 0
    let samples = 0
    let sampleTotal = 0
    let cooldown = 0
    let published = false
    const pointer = { x: 0, y: 0 }

    /**
     * Adaptive quality. The tier we guessed at mount is a starting point: this reads
     * real frame times and spends the only levers that do not cause a visible rebuild,
     * in that order — resolution, then the dust field, then geometry. Nothing here
     * ever lowers the *design*: a `low` build shows the same bust with fewer segments.
     */
    const govern = (dt: number) => {
      samples += 1
      sampleTotal += dt
      if (samples < 48) return
      const average = sampleTotal / samples
      samples = 0
      sampleTotal = 0
      if (cooldown > 0) {
        cooldown -= 1
        return
      }
      const dpr = Math.min(window.devicePixelRatio || 1, settings.dpr)
      if (average > 0.028 && dpr > 1) {
        const next = Math.max(1, dpr * 0.8)
        renderer!.setPixelRatio(next)
        settings = { ...settings, dpr: next }
        cooldown = 2
      } else if (average > 0.038 && dustCount > 0) {
        dustCount = 0
        particles.visible = false
        particleMaterial.opacity = 0
        cooldown = 2
      } else if (average > 0.045 && tier !== 'low') {
        // Still too slow: fewer triangles. That means a rebuild, which is rare
        // enough that the one-frame hitch is the right trade against a stuttering page.
        tier = tier === 'high' ? 'medium' : 'low'
        settings = TIER[tier]
        if (machine) {
          orientation.remove(machine.root)
          disposeRavenMachine(machine)
        }
        machine = buildRavenMachine(settings.quality)
        orientation.add(machine.root)
        if (published && machine) publishRef.current('ready', describe(machine))
        cooldown = 4
      }
    }

    const renderFrame = () => {
      if (disposed) return
      frame = requestAnimationFrame(renderFrame)
      const now = performance.now() / 1000
      const dt = clamp(now - last, 0, 0.1)
      last = now
      const active = inView && !document.hidden
      if (!active) return

      const current = stateRef.current
      // Pointer awareness: the stage tracks the pointer in *its own* box and hands
      // over the offset; `lib/ravenStore` may also be feeding head-tracker depth.
      pointer.x = damp(pointer.x, current.depth?.x ?? 0, 6, dt)
      pointer.y = damp(pointer.y, current.depth?.y ?? 0, 6, dt)

      clock += dt
      const speakingActive = Boolean(current.speaking) || current.state === 'SPEAKING'
      const speech = speakingActive ? sampleSpeech(clock) : null

      if (machine) {
        driveRavenMachine(machine, {
          state: current.state,
          pointer,
          speaking: speakingActive,
          speechEnergy: speech ? clamp(speech.energy, 0, 1) : 0,
          speechOpenness: speech ? clamp(speech.openness, 0, 1) : 0,
          time: clock,
          dt,
          reducedMotion,
          active,
          externalBlink: Boolean(current.blinking),
        })
      }
      if (!reducedMotion) particles.rotation.y += dt * 0.012

      renderer!.render(scene, camera)

      govern(dt)

      if (!published) {
        published = true
        publishRef.current('ready', describe(machine!))
      }
      if (diagnostics && machine && Math.floor(clock * 2) !== Math.floor((clock - dt) * 2)) {
        setReadout({ ...machine.readout })
      }
    }

    const describe = (target: NonNullable<typeof machine>) =>
      `${target.stats.meshes} meshes · ${target.stats.triangles} tris · ${target.stats.quality} build · procedural`

    // -------------------------------------------------------- context loss
    const contextLost = (event: Event) => {
      // Without preventDefault the browser never fires `webglcontextrestored`.
      event.preventDefault()
      cancelAnimationFrame(frame)
      publishRef.current('error', 'The graphics context was lost; RAVEN pauses until the browser restores it.')
    }
    const contextRestored = () => {
      published = false
      last = performance.now() / 1000
      publishRef.current('ready', machine ? describe(machine) : 'RAVEN rebuilt.')
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(renderFrame)
    }
    canvas.addEventListener('webglcontextlost', contextLost, false)
    canvas.addEventListener('webglcontextrestored', contextRestored, false)

    frame = requestAnimationFrame(renderFrame)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      unsubscribeTheme()
      if (resizeObserver) resizeObserver.disconnect()
      else window.removeEventListener('resize', resize)
      observer?.disconnect()
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      if (envTexture) scene.environment = null
      scene.clear()
      if (machine) {
        disposeRavenMachine(machine)
        machine = null
      }
      for (const resource of disposables) {
        try {
          resource.dispose()
        } catch {
          /* one failing dispose must not abort the rest */
        }
      }
      disposables.length = 0
      try {
        renderer?.dispose()
        // Frees the context so two stages on one page do not exhaust the browser's
        // per-page context limit.
        renderer?.forceContextLoss?.()
      } catch {
        /* ignore */
      }
      if (canvas.parentElement === mount) mount.removeChild(canvas)
      renderer = null
    }
  }, [variant, diagnostics])


  return (
    <div
      ref={mountRef}
      className={`raven-3d-container${className ? ` ${className}` : ''}`}
      data-raven-variant={variant}
      data-raven-state={state}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 340,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {status !== 'ready' ? (
        <div className={`raven-model-state raven-model-state--${status}`} role="status">
          <span className="raven-model-state__title">
            {status === 'loading'
              ? 'ASSEMBLING RAVEN'
              : status === 'no-webgl'
                ? '3D UNAVAILABLE'
                : 'RAVEN ASSEMBLY ERROR'}
          </span>
          <span className="raven-model-state__detail">
            {statusDetail || 'The bust is generated in code; there is no asset to download.'}
          </span>
        </div>
      ) : null}
      {/* Diagnostics are opt-in (?ravenDebug=1). It used to sit across the chin; a
          portrait is not a dashboard. */}
      {status === 'ready' && diagnostics && readout ? (
        <div className="raven-model-state raven-model-state--info" role="status">
          <span className="raven-model-state__title">RAVEN · {readout.state}</span>
          <span className="raven-model-state__detail">
            {readout.lookLabel} · sensors {readout.eyeIntensity.toFixed(2)} · core {readout.coreRateHz.toFixed(2)} Hz ·
            flow {readout.flowSpeed.toFixed(2)} · aperture {readout.aperture.toFixed(2)}
          </span>
        </div>
      ) : null}
    </div>
  )
}
