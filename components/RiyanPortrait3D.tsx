'use client'

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import * as THREE from 'three'
import Image from 'next/image'
import { PORTRAIT_FOV_DEG, PORTRAIT_FRAME_ASPECT, fitPortrait, portraitUvTransform } from '@/lib/portraitFraming'

/**
 * Riyan — 3D portrait.
 *
 * This is the real photograph, not a generated face. `public/riyan-portrait.png`
 * is a studio shot on a pure-black background, so the two assets beside it are
 * derived from it deterministically (see `scripts/generate-portrait-depth.mjs`):
 *
 *   riyan-foreground.webp  the photo with the background segmented out (RGBA)
 *   riyan-depth.png        a grayscale *depth proxy*: silhouette curvature and
 *                          forward-facing skin regions. Not a 3D scan — a relief
 *                          estimate, which is why the displacement stays small.
 *
 * A displaced plane uses those two, so the portrait has genuine parallax without
 * warping the face: the crop is a crop, never a stretch. If the browser cannot
 * give us WebGL, the same photograph is shown in the same frame instead, and says
 * so — no invisible box, no fake depth.
 */
const PORTRAIT_FOREGROUND = '/models/riyan/riyan-foreground.webp'
const PORTRAIT_DEPTH = '/models/riyan/riyan-depth.png'
const PORTRAIT_FALLBACK = '/riyan-portrait.png'

/** Source image is 900x1350; the card is 4:5, so the frame crops the feet. */
// The card's box, from the original design. It is deliberately *not* the image's aspect any
// more: the photograph's own ratio is measured from the loaded bitmap and the quad is built
// to match it, so the whole portrait fits inside this box at any viewport size instead of
// being cropped to fill it. See lib/portraitFraming.ts.
const ASPECT = PORTRAIT_FRAME_ASPECT

type Mode = 'loading' | '3d' | 'photo'

