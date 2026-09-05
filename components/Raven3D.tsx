'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type Raven3DProps = {
  depth: { x: number; y: number }
  state: string
  speaking: boolean
  blinking: boolean
}

interface MorphTargetMap {
  blink?: { mesh: THREE.Mesh; index: number }[]
  mouthOpen?: { mesh: THREE.Mesh; index: number }[]
  smile?: { mesh: THREE.Mesh; index: number }[]
  browUp?: { mesh: THREE.Mesh; index: number }[]
}

export default function Raven3D({ depth, state, speaking, blinking }: Raven3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef({ depth, state, speaking, blinking })

  useEffect(() => {
    stateRef.current = { depth, state, speaking, blinking }
  }, [depth, state, speaking, blinking])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let animationFrameId = 0
    let previousTime = performance.now()
    let elapsedTime = 0

    // =========================================================
    // 1. THREE.JS SCENE & CINEMATIC STUDIO LIGHTING
    // =========================================================
    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(0, 0.22, 4.2)
    camera.lookAt(0, 0.15, 0)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.4

    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    mount.appendChild(renderer.domElement)

    // Studio Lighting (Cyan key, Lime fill, Violet rim)
    const ambientLight = new THREE.AmbientLight(0x05070a, 2.2)
    scene.add(ambientLight)

    const keyLight = new THREE.DirectionalLight(0x00e5ff, 3.5)
    keyLight.position.set(3.2, 3.2, 4.0)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xb8ff00, 2.2)
    fillLight.position.set(-3.2, -1.2, 3.0)
    scene.add(fillLight)

    const rimLight = new THREE.DirectionalLight(0x8b5cf6, 4.5)
    rimLight.position.set(0, 4.5, -4.0)
    scene.add(rimLight)

    const eyeSpotlight = new THREE.PointLight(0x00e5ff, 2.8, 6)
    eyeSpotlight.position.set(0, 0.42, 1.2)
    scene.add(eyeSpotlight)

    const characterGroup = new THREE.Group()
    characterGroup.name = 'RAVEN_CHARACTER_ROOT'
    scene.add(characterGroup)

    let gltfMeshModel: THREE.Group | null = null
    const morphTargetMap: MorphTargetMap = {}

    // Dynamic MORPH TARGET DISCOVERY LAYER
    const discoverMorphTargets = (root: THREE.Object3D) => {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
            Object.entries(mesh.morphTargetDictionary).forEach(([name, index]) => {
              const lowerName = name.toLowerCase()
              if (lowerName.includes('blink') || lowerName.includes('eyeclose')) {
                if (!morphTargetMap.blink) morphTargetMap.blink = []
                morphTargetMap.blink.push({ mesh, index })
              }
              if (lowerName.includes('mouth') || lowerName.includes('jaw') || lowerName.includes('open')) {
                if (!morphTargetMap.mouthOpen) morphTargetMap.mouthOpen = []
                morphTargetMap.mouthOpen.push({ mesh, index })
              }
              if (lowerName.includes('smile')) {
                if (!morphTargetMap.smile) morphTargetMap.smile = []
                morphTargetMap.smile.push({ mesh, index })
              }
            })
          }
        }
      })
    }

    // Try loading /models/raven/raven.glb
    const loader = new GLTFLoader()
    loader.load(
      '/models/raven/raven.glb',
      (gltf) => {
        if (disposed) return
        gltfMeshModel = gltf.scene
        gltfMeshModel.scale.setScalar(1.2)
        gltfMeshModel.position.set(0, -0.8, 0)
        discoverMorphTargets(gltfMeshModel)
        characterGroup.add(gltfMeshModel)
      },
      undefined,
      () => {
        // Safe Fallback: Cinematic Silhouetted Female Digital Human Head & Bust
      }
    )

    // =========================================================
    // 2. ELEGANT SILHOUETTED FEMALE DIGITAL HUMAN HEAD & BUST (FALLBACK)
    // =========================================================
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0x080c16,
      roughness: 0.2,
      metalness: 0.9,
      envMapIntensity: 2.0,
    })

    const scleraMaterial = new THREE.MeshStandardMaterial({
      color: 0x040810,
      roughness: 0.08,
      metalness: 0.95,
    })

    const irisMaterial = new THREE.MeshBasicMaterial({ color: 0x00e5ff })
    const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0xb8ff00 })

    // Female Skull Sculpting
    const headGeo = new THREE.SphereGeometry(0.85, 48, 48)
    const headPos = headGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < headPos.count; i++) {
      let x = headPos.getX(i)
      let y = headPos.getY(i)
      let z = headPos.getZ(i)

      if (y < 0) {
        const factor = Math.abs(y)
        x *= Math.max(0.42, 1 - factor * 0.45)
        z *= Math.max(0.52, 1 - factor * 0.32)
      }
      if (z < 0) z *= 0.88
      if (y > -0.2 && y < 0.3 && Math.abs(x) > 0.3) {
        x *= 1.08
        z *= 1.05
      }
      headPos.setXYZ(i, x, y, z)
    }
    headGeo.computeVertexNormals()

    const headMesh = new THREE.Mesh(headGeo, skinMaterial)
    headMesh.position.set(0, 0.22, 0)
    characterGroup.add(headMesh)

    // Neck & Bust
    const neckGeo = new THREE.CylinderGeometry(0.32, 0.46, 0.72, 32)
    const neckMesh = new THREE.Mesh(neckGeo, skinMaterial)
    neckMesh.position.set(0, -0.42, -0.05)
    characterGroup.add(neckMesh)

    const bustGeo = new THREE.CylinderGeometry(0.46, 1.45, 0.58, 32)
    const bustMesh = new THREE.Mesh(bustGeo, skinMaterial)
    bustMesh.position.set(0, -0.95, -0.05)
    bustMesh.rotation.x = 0.08
    characterGroup.add(bustMesh)

    // Nose
    const noseGeo = new THREE.ConeGeometry(0.11, 0.42, 16)
    noseGeo.rotateX(-0.32)
    const noseMesh = new THREE.Mesh(noseGeo, skinMaterial)
    noseMesh.position.set(0, 0.2, 0.82)
    characterGroup.add(noseMesh)

    // Digital Human Eyes
    const createEye = (xPos: number) => {
      const eyeGroup = new THREE.Group()
      eyeGroup.position.set(xPos, 0.33, 0.72)

      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 24), scleraMaterial)
      eyeGroup.add(sclera)

      const iris = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.09, 32), irisMaterial)
      iris.position.z = 0.136
      eyeGroup.add(iris)

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), pupilMaterial)
      pupil.position.z = 0.138
      eyeGroup.add(pupil)

      return { eyeGroup, sclera, iris, pupil }
    }

    const leftEye = createEye(-0.32)
    const rightEye = createEye(0.32)
    characterGroup.add(leftEye.eyeGroup)
    characterGroup.add(rightEye.eyeGroup)

    // Lips & Mouth Line
    const upperLipPoints = [
      new THREE.Vector3(-0.22, -0.15, 0.75),
      new THREE.Vector3(-0.1, -0.12, 0.82),
      new THREE.Vector3(0, -0.13, 0.84),
      new THREE.Vector3(0.1, -0.12, 0.82),
      new THREE.Vector3(0.22, -0.15, 0.75),
    ]

    const lowerLipPoints = [
      new THREE.Vector3(-0.22, -0.15, 0.75),
      new THREE.Vector3(-0.1, -0.22, 0.81),
      new THREE.Vector3(0, -0.24, 0.83),
      new THREE.Vector3(0.1, -0.22, 0.81),
      new THREE.Vector3(0.22, -0.15, 0.75),
    ]

    const upperLipGeo = new THREE.BufferGeometry().setFromPoints(upperLipPoints)
    const lowerLipGeo = new THREE.BufferGeometry().setFromPoints(lowerLipPoints)
    const lipMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 })

    const upperLipMesh = new THREE.Line(upperLipGeo, lipMat)
    const lowerLipMesh = new THREE.Line(lowerLipGeo, lipMat)
    characterGroup.add(upperLipMesh)
    characterGroup.add(lowerLipMesh)

    // Ambient Dust Field
    const pCount = 280
    const pPos = new Float32Array(pCount * 3)
    for (let i = 0; i < pCount; i++) {
      const radius = 1.5 + Math.random() * 1.8
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      pPos[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      pPos[i * 3 + 1] = radius * Math.cos(phi)
      pPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
    const pMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.014,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    })
    const particles = new THREE.Points(pGeo, pMat)
    scene.add(particles)

    // =========================================================
    // 3. ANIMATION LOOP & GAZE PHYSICS
    // =========================================================
    const handleResize = () => {
      if (!mount) return
      const width = Math.max(mount.clientWidth, 1)
      const height = Math.max(mount.clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    handleResize()
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(mount)
    window.addEventListener('resize', handleResize)

    let blinkTimer = 0
    let isBlinkingNow = false

    const animate = (now: number) => {
      if (disposed) return
      animationFrameId = requestAnimationFrame(animate)

      const delta = Math.min((now - previousTime) / 1000, 0.05)
      previousTime = now
      elapsedTime += delta

      const current = stateRef.current

      // Gaze Physics - Smooth Lerp
      const targetRotY = THREE.MathUtils.clamp(current.depth.x / 35, -0.35, 0.35)
      const targetRotX = THREE.MathUtils.clamp(-current.depth.y / 35, -0.22, 0.22)

      characterGroup.rotation.y = THREE.MathUtils.lerp(characterGroup.rotation.y, targetRotY, delta * 4.5)
      characterGroup.rotation.x = THREE.MathUtils.lerp(characterGroup.rotation.x, targetRotX, delta * 4.5)

      const pupilOffsetX = (current.depth.x / 35) * 0.035
      const pupilOffsetY = (-current.depth.y / 35) * 0.035
      leftEye.pupil.position.x = pupilOffsetX
      leftEye.pupil.position.y = pupilOffsetY
      rightEye.pupil.position.x = pupilOffsetX
      rightEye.pupil.position.y = pupilOffsetY

      // Idle Breathing
      characterGroup.position.y = Math.sin(elapsedTime * 1.4) * 0.03

      // Blinking Cycle & GLTF Morph Target Animation
      blinkTimer += delta
      if (blinkTimer > 3.8 + Math.random() * 3.5) {
        isBlinkingNow = true
        blinkTimer = 0
      }

      const blinkScale = current.blinking || isBlinkingNow ? 0.05 : 1.0
      if (isBlinkingNow && blinkTimer > 0.16) isBlinkingNow = false

      leftEye.eyeGroup.scale.y = THREE.MathUtils.lerp(leftEye.eyeGroup.scale.y, blinkScale, delta * 25)
      rightEye.eyeGroup.scale.y = THREE.MathUtils.lerp(rightEye.eyeGroup.scale.y, blinkScale, delta * 25)

      // If GLTF morph targets exist, apply blink morph influence
      if (morphTargetMap.blink) {
        const influence = current.blinking || isBlinkingNow ? 1.0 : 0.0
        morphTargetMap.blink.forEach(({ mesh, index }) => {
          mesh.morphTargetInfluences![index] = THREE.MathUtils.lerp(mesh.morphTargetInfluences![index], influence, delta * 20)
        })
      }

      // Mouth Speaking Animation
      const isSpeakingActive = current.speaking || current.state === 'SPEAKING' || current.state === 'REASONING'

      if (isSpeakingActive) {
        const mouthOpen = Math.abs(Math.sin(elapsedTime * 12)) * 0.08
        lowerLipMesh.position.y = -mouthOpen
        upperLipMesh.position.y = mouthOpen * 0.4

        if (morphTargetMap.mouthOpen) {
          const mouthInf = Math.abs(Math.sin(elapsedTime * 12)) * 0.8
          morphTargetMap.mouthOpen.forEach(({ mesh, index }) => {
            mesh.morphTargetInfluences![index] = mouthInf
          })
        }
      } else {
        lowerLipMesh.position.y = 0
        upperLipMesh.position.y = 0
        if (morphTargetMap.mouthOpen) {
          morphTargetMap.mouthOpen.forEach(({ mesh, index }) => {
            mesh.morphTargetInfluences![index] = 0
          })
        }
      }

      particles.rotation.y += delta * 0.04
      renderer.render(scene, camera)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)

      skinMaterial.dispose()
      scleraMaterial.dispose()
      irisMaterial.dispose()
      pupilMaterial.dispose()
      hairMaterial.dispose()
      headGeo.dispose()
      neckGeo.dispose()
      bustGeo.dispose()
      noseGeo.dispose()
      upperLipGeo.dispose()
      lowerLipGeo.dispose()
      lipMat.dispose()
      pGeo.dispose()
      pMat.dispose()

      renderer.dispose()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div
      ref={mountRef}
      className="raven-3d-container"
      aria-hidden="true"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 340,
        position: 'relative',
        overflow: 'hidden',
      }}
    />
  )
}
