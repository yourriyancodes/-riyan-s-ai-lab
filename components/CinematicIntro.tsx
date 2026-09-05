'use client'

import { useState, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { ArrowRight, Volume2, VolumeX } from 'lucide-react'

type CinematicIntroProps = {
  onComplete: () => void
}

export default function CinematicIntro({ onComplete }: CinematicIntroProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [sceneStage, setSceneStage] = useState<number>(0)
  const [typedTextStage, setTypedTextStage] = useState<number>(0)
  const [isSkipping, setIsSkipping] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)

  useEffect(() => {
    // Check URL params for replay override: ?intro=1 or ?replay=1
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const forceReplay = params.get('intro') === '1' || params.get('replay') === '1'
      const hasSeen = localStorage.getItem('riyan_intro_seen')

      if (!forceReplay && hasSeen === 'true') {
        onComplete()
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
  }, [onComplete])

  // Speech Synthesis Greeting Trigger during SHOT 06
  useEffect(() => {
    if (typedTextStage === 1 && audioEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance("Hello. I am RAVEN, Riyan Pasha's AI companion.")
      utterance.rate = 0.95
      utterance.pitch = 1.05
      const voices = window.speechSynthesis.getVoices()
      const femaleVoice = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Zira'))
      )
      if (femaleVoice) utterance.voice = femaleVoice
      try {
        window.speechSynthesis.speak(utterance)
      } catch {
        // Fallback
      }
    }
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

    // RAVEN SILHOUETTE HEAD BUST
    const headGroup = new THREE.Group()
    scene.add(headGroup)

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0x080b10,
      roughness: 0.25,
      metalness: 0.9,
      transparent: true,
      opacity: 0,
    })

    const headGeo = new THREE.SphereGeometry(0.85, 36, 36)
    const headPos = headGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < headPos.count; i++) {
      let x = headPos.getX(i)
      let y = headPos.getY(i)
      let z = headPos.getZ(i)
      if (y < 0) {
        const f = Math.abs(y)
        x *= Math.max(0.42, 1 - f * 0.45)
        z *= Math.max(0.52, 1 - f * 0.32)
      }
      headPos.setXYZ(i, x, y, z)
    }
    headGeo.computeVertexNormals()

    const headMesh = new THREE.Mesh(headGeo, skinMat)
    headGroup.add(headMesh)

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0 })
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), eyeMat)
    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), eyeMat)
    leftEye.position.set(-0.32, 0.3, 0.76)
    rightEye.position.set(0.32, 0.3, 0.76)
    headGroup.add(leftEye)
    headGroup.add(rightEye)

    const handleResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    const animate = (now: number) => {
      if (disposed) return
      animationFrameId = requestAnimationFrame(animate)

      const elapsed = (now - startTime) / 1000

      if (elapsed > 0.6 && elapsed < 1.8) {
        cyanKeyLight.intensity = THREE.MathUtils.lerp(cyanKeyLight.intensity, 1.2, 0.05)
        pMat.opacity = THREE.MathUtils.lerp(pMat.opacity, 0.3, 0.05)
      }

      if (elapsed >= 2.5 && elapsed < 4.5) {
        skinMat.opacity = THREE.MathUtils.lerp(skinMat.opacity, 0.85, 0.04)
        violetRimLight.intensity = THREE.MathUtils.lerp(violetRimLight.intensity, 3.5, 0.04)
      }

      if (elapsed >= 5.2 && elapsed < 6.5) {
        eyeMat.opacity = THREE.MathUtils.lerp(eyeMat.opacity, 1.0, 0.08)
        headGroup.rotation.x = THREE.MathUtils.lerp(headGroup.rotation.x, -0.05, 0.04)
      }

      if (elapsed >= 6.5) {
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, 4.4, 0.03)
        headGroup.position.y = Math.sin(elapsed * 1.5) * 0.02
      }

      pCloud.rotation.y += 0.001
      renderer.render(scene, camera)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      pGeo.dispose()
      pMat.dispose()
      headGeo.dispose()
      skinMat.dispose()
      eyeMat.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  const handleFinish = () => {
    if (isSkipping) return
    setIsSkipping(true)
    localStorage.setItem('riyan_intro_seen', 'true')
    setTimeout(() => {
      onComplete()
    }, 700)
  }

  return (
    <div
      className={`fixed inset-0 z-[999] bg-[#05070a] text-white overflow-hidden transition-opacity duration-700 ${
        isSkipping ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* 3D Stage Container */}
      <div ref={mountRef} className="absolute inset-0 pointer-events-none" />

      {/* Foreground Cinematic Controls & Storytelling Overlay */}
      <div className="relative z-10 w-full h-full flex flex-col justify-between p-6 sm:p-12 pointer-events-none">
        {/* Header Controls */}
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-2 mono text-xs text-cyan-400/80">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>RAVEN OPERATING SYSTEM</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setAudioEnabled(!audioEnabled)}
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