export default function RiyanPortrait3D({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const targetRef = useRef({ x: 0, y: 0 })
  /**
   * The photograph's own aspect ratio, once it is known. A ref rather than state because it
   * is read by the resize handler and the animation loop, and a change to it must never
   * re-render the component (that would tear down and rebuild the WebGL stage).
   */
  const planeAspectRef = useRef(PORTRAIT_FRAME_ASPECT)
  const [mode, setMode] = useState<Mode>('loading')
  const [note, setNote] = useState('')
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState(false)

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    targetRef.current = { x: px, y: py }
    // The CSS frame shares the same motion so the badge moves with the figure.
    setTilt({ x: -py * 7, y: px * 9 })
  }

  const handlePointerLeave = () => {
    targetRef.current = { x: 0, y: 0 }
    setTilt({ x: 0, y: 0 })
    setHovered(false)
  }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer | null = null
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch (error) {
      setMode('photo')
      setNote(error instanceof Error ? error.message : 'WebGL is not available in this browser')
      return
    }

    let disposed = false
    const disposables: Array<{ dispose: () => void }> = []
    const track = <T extends { dispose: () => void }>(resource: T): T => {
      disposables.push(resource)
      return resource
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.touchAction = 'pan-y'
    mount.appendChild(renderer.domElement)

    // `renderer` is a mutable binding (cleanup nulls it); this const keeps the
    // async setup path able to narrow it.
    const gl = renderer

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(PORTRAIT_FOV_DEG, ASPECT, 0.05, 10)
    // Solved from the projection, not hand-picked. The old fixed `z = 1.55` showed 0.83
    // world units of height while the quad was 1.0 tall, so ~10 % of the top of the
    // photograph was outside the card and `overflow-hidden` cut it — through the hair, and
    // by a different amount at every container size.
    camera.position.set(0, 0, fitPortrait(ASPECT, planeAspectRef.current).distance)
    camera.lookAt(0, 0, 0)

    // Photograph-preserving light: mostly flat, so the face reads exactly as
    // photographed, with just enough falloff for the relief to be legible.
    const ambient = new THREE.AmbientLight(0xffffff, 1.05)
    const key = new THREE.DirectionalLight(0xffffff, 0.55)
    key.position.set(0.6, 0.9, 1.4)
    const sweep = new THREE.PointLight(0x9fe8ff, 0.0, 3.2, 2) // the travelling highlight
    sweep.position.set(0, 0.6, 0.6)
    scene.add(ambient, key, sweep)

    const group = new THREE.Group()
    scene.add(group)
    groupRef.current = group

    const dustCount = reduceMotion ? 0 : 90
    const dustGeometry = track(new THREE.BufferGeometry())
    {
      const positions = new Float32Array(Math.max(dustCount, 1) * 3)
      for (let i = 0; i < dustCount; i++) {
        const a = (i * 2.399963) % (Math.PI * 2) // golden-angle spread, deterministic
        const r = 0.35 + ((i * 37) % 100) / 240
        positions[i * 3] = Math.cos(a) * r * 1.15
        positions[i * 3 + 1] = Math.sin(a) * r * 1.5
        positions[i * 3 + 2] = -0.25 - ((i * 13) % 60) / 120
      }
      dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    }
    const dustMaterial = track(
      new THREE.PointsMaterial({
        color: 0x7fe3ff,
        size: 0.008,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    const dust = new THREE.Points(dustGeometry, dustMaterial)
    scene.add(dust)

    let clock: THREE.Clock | null = null
    let onScreen = true
    let visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible'

    const handleResize = () => {
      if (disposed || !renderer || !mount) return
      const width = Math.max(mount.clientWidth, 1)
      const height = Math.max(mount.clientHeight, 1)
      const boxAspect = width / height
      camera.aspect = boxAspect
      // Re-solved on every resize: this is what makes the framing responsive rather than
      // "correct at the size it was authored at". A narrow phone box letterboxes the
      // portrait top and bottom, a wide desktop box letterboxes the sides, and the head is
      // inside the frame in both cases.
      camera.position.z = fitPortrait(boxAspect, planeAspectRef.current).distance
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    handleResize()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null
    resizeObserver?.observe(mount)

    let observer: IntersectionObserver | null = null
    let animate: (() => void) | null = null
    const setLoop = (on: boolean) => {
      if (!renderer || disposed) return
      if (on && onScreen && visible) renderer.setAnimationLoop(animate)
      else renderer.setAnimationLoop(null)
    }
    const visibilityHandler = () => {
      visible = document.visibilityState === 'visible'
      setLoop(true)
    }
    document.addEventListener('visibilitychange', visibilityHandler)

    /**
     * `flipForGpuUpload` is the portrait's orientation fix, and it is not a guess.
     *
     * `THREE.Texture.flipY` defaults to `true`, which is what makes a plane textured from
     * an `<img>` or a canvas read upright. Three 0.184 documents the exception verbatim:
     *
     *   "Note that this property has no effect when using `ImageBitmap`. You need to
     *    configure the flip on bitmap creation instead."
     *
     * This loader hands the texture an `ImageBitmap`, so `flipY` silently did nothing, the
     * rows went up unflipped, and Riyan rendered upside down — while the no-WebGL fallback
     * (a plain `<Image>`) looked correct, which is what made it look like an asset problem.
     * The asset is *not* flipped: its vertical ink profile matches `public/riyan-portrait.png`
     * decile for decile, asserted by `npm run check:assets`. So the fix belongs here, at
     * creation, exactly where the platform puts it.
     */
    const imageLoader = async (
      url: string,
      options: { flipForGpuUpload?: boolean } = {},
    ): Promise<{ texture: THREE.Texture | null; bitmap: ImageBitmap | null }> => {
      const response = await fetch(url)
      if (!response.ok) return { texture: null, bitmap: null }
      const blob = await response.blob()
      const texture = new THREE.Texture()
      const bitmap =
        typeof createImageBitmap === 'function'
          ? await createImageBitmap(blob, {
              imageOrientation: options.flipForGpuUpload ? 'flipY' : 'from-image',
            })
          : null
      if (bitmap) {
        texture.image = bitmap
        texture.needsUpdate = true
      }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.anisotropy = gl.capabilities.getMaxAnisotropy()
      return { texture, bitmap }
    }

    /** Reads a grayscale PNG into a Float32Array normalised to 0..1. */
    const readLuminance = async (bitmap: ImageBitmap): Promise<{ data: Float32Array; width: number; height: number }> => {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('canvas 2d unavailable')
      context.drawImage(bitmap, 0, 0)
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
      const out = new Float32Array(bitmap.width * bitmap.height)
      for (let i = 0, p = 0; i < out.length; i++, p += 4) {
        out[i] = (image.data[p] * 0.299 + image.data[p + 1] * 0.587 + image.data[p + 2] * 0.114) / 255
      }
      return { data: out, width: bitmap.width, height: bitmap.height }
    }

    void (async () => {
      try {
        // Only the foreground reaches the GPU. The depth map is sampled on the CPU, where
        // canvas row 0 *is* the top of the file, so it stays unflipped — flipping both would
        // cancel out here and put the relief upside down (forehead bulging where the chin is).
        const [foreground, depth] = await Promise.all([
          imageLoader(PORTRAIT_FOREGROUND, { flipForGpuUpload: true }),
          imageLoader(PORTRAIT_DEPTH),
        ])
        if (disposed) { // eslint-disable-line
          foreground.texture?.dispose()
          depth.texture?.dispose()
          return
        }
        if (!foreground.texture || !foreground.bitmap) {
          setMode('photo')
          setNote(`${PORTRAIT_FOREGROUND} could not be fetched — showing the original photograph instead.`)
          return
        }
        track(foreground.texture)

        // ---- contain (never crop, never stretch) --------------------
        // The old code fitted the photograph to the *card* by sampling only part of it: for
        // a 2:3 cutout in a 4:5 frame that meant `repeatY = 0.833, offsetY = 0.167`, i.e.
        // the displayed band started at the very top row of the image with zero headroom.
        // That is half of the reported bug — and it was still the *safe* half, because the
        // camera then overflowed the frame again. The fix is to stop cropping at all: the
        // texture is sampled in full and the geometry is authored at the bitmap's own ratio,
        // so aspect ratio is preserved by construction and letterboxing is the camera's job.
        const sourceAspect = foreground.bitmap.width / foreground.bitmap.height
        const { repeatX, repeatY, offset } = portraitUvTransform()
        planeAspectRef.current = sourceAspect
        foreground.texture.repeat.set(repeatX, repeatY)
        foreground.texture.offset.set(offset[0], offset[1])
        // The bitmap may arrive after the first resize, so re-fit now that the real aspect
        // is known.
        if (renderer && mount) {
          camera.aspect = Math.max(mount.clientWidth, 1) / Math.max(mount.clientHeight, 1)
          camera.position.z = fitPortrait(camera.aspect, sourceAspect).distance
          camera.updateProjectionMatrix()
        }

        // ---- relief -------------------------------------------------
        // The relief is sampled on the CPU, so only the geometry needs the bitmap;
        // the depth texture itself is never bound, and is released straight away.
        depth.texture?.dispose()
        const segments = Math.min(200, Math.max(64, Math.round(150 * (window.innerWidth < 820 ? 0.6 : 1))))
        const geometry = track(
          new THREE.PlaneGeometry(sourceAspect, 1, segments, Math.round(segments / sourceAspect)),
        )
        if (depth.bitmap) {
          try {
            const { data, width, height } = await readLuminance(depth.bitmap)
            const position = geometry.attributes.position as THREE.BufferAttribute
            const relief = 0.075
            for (let i = 0; i < position.count; i++) {
              // Identity UV transform (see above), so the quad's own coordinates map straight
              // onto the image: x across the plane's width, y up its height.
              const u = (position.getX(i) / sourceAspect + 0.5) * repeatX + offset[0]
              const v = (position.getY(i) + 0.5) * repeatY + offset[1]
              const sx = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))))
              // texture v=0 is the bottom of the image, canvas rows start at the top
              const sy = Math.min(height - 1, Math.max(0, Math.round((1 - v) * (height - 1))))
              const sample = data[sy * width + sx] ?? 0
              position.setZ(i, sample * relief)
            }
            position.needsUpdate = true
            geometry.computeVertexNormals()
          } catch (error) {
            // Flat is a degraded but honest outcome; the photo itself is unchanged.
            console.warn('[portrait] depth map unusable, rendering flat:', error)
            geometry.computeVertexNormals()
          }
        }

        const material = track(
          new THREE.MeshPhysicalMaterial({
            map: foreground.texture,
            transparent: true,
            roughness: 0.86,
            metalness: 0,
            clearcoat: 0.22,
            clearcoatRoughness: 0.5,
            envMapIntensity: 0,
            // Self-lit by a fraction of itself so the photograph keeps its own
            // exposure in the dark theme instead of greying out.
            emissive: new THREE.Color(0xffffff),
            emissiveMap: foreground.texture,
            emissiveIntensity: 0.34,
          }),
        )
        const plane = new THREE.Mesh(geometry, material)
        group.add(plane)

        // ---- contact shadow behind the figure -----------------------
        // Blurred alpha of the same cutout, so the portrait casts something even
        // though there is no ground plane in a floating card.
        try {
          const shadowCanvas = document.createElement('canvas')
          shadowCanvas.width = 256
          shadowCanvas.height = Math.round(256 / sourceAspect)
          const context = shadowCanvas.getContext('2d')
          if (context) {
            context.filter = 'blur(14px)'
            // `foreground.bitmap` is stored flipped for the upload above. A
            // `CanvasTexture` *does* honour `flipY`, so the shadow gets one manual
            // un-flip and the two cancel: the silhouette lands behind the figure it
            // belongs to, not behind his hair.
            context.translate(0, shadowCanvas.height)
            context.scale(1, -1)
            context.drawImage(foreground.bitmap, 0, 0, shadowCanvas.width, shadowCanvas.height)
            const shadowTexture = track(new THREE.CanvasTexture(shadowCanvas))
            shadowTexture.colorSpace = THREE.SRGBColorSpace
            const shadowMaterial = track(
              new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.5, depthWrite: false }),
            )
            const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(1.06 * sourceAspect, 1.06)), shadowMaterial)
            shadow.position.set(0.02, -0.015, -0.16)
            group.add(shadow)
          }
        } catch {
          /* shadow is dressing only */
        }

        if (disposed) return
        setMode('3d')
        setNote('')

        clock = new THREE.Clock()
        const localClock = clock
        animate = () => {
          if (disposed || !renderer) return
          const dt = Math.min(localClock.getDelta(), 0.05)
          const t = localClock.elapsedTime
          const target = targetRef.current
          const ease = (value: number, goal: number) => value + (goal - value) * Math.min(1, dt * 6)
          group.rotation.y = ease(group.rotation.y, reduceMotion ? 0 : target.x * 0.16)
          group.rotation.x = ease(group.rotation.x, reduceMotion ? 0 : -target.y * 0.1)
          group.position.x = ease(group.position.x, reduceMotion ? 0 : target.x * 0.02)
          group.position.y = ease(group.position.y, reduceMotion ? 0 : -target.y * 0.014)
          if (!reduceMotion) {
            // travelling specular highlight across the surface
            // Same travel relative to the plane as before: ~2.1× the half-width, so the
            // highlight still crosses the whole photograph and a little of the card.
            sweep.position.x = Math.sin(t * 0.42) * (planeAspectRef.current * 1.06)
            sweep.position.y = Math.cos(t * 0.33) * 0.55 + 0.1
            sweep.intensity = 0.55 + 0.35 * Math.sin(t * 0.42 + 1.2)
            dust.rotation.z = t * 0.012
            plane.position.z = Math.sin(t * 0.5) * 0.004
          }
          renderer.render(scene, camera)
        }
        setLoop(true)

        if (typeof IntersectionObserver !== 'undefined') {
          observer = new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((entry) => entry.isIntersecting)
              setLoop(true)
            },
            { rootMargin: '120px' },
          )
          observer.observe(mount)
        }
      } catch (error) {
        if (disposed) return
        setMode('photo')
        setNote(error instanceof Error ? error.message : 'The 3D portrait could not be built')
      }
    })()

    return () => {
      disposed = true
      try {
        renderer?.setAnimationLoop(null)
      } catch {
        /* already gone */
      }
      resizeObserver?.disconnect()
      observer?.disconnect()
      document.removeEventListener('visibilitychange', visibilityHandler)
      animate = null
      if (groupRef.current) {
        groupRef.current.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (mesh.isMesh) mesh.geometry?.dispose?.()
        })
        scene.remove(groupRef.current)
        groupRef.current = null
      }
      scene.clear()
      for (const resource of disposables) {
        try {
          resource.dispose()
        } catch {
          /* keep going */
        }
      }
      disposables.length = 0
      if (renderer) {
        try {
          renderer.dispose()
          renderer.forceContextLoss?.()
        } catch {
          /* ignore */
        }
        if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement)
        renderer = null
      }
    }
  }, [])

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={handlePointerLeave}
      className={`relative group perspective-1000 w-full max-w-md mx-auto${className ? ` ${className}` : ''}`}
    >
      <div
        className="relative transform-gpu rounded-2xl overflow-hidden glass-panel-glow p-4 sm:p-6"
        style={{
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(${hovered ? 1.015 : 1}, ${hovered ? 1.015 : 1}, 1)`,
          transformStyle: 'preserve-3d',
          transition: 'transform 260ms cubic-bezier(.22,.61,.36,1)',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-950/40 via-transparent to-lime-950/30 opacity-70 group-hover:opacity-100 transition-opacity" />

        <div
          className="relative w-full rounded-xl overflow-hidden border border-cyan-500/25 portrait-frame"
          style={{ aspectRatio: `${ASPECT}`, transform: 'translateZ(22px)' }}
        >
          {/* The WebGL stage lives here; the <Image> underneath is the fallback. */}
          {mode !== '3d' ? (
            <Image
              src={PORTRAIT_FALLBACK}
              alt="Riyan Pasha — Technologist & Developer"
              fill
              sizes="(max-width: 1024px) 92vw, 420px"
              // `contain`, centred: the whole photograph, top of the head included, at any
              // box size. `cover` here used to scale to width and crop the overflow — the 2D
              // fallback therefore disagreed with the 3D stage about what was visible.
              className="object-contain"
              priority
            />
          ) : null}
          <div ref={mountRef} className="absolute inset-0" style={{ opacity: mode === '3d' ? 1 : 0 }} />

          <div className="absolute inset-0 portrait-vignette pointer-events-none" />
          <div className="absolute inset-0 portrait-sheen pointer-events-none" aria-hidden="true" />
          <div className="absolute inset-0 border border-cyan-400/15 rounded-xl pointer-events-none group-hover:border-cyan-400/40 transition-colors" />

          {mode === 'loading' ? (
            <span className="absolute bottom-2 left-2 mono text-[10px] px-2 py-1 rounded bg-black/60 text-cyan-200 border border-cyan-500/20">
              BUILDING 3D PORTRAIT
            </span>
          ) : null}
          {mode === 'photo' && note ? (
            <span className="absolute bottom-2 left-2 right-2 mono text-[10px] px-2 py-1 rounded bg-black/70 text-amber-200 border border-amber-500/25">
              FLAT PHOTO · {note.slice(0, 120)}
            </span>
          ) : null}
        </div>

        <div
          className="mt-4 p-4 rounded-xl portrait-badge border border-cyan-500/20 backdrop-blur-md space-y-2"
          style={{ transform: 'translateZ(34px)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="portrait-dot" aria-hidden="true" />
              <span className="mono text-xs font-bold text-white tracking-wider">RIYAN PASHA</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-lime-500/10 text-lime-400 mono border border-lime-500/20">
              CREATOR / BUILDER
            </span>
          </div>

          <p className="text-xs text-gray-300 leading-relaxed font-sans">
            TECHNOLOGIST · DEVELOPER · PROBLEM SOLVER · BUILDER
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {['AI', 'Agentic AI', 'RAG', 'Data', 'Systems'].map((tag) => (
              <span key={tag} className="text-[10px] mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/20">
                {tag}
              </span>
            ))}
          </div>

          <p className="mono text-[10px] text-gray-500 pt-1 leading-relaxed">
            {mode === '3d'
              ? 'Real photograph, depth from silhouette curvature + skin geometry. Generated locally, no AI face model.'
              : 'Original photograph. Depth relief unavailable on this device.'}
          </p>
        </div>
      </div>
    </div>
  )
}
