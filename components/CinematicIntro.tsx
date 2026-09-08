'use client'

import { useState, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { ArrowRight, Volume2, VolumeX } from 'lucide-react'
import { buildRavenMachine, disposeRavenMachine, driveRavenMachine, machineBounds, type RavenMachine } from '@/lib/ravenMachine'
import { ravenSpeechAvailable, speakRaven, stopRavenSpeech } from '@/lib/ravenVoice'

type CinematicIntroProps = {
  onComplete: () => void
  /**
   * Fires the instant the exit choreography starts, one beat before
   * `onComplete` (which only runs once nothing is left to see). The page uses it to
   * begin revealing the landing *underneath*, which is what makes this one continuous
   * scene rather than two page states.
   */
  onExitStart?: () => void
}

export default function CinematicIntro({ onComplete, onExitStart }: CinematicIntroProps) {
  const onCompleteRef = useRef(onComplete)
  const onExitStartRef = useRef(onExitStart)
  const mountedRef = useRef(true)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    onExitStartRef.current = onExitStart
  }, [onExitStart])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [sceneStage, setSceneStage] = useState<number>(0)
  const [typedTextStage, setTypedTextStage] = useState<number>(0)
  const [isSkipping, setIsSkipping] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)

  useEffect(() => {
    // Check URL params for replay override: ?intro=1 or ?replay=1
    if (typeof window !== 'undefined') {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        // The cinematic is motion by definition; honour the setting and go straight in.
        onCompleteRef.current()
        return
      }
      const params = new URLSearchParams(window.location.search)
      const forceReplay = params.get('intro') === '1' || params.get('replay') === '1'
      let hasSeen: string | null = null
      try {
        hasSeen = localStorage.getItem('riyan_intro_seen')
      } catch {
        hasSeen = null
      }

      if (!forceReplay && hasSeen === 'true') {
        onCompleteRef.current()
        return
      }
    }

    // Storytelling Shots Timing (6-10 seconds total before automatic transition):
    // SHOT 01: 0.0s -> 1.0s (Black / Distant Light)
    // SHOT 02: 1.0s -> 2.5s (Atmospheric Particles)
    // SHOT 03: 2.5s -> 4.0s (RAVEN Silhouette)
    // SHOT 04: 4.0s -> 5.2s (Light Contour)
    // SHOT 05: 5.2s -> 6.5s (Eyes Activate & Raise Gaze)
    // SHOT 06: 6.5s -> 8.0s (Greeting: "HELLO." -> "I'M RAVEN.")
    // SHOT 07: 8.0s -> 9.5s (Identity Reveal: "RIYAN PASHA")
    // SHOT 08: 9.8s (AUTOMATIC LANDING TRANSITION)
    const timers = [
      setTimeout(() => setSceneStage(1), 600),   // Distant cyan point
      setTimeout(() => setSceneStage(2), 1200),  // Particles assemble
      setTimeout(() => setSceneStage(3), 2500),  // Silhouette emerges
      setTimeout(() => setSceneStage(4), 4000),  // Contour Light
      setTimeout(() => setSceneStage(5), 5200),  // Eyes Activate
      setTimeout(() => {
        setSceneStage(6)
        setTypedTextStage(1) // "HELLO."
      }, 6500),
      setTimeout(() => setTypedTextStage(2), 7400), // "I'M RAVEN."
      setTimeout(() => setTypedTextStage(3), 8300), // "RIYAN PASHA'S AI COMPANION."
      setTimeout(() => setSceneStage(7), 9200),  // Identity Reveal
      setTimeout(() => {
        // AUTOMATIC TRANSITION TO LANDING PAGE
        handleFinish()
      }, 10800),
    ]

    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Speech Synthesis Greeting Trigger during SHOT 06
  /**
   * The greeting is RAVEN speaking, so it goes through RAVEN's one voice controller —
   * same resolved voice, same prosody, same cancel-before-speak. This effect used to build
   * its own `SpeechSynthesisUtterance` with its own three-name voice guess and its own
   * rate and pitch, which is the second half of the "sometimes male, sometimes female"
   * report: the welcome line and the answers were literally programmed to pick different
   * voices, and both fell back to the browser default when Chrome had not populated
   * `getVoices()` yet. `spokenForRef` keeps Strict Mode's double effect run from queueing
   * the line twice, while still letting a deliberate mute/unmute re-greet.
   */
  const spokenForRef = useRef<boolean | null>(null)
  useEffect(() => {
    const activated = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive : undefined
    // Skip the spoken greeting until the visitor has interacted, otherwise the
    // browser rejects the utterance and logs an autoplay error.
    if (activated === false) return
    if (typedTextStage !== 1 || !ravenSpeechAvailable()) return
    if (spokenForRef.current === audioEnabled) return
    spokenForRef.current = audioEnabled
    if (!audioEnabled) return
    void speakRaven("Hello. I am RAVEN, Riyan Pasha's AI companion.")
  }, [typedTextStage, audioEnabled])

  // 3D Three.js Cinematic Scene
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let animationFrameId = 0
    let startTime = performance.now()

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x05070a, 0.22)

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 100)
    camera.position.set(0, 0, 7.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const ambientLight = new THREE.AmbientLight(0x05070a, 1.0)
    scene.add(ambientLight)

    const cyanKeyLight = new THREE.PointLight(0x00e5ff, 0, 10)
    cyanKeyLight.position.set(0, 0, 2)
    scene.add(cyanKeyLight)

    const violetRimLight = new THREE.DirectionalLight(0x8b5cf6, 0)
    violetRimLight.position.set(0, 3, -4)
    scene.add(violetRimLight)

    // SCENE PARTICLES
    const particleCount = 500
    const pPositions = new Float32Array(particleCount * 3)

    for (let i = 0; i < particleCount; i++) {
      pPositions[i * 3] = (Math.random() - 0.5) * 12
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 12
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2
    }

    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3))

    const pMat = new THREE.PointsMaterial({
      color: 0x00e5ff,
      size: 0.02,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    })

    const pCloud = new THREE.Points(pGeo, pMat)
    scene.add(pCloud)

    // RAVEN SILHOUETTE — the same procedural bust the console renders, at the lowest
    // quality tier and re-lit so that only its contour reads. Deliberately not a
    // primitive head and not a photo of a person: if the bust cannot be assembled, this
    // sequence stays light and particles and says nothing false.
    const silhouette = new THREE.Group()
    scene.add(silhouette)

    const silhouetteMaterials: THREE.MeshStandardMaterial[] = []
    let machine: RavenMachine | null = null
    const glowTexture = (() => {
      const size = 64
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (context) {
        const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        gradient.addColorStop(0, 'rgba(210,250,255,1)')
        gradient.addColorStop(0.35, 'rgba(0,229,255,0.55)')
        gradient.addColorStop(1, 'rgba(0,229,255,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, size, size)
      }
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    })()

    const glowSpriteMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const leftEyeGlow = new THREE.Sprite(glowSpriteMaterial)
    const rightEyeGlow = new THREE.Sprite(glowSpriteMaterial.clone())
    leftEyeGlow.scale.setScalar(0.1)
    rightEyeGlow.scale.setScalar(0.1)
    silhouette.add(leftEyeGlow, rightEyeGlow)

    try {
      machine = buildRavenMachine('low')
      silhouette.add(machine.root)
      machine.root.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.frustumCulled = false
        // The instanced glow families are unlit by construction (they are emission, not
        // surface), which is exactly wrong for a silhouette: drop them and let the two
        // sprites carry the eyes instead.
        const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[]
        if (materials.some((material) => (material as THREE.MeshBasicMaterial).isMeshBasicMaterial)) mesh.visible = false
      })
      for (const group of Object.values(machine.groups)) group.mesh.visible = false

      // One dark, semi-transparent surface for the whole bust: the intro needs a
      // contour, not the material study. Mutated in place because these materials are
      // already per-build (this is a private `low` assembly), so there is nothing to
      // share with the hero stage and nothing extra to dispose.
      const unique = new Set<THREE.MeshStandardMaterial>()
      machine.root.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material || (material as THREE.MeshBasicMaterial).isMeshBasicMaterial) continue
          unique.add(material as THREE.MeshStandardMaterial)
        }
      })
      for (const material of unique) {
        material.color.setHex(0x070a10)
        material.roughness = 0.5
        material.metalness = 0.2
        material.emissive.setHex(0x081520)
        material.emissiveIntensity = 0.4
        material.transparent = true
        material.opacity = 0
        material.needsUpdate = true
        silhouetteMaterials.push(material)
      }

      const bounds = machineBounds(machine)
      const scale = 1.15 / Math.max(bounds.height, 1e-3)
      silhouette.scale.setScalar(scale)
      // The sensors sit about a quarter of the bust below the crown; centring on that
      // rather than on the bounds keeps the head in the upper third, which is where the
      // title needs the space.
      const headLocalY = bounds.center.y + bounds.height * 0.244
      silhouette.position.set(-bounds.center.x * scale, -headLocalY * scale + 0.15, 0)
      silhouette.updateMatrixWorld(true)
      machine.root.updateMatrixWorld(true)

      // Measured, not guessed: the glow sprites are placed at the emitters' own world
      // positions, so they stay correct if the housing is ever re-authored.
      const seen = new Set<string>()
      for (const [sprite, sensor] of [
        [leftEyeGlow, machine.sensors.left],
        [rightEyeGlow, machine.sensors.right],
      ] as const) {
        const point = new THREE.Vector3()
        sensor.getWorldPosition(point)
        silhouette.worldToLocal(point)
        sprite.position.copy(point)
        sprite.scale.setScalar(0.1 / Math.max(scale, 1e-3))
        seen.add(sprite.uuid)
      }
      if (seen.size === 0) {
        leftEyeGlow.visible = false
        rightEyeGlow.visible = false
      }
    } catch {
      // No bust, no silhouette: the particles and the type still carry the shot.
      if (machine) {
        silhouette.remove(machine.root)
        disposeRavenMachine(machine)
        machine = null
      }
      leftEyeGlow.visible = false
      rightEyeGlow.visible = false
    }

    const handleResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    let lastFrame = performance.now()
    const animate = (now: number) => {
      if (disposed) return
      animationFrameId = requestAnimationFrame(animate)

      const elapsed = (now - startTime) / 1000

      if (elapsed > 0.6 && elapsed < 1.8) {
        cyanKeyLight.intensity = THREE.MathUtils.lerp(cyanKeyLight.intensity, 1.2, 0.05)
        pMat.opacity = THREE.MathUtils.lerp(pMat.opacity, 0.3, 0.05)
      }

      if (elapsed >= 2.5 && elapsed < 4.5) {
        for (const material of silhouetteMaterials) {
          material.opacity = THREE.MathUtils.lerp(material.opacity, 0.92, 0.04)
        }
        violetRimLight.intensity = THREE.MathUtils.lerp(violetRimLight.intensity, 3.5, 0.04)
      }

      if (elapsed >= 5.2 && elapsed < 6.5) {
        // Eyes activate and the gaze lifts off the floor.
        const leftMaterial = leftEyeGlow.material as THREE.SpriteMaterial
        const rightMaterial = rightEyeGlow.material as THREE.SpriteMaterial
        leftMaterial.opacity = THREE.MathUtils.lerp(leftMaterial.opacity, 0.95, 0.08)
        rightMaterial.opacity = THREE.MathUtils.lerp(rightMaterial.opacity, 0.95, 0.08)
        silhouette.rotation.x = THREE.MathUtils.lerp(silhouette.rotation.x, -0.05, 0.04)
        for (const material of silhouetteMaterials) {
          material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, 0.75, 0.05)
        }
      }

      if (elapsed >= 6.5) {
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, 4.4, 0.03)
        silhouette.position.y = 0.15 + Math.sin(elapsed * 1.5) * 0.02
        // A slow turn of the head under the greeting — the bust's own drive supplies
        // the stabilisation, this only keeps the contour from freezing.
        silhouette.rotation.y = Math.sin(elapsed * 0.55) * 0.05
      }

      pCloud.rotation.y += 0.001
      // The bust is driven, not posed: its idle is head stabilisation and the core's
      // own pulse, so the silhouette is alive without a hand-animated loop.
      if (machine) {
        const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.05)
        lastFrame = now
        driveRavenMachine(machine, {
          state: 'IDLE',
          pointer: { x: 0, y: 0 },
          speaking: false,
          speechEnergy: 0,
          speechOpenness: 0,
          time: elapsed,
          dt,
          reducedMotion: false,
          active: true,
          externalBlink: false,
        })
      }
      renderer.render(scene, camera)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      pGeo.dispose()
      pMat.dispose()
      glowTexture.dispose()
      glowSpriteMaterial.dispose()
      ;(rightEyeGlow.material as THREE.SpriteMaterial).dispose()
      // The bust is this component's own private build, so its geometry, materials and
      // textures are ours to release; the hero stage assembles a separate one.
      if (machine) {
        disposeRavenMachine(machine)
        machine = null
      }
      silhouetteMaterials.length = 0
      renderer.dispose()
      renderer.forceContextLoss?.()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  const finishTimerRef = useRef<number | null>(null)

  /**
   * The handoff. `isSkipping` puts the veil into its exiting state (CSS owns the actual
   * choreography: content lifts at 0, veil falls from 300 ms, landing rises underneath),
   * and `onExitStart` tells the page to start that landing half *now* — not after the
   * fade, which is what made the old version feel like a page swap. `onComplete` is then
   * deliberately late (1.2 s): the overlay is invisible for the last ~300 ms of it, but
   * removing it the moment the fade ends is what produced the pop.
   */
  const handleFinish = () => {
    if (isSkipping) return
    setIsSkipping(true)
    onExitStartRef.current?.()
    try {
      localStorage.setItem('riyan_intro_seen', 'true')
    } catch {
      /* storage blocked — the intro just plays again next visit */
    }
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current)
    finishTimerRef.current = window.setTimeout(() => {
      finishTimerRef.current = null
      if (mountedRef.current) onCompleteRef.current()
    }, reducedMotion ? 0 : 1200)
  }

  useEffect(
    () => () => {
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current)
    },
    [],
  )

  return (
    <div
      className={`intro-veil fixed inset-0 z-[999] bg-[#05070a] text-white overflow-hidden ${
        isSkipping ? 'intro-veil--exiting pointer-events-none' : ''
      }`}
    >
      {/* 3D Stage Container */}
      <div ref={mountRef} className="intro-veil__content absolute inset-0 pointer-events-none" />

      {/* Foreground Cinematic Controls & Storytelling Overlay */}
      <div className="intro-veil__content relative z-10 w-full h-full flex flex-col justify-between p-6 sm:p-12 pointer-events-none">
        {/* Header Controls */}
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-2 mono text-xs text-cyan-400/80">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>RAVEN OPERATING SYSTEM</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                // Muting must actually mute the sentence in progress, not just the next one.
                if (audioEnabled) stopRavenSpeech()
                setAudioEnabled(!audioEnabled)
              }}
              className="p-2 rounded-lg border border-white/10 bg-black/40 text-gray-400 hover:text-white text-xs mono flex items-center gap-1.5 transition-all"
            >
              {audioEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span className="hidden sm:inline">{audioEnabled ? 'AUDIO ON' : 'MUTED'}</span>
            </button>

            <button
              onClick={handleFinish}
              className="px-4 py-2 rounded-lg border border-white/10 bg-black/40 text-gray-400 hover:text-white text-xs mono uppercase transition-all"
            >
              SKIP
            </button>
          </div>
        </div>

        {/* Storytelling Text Reveal (Shots 06 & 07) */}
        <div className="max-w-2xl mx-auto text-center space-y-6 pointer-events-auto my-auto">
          {typedTextStage >= 1 && (
            <div className="space-y-3 transition-all duration-700 animate-fade-in">
              <span className="mono text-xs text-cyan-400 tracking-[0.3em] uppercase block">
                [ INTELLIGENCE AWAKENED ]
              </span>
              <h2 className="font-serif text-4xl sm:text-6xl text-white font-bold tracking-wide">
                &ldquo;HELLO.&rdquo;
              </h2>
            </div>
          )}

          {typedTextStage >= 2 && (
            <h3 className="font-serif text-3xl sm:text-5xl text-cyan-300 italic tracking-wide transition-all duration-700 animate-fade-in">
              &ldquo;I&apos;M RAVEN.&rdquo;
            </h3>
          )}

          {typedTextStage >= 3 && (
            <p className="mono text-xs sm:text-sm text-lime-400 tracking-widest uppercase transition-all duration-700 animate-fade-in">
              RIYAN PASHA&apos;S AI COMPANION
            </p>
          )}

          {sceneStage >= 7 && (
            <div className="pt-6 border-t border-cyan-500/20 space-y-3 transition-all duration-1000 animate-fade-in">
              <h1 className="font-serif text-3xl sm:text-5xl text-white font-bold tracking-wider">
                RIYAN <span className="italic text-cyan-400">PASHA</span>
              </h1>
              <p className="mono text-xs text-cyan-300">
                TECHNOLOGIST · DEVELOPER · PROBLEM SOLVER · BUILDER
              </p>
              <p className="text-xs sm:text-sm text-gray-400 font-sans italic max-w-lg mx-auto">
                &ldquo;I play with data, build systems, explore technology, and turn problems into things that work.&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Automatic Transition Notice */}
        <div className="flex justify-center pb-4 pointer-events-auto">
          <span className="mono text-[11px] text-gray-500 tracking-widest uppercase animate-pulse">
            TRANSITIONING TO PORTFOLIO...
          </span>
        </div>
      </div>
    </div>
  )
}
