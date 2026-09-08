/**
 * CPU preview renderer for the RAVEN machine — no browser, no GPU.
 *
 * It rasterises the *real* geometry from `lib/ravenMachine.ts` through the *real*
 * rig in `lib/ravenStudio.ts`, after driving it with `driveRavenMachine()` for one
 * named state. That chain is the point: this is not a drawing of what the entity is
 * supposed to look like, it is the shipped build function, the shipped state table
 * and the shipped light list, run on the CPU. Which is how "the eyes read as narrow
 * sensors" and "the bust covers 60-75% of the frame" became measurable numbers in
 * `scripts/check-machine-render.mjs` instead of adjectives in a commit message.
 *
 * Approximations versus the browser, all stated because they matter to the numbers:
 *   - GGX is replaced by Blinn-Phong, so highlights are a little rounder;
 *   - image-based lighting is a flat hemisphere term instead of a convolved PMREM
 *     of three's `RoomEnvironment`, so reflections are less structured;
 *   - no anisotropy, no clearcoat lobe (they shape a highlight, they do not move one);
 *   - the woven micro-relief textures are read as a flat roughness offset.
 * Silhouette, proportion, coverage, exposure and where the emissives clip are all
 * exact, and those are what this tool is for.
 *
 *   node scripts/render-machine-preview.mjs --state REASONING
 *   node scripts/render-machine-preview.mjs --variant stage --theme light --out /tmp/x.png
 *   node scripts/render-machine-preview.mjs --quality low --state EXECUTING --width 640 --height 480
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import {
  FRAMING,
  STUDIO_ENV_INTENSITY,
  STUDIO_EXPOSURE,
  STUDIO_LIGHTS,
  acesToneMap,
  framingFor,
  linearToSRGB,
  studioEnvScale,
  MACHINE_COLORS,
} from '../lib/ravenStudio.ts'
import { buildRavenMachine, driveRavenMachine } from '../lib/ravenMachine.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const STATE = flag('state', 'IDLE')
const THEME = flag('theme', 'dark')
const VARIANT = flag('variant', 'hero')
const QUALITY = flag('quality', 'high')
const TIME = Number(flag('time', 1.6))
const WIDTH = Number(flag('width', 460))
const HEIGHT = Number(flag('height', 500))
const CROP = Number(flag('crop', '0')) || 0
const OUT = flag('out', `/tmp/raven-machine-${VARIANT}-${THEME}-${STATE}-${QUALITY}.png`)
const SPEAKING = args.includes('--speaking')
const POINTER = flag('pointer', '0,0')

let sharp
try {
  ;({ default: sharp } = await import('sharp'))
} catch {
  console.error('sharp is required to write the PNG: `npm i -D sharp`')
  process.exit(2)
}

/* ------------------------------------------------------------------ *
 * Build, drive, frame
 * ------------------------------------------------------------------ */
const machine = buildRavenMachine(QUALITY)
machine.root.updateMatrixWorld(true)

// One driven frame, from the same function the render loop calls. Stepping it a few
// frames first lets the damped followers converge, exactly as they would on screen.
const pointer = { x: Number(POINTER.split(',')[0] || 0), y: Number(POINTER.split(',')[1] || 0) }
for (let i = 0; i < 90; i++) {
  driveRavenMachine(machine, {
    state: STATE,
    pointer,
    speaking: SPEAKING,
    speechEnergy: SPEAKING ? 0.42 : 0,
    speechOpenness: SPEAKING ? 0.35 : 0,
    time: TIME,
    dt: 1 / 60,
    reducedMotion: false,
    active: true,
    externalBlink: false,
  })
}

machine.root.updateMatrixWorld(true)
const bounds = new THREE.Box3().setFromObject(machine.root)
const size = bounds.getSize(new THREE.Vector3())
const center = bounds.getCenter(new THREE.Vector3())

// Framing is solved against the *measured* height, then the camera is placed so the
// bust is vertically centred where the component centres it. Same maths, one source.
const aspect = WIDTH / HEIGHT
let framing = framingFor(VARIANT, size.y, { bustWidth: size.x, aspect })
// `--crop 0.16 --aim 0.03` frames the head alone: the face is where this design is
// won or lost, and inspecting it at 40 px tall is not inspection.
if (CROP) {
  const fov = (framing.fov * Math.PI) / 180
  framing = { ...framing, cropHeight: CROP, distance: (CROP / 2 / Math.tan(fov / 2)) * FRAMING[VARIANT].bias }
}
const AIM = CROP ? Number(flag('aim', '0.03')) : null
const camera = {
  position: new THREE.Vector3(center.x, center.y + framing.lookY, center.z + framing.distance),
  lookY: center.y + framing.lookY,
  fov: (framing.fov * Math.PI) / 180,
  aspect: WIDTH / HEIGHT,
}
camera.position.set(center.x, camera.lookY, center.z + framing.distance)
if (AIM !== null) {
  camera.lookY = center.y + AIM
  camera.position.y = camera.lookY
}
const tanHalf = Math.tan(camera.fov / 2)
void framing

/* ------------------------------------------------------------------ *
 * Triangle extraction
 * ------------------------------------------------------------------ */
const worldMatrix = new THREE.Matrix4()
const normalMatrix = new THREE.Matrix3()
const vertex = new THREE.Vector3()
const normal = new THREE.Vector3()

const colorOf = (material, key, fallback = 0x000000) => {
  const value = material?.[key]
  return value && value.isColor ? value : new THREE.Color(fallback)
}

/**
 * Flattens the scene into triangles with the shading parameters this rasteriser
 * understands. `InstancedMesh` is expanded here, so the flow segments and vent slats
 * in the preview are literally the instances the GPU would draw.
 */
const triangles = []
machine.root.traverse((object) => {
  const mesh = object
  if (!mesh.isMesh && !mesh.isInstancedMesh) return
  const geometry = mesh.geometry
  const position = geometry.attributes.position
  const normalAttribute = geometry.attributes.normal
  const index = geometry.index
  if (!position || !normalAttribute) return
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const count = index ? index.count : position.count

  const instances = mesh.isInstancedMesh ? mesh.count : 1
  for (let instance = 0; instance < instances; instance++) {
    const instanceMatrix = new THREE.Matrix4()
    if (mesh.isInstancedMesh) mesh.getMatrixAt(instance, instanceMatrix)
    worldMatrix.copy(mesh.matrixWorld).multiply(instanceMatrix)
    normalMatrix.getNormalMatrix(worldMatrix)

    const material = materials[0]
    const baseColor = colorOf(material, 'color')
    // Emissive through cover glass has to survive the glass, so emission is kept
    // separate from the diffuse tint and added after blending.

    const emissive = colorOf(material, 'emissive', 0x000000)
    const emissiveIntensity = material?.emissiveIntensity ?? 0
    const instanceTint = mesh.isInstancedMesh && mesh.instanceColor ? mesh.instanceColor : null
    const transparent = Boolean(material?.transparent)
    const alphaValue = transparent ? (material?.opacity ?? 0.25) : 1
    const shading = {
      // A MeshBasicMaterial ignores the lights in three, and the instanced glow
      // families are exactly that: their colour *is* their emission. Shading them as a
      // lit dielectric is how every flow segment arrived blown out to white.
      unlit: Boolean(material?.isMeshBasicMaterial),
      tinted: Boolean(instanceTint),
      transparent,
      alpha: alphaValue,
      diffuse: [baseColor.r, baseColor.g, baseColor.b],
      emissive: instanceTint
        ? [instanceTint.getX(instance), instanceTint.getY(instance), instanceTint.getZ(instance)]
        : [emissive.r * emissiveIntensity, emissive.g * emissiveIntensity, emissive.b * emissiveIntensity],
      roughness: material?.roughness ?? 0.6,
      metalness: material?.metalness ?? 0,
      env: (material?.envMapIntensity ?? 0.4) * STUDIO_ENV_INTENSITY[THEME] * (THEME === 'dark' ? 1 : studioEnvScale(THEME)),
    }

    for (let t = 0; t < count; t += 3) {
      const tri = { z: 0, flat: false, verts: [], shading }
      for (let k = 0; k < 3; k++) {
        const i = index ? index.getX(t + k) : t + k
        vertex.fromBufferAttribute(position, i).applyMatrix4(worldMatrix)
        normal.fromBufferAttribute(normalAttribute, i).applyMatrix3(normalMatrix).normalize()
        tri.verts.push({
          x: vertex.x,
          y: vertex.y,
          z: vertex.z,
          nx: normal.x,
          ny: normal.y,
          nz: normal.z,
        })
      }
      // Cull what faces away, then back-face-fill nothing: closed shells only.
      const ax = tri.verts[1].x - tri.verts[0].x
      const ay = tri.verts[1].y - tri.verts[0].y
      const az = tri.verts[1].z - tri.verts[0].z
      const bx = tri.verts[2].x - tri.verts[0].x
      const by = tri.verts[2].y - tri.verts[0].y
      const bz = tri.verts[2].z - tri.verts[0].z
      const faceNormal = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
      const toCamera = [
        camera.position.x - tri.verts[0].x,
        camera.position.y - tri.verts[0].y,
        camera.position.z - tri.verts[0].z,
      ]
      if (faceNormal[0] * toCamera[0] + faceNormal[1] * toCamera[1] + faceNormal[2] * toCamera[2] <= 0) continue
      tri.flat = faceNormal
      const viewZ = -(tri.verts[0].z - camera.position.z)
      tri.z = viewZ
      triangles.push(tri)
    }
  }
})

// Painter's algorithm on centroid depth: fine for a closed bust, and it avoids the
// per-pixel buffer swap this would otherwise need.
triangles.sort((a, b) => b.z - a.z)

/* ------------------------------------------------------------------ *
 * Lights, from the shared rig
 * ------------------------------------------------------------------ */
const lights = STUDIO_LIGHTS[THEME].map((spec) => ({
  kind: spec.kind,
  color: new THREE.Color(spec.color),
  intensity: spec.intensity,
  position: spec.position ? new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]) : null,
  distance: spec.distance ?? 0,
  decay: spec.decay ?? 2,
}))
const exposure = STUDIO_EXPOSURE[THEME]
const backdrop = new THREE.Color(THEME === 'dark' ? MACHINE_COLORS.backdrop : 0xe9edf2)

/* ------------------------------------------------------------------ *
 * Rasterise
 * ------------------------------------------------------------------ */
const rgb = new Uint8Array(WIDTH * HEIGHT * 3)
const covered = new Uint8Array(WIDTH * HEIGHT)
const depthBuffer = new Float32Array(WIDTH * HEIGHT).fill(Infinity)
for (let i = 0; i < WIDTH * HEIGHT; i++) {
  const to = linearToSRGB(backdrop.r)
  const go = linearToSRGB(backdrop.g)
  const bo = linearToSRGB(backdrop.b)
  rgb[i * 3] = Math.round(to * 255)
  rgb[i * 3 + 1] = Math.round(go * 255)
  rgb[i * 3 + 2] = Math.round(bo * 255)
}

const project = (point) => {
  const vz = camera.position.z - point.z
  if (vz <= 1e-5) return null
  const ndcX = (point.x - camera.position.x) / vz / (tanHalf * camera.aspect)
  const ndcY = (camera.lookY - point.y) / vz / tanHalf
  return { x: ((ndcX + 1) / 2) * WIDTH, y: ((ndcY + 1) / 2) * HEIGHT, depth: vz }
}

const shade = (point, normalVector, shading) => {
  if (shading.unlit) {
    // A MeshBasicMaterial in three paints `material.color × instanceColor` and ignores
    // every light: the instanced glow families' colour *is* their emission. Folding the
    // instance tint in here is what stops every vent slat and flow segment arriving as
    // an unlit white square — which is also why the first measurement of
    // `emissivePixels` was inflated.
    const tinted = shading.tinted
    return shading.diffuse.map((value, channel) =>
      tinted ? value * shading.emissive[channel] : value + shading.emissive[channel],
    )
  }
  const view = new THREE.Vector3(
    camera.position.x - point.x,
    camera.position.y - point.y,
    camera.position.z - point.z,
  ).normalize()
  let r = 0
  let g = 0
  let b = 0
  const diffuseTint = [1 - shading.metalness * 0.92, 1 - shading.metalness * 0.92, 1 - shading.metalness * 0.92]
  const specTint =
    shading.metalness > 0.5 ? shading.diffuse : [0.055, 0.06, 0.07]
  const shininess = Math.max(4, Math.min(220, 2 / Math.pow(Math.max(shading.roughness, 0.05), 4)))

  for (const light of lights) {
    let direction
    let attenuation = 1
    if (light.kind === 'ambient') {
      const hemi = 0.5 + 0.5 * normalVector.y
      r += light.color.r * light.intensity * hemi
      g += light.color.g * light.intensity * hemi
      b += light.color.b * light.intensity * hemi
      continue
    }
    if (light.kind === 'directional') {
      direction = light.position.clone().normalize()
    } else {
      const delta = light.position.clone().sub(point)
      const distance = delta.length()
      direction = delta.normalize()
      attenuation = 1 / Math.max(0.02, distance * distance)
      if (light.distance > 0) {
        const window = Math.max(0, 1 - Math.pow(distance / light.distance, 4))
        attenuation *= window * window
      }
    }
    const nDotL = Math.max(0, normalVector.dot(direction))
    if (nDotL <= 0) continue
    const reflect = direction.dot(view)
    const specular = Math.pow(Math.max(0, reflect), shininess) * (1 - shading.roughness * 0.65)
    const half = direction.clone().add(view).normalize()
    // Blinn-Phong is not energy-normalised, and three's GGX is: at normal incidence
    // three divides the lobe down by roughly the squared roughness it started with, so
    // an unnormalised highlight on rough gunmetal is 4-5× too hot and clips. This
    // factor is the honest correction for the approximation, not a fudge: without it
    // the preview blows out plates the GPU renders fine, and every exposure decision
    // made from it would be wrong.
    const highlight =
      Math.pow(Math.max(0, normalVector.dot(half)), shininess) * ((1 - shading.roughness * 0.6) / (1 + 11 * shading.roughness))
    const power = light.intensity * attenuation
    const spec = highlight + specular * 0.25
    r += (shading.diffuse[0] * diffuseTint[0] * nDotL + specTint[0] * spec) * power
    g += (shading.diffuse[1] * diffuseTint[1] * nDotL + specTint[1] * spec) * power
    b += (shading.diffuse[2] * diffuseTint[2] * nDotL + specTint[2] * spec) * power
  }

  // Image-based lighting as a flat hemisphere term with a Fresnel lift at grazing
  // angles, which is the behaviour that matters on metal: edges catch the room.
  const fresnel = 0.04 + 0.96 * Math.pow(1 - Math.max(0, normalVector.dot(view)), 5)
  const environment = shading.env * (0.18 + 0.82 * fresnel) * (0.35 + 0.65 * (1 - shading.roughness))
  r += shading.diffuse[0] * environment + shading.emissive[0]
  g += shading.diffuse[1] * environment + shading.emissive[1]
  b += shading.diffuse[2] * environment + shading.emissive[2]

  // Contact against the card, so the bottom of the bust is not floating.
  const occlusion = 0.82 + 0.18 * Math.min(1, Math.max(0, point.y + 0.24))
  return [r * occlusion, g * occlusion, b * occlusion]
}

const shadePoint = (point, normalVector, shading) => {
  const [r, g, b] = shade(point, normalVector, shading)
  return acesToneMap(r, g, b, exposure)
}

for (const tri of triangles) {
  const projected = tri.verts.map((v) => ({ ...v, p: project(v) }))
  if (projected.some((v) => !v.p)) continue
  const minX = Math.max(0, Math.floor(Math.min(...projected.map((v) => v.p.x))))
  const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(...projected.map((v) => v.p.x))))
  const minY = Math.max(0, Math.floor(Math.min(...projected.map((v) => v.p.y))))
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...projected.map((v) => v.p.y))))
  if (minX > maxX || minY > maxY) continue

  const [a, b, c] = projected
  const denominator = (b.p.y - c.p.y) * (a.p.x - c.p.x) + (c.p.x - b.p.x) * (a.p.y - c.p.y)
  if (Math.abs(denominator) < 1e-9) continue
  const inverse = 1 / denominator
  const normalVector = new THREE.Vector3(tri.flat[0], tri.flat[1], tri.flat[2]).normalize()

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const u = ((b.p.y - c.p.y) * (px - c.p.x) + (c.p.x - b.p.x) * (py - c.p.y)) * inverse
      const v = ((c.p.y - a.p.y) * (px - c.p.x) + (a.p.x - c.p.x) * (py - c.p.y)) * inverse
      const w = 1 - u - v
      if (u < -0.001 || v < -0.001 || w < -0.001) continue
      const point = new THREE.Vector3(
        u * a.x + v * b.x + w * c.x,
        u * a.y + v * b.y + w * c.y,
        u * a.z + v * b.z + w * c.z,
      )
      const index = y * WIDTH + x
      const depth = u * a.p.depth + v * b.p.depth + w * c.p.depth
      if (covered[index] === 1 && depth >= depthBuffer[index] && !tri.shading.transparent) continue
      let [r, g, bOut] = shadePoint(point, normalVector, tri.shading)
      if (tri.shading.transparent) {
        const a = tri.shading.alpha
        r = r * a + (rgb[index * 3] / 255) * (1 - a)
        g = g * a + (rgb[index * 3 + 1] / 255) * (1 - a)
        bOut = bOut * a + (rgb[index * 3 + 2] / 255) * (1 - a)
      }
      rgb[index * 3] = Math.round(linearToSRGB(r) * 255)
      rgb[index * 3 + 1] = Math.round(linearToSRGB(g) * 255)
      rgb[index * 3 + 2] = Math.round(linearToSRGB(bOut) * 255)
      covered[index] = 1
      depthBuffer[index] = depth
    }
  }
}

/* ------------------------------------------------------------------ *
 * Measurements — the numbers `check-machine-render.mjs` asserts on
 * ------------------------------------------------------------------ */
const totalPixels = WIDTH * HEIGHT
let coveredPixels = 0
let minX = WIDTH
let maxX = 0
let minY = HEIGHT
let maxY = HEIGHT
// Row/column occupancy, so one stray triangle cannot fake a silhouette measurement.
const rowCount = new Int32Array(HEIGHT)
const columnCount = new Int32Array(WIDTH)
const lumas = new Float64Array(totalPixels)
let clipped = 0
let emissivePixels = 0
// Standby light: pixels that are clearly *lit by something inside the model* (hue far from
// grey) without also being bright. `emissivePixels` above is deliberately a bright-glow test
// — it is what catches a blown-out face — and a state that is authored dark cannot pass it by
// design. OFFLINE therefore gets measured against this instead, so "the dimmest state still
// puts light on the face" is a real assertion rather than a threshold nobody will lower.
let standbyPixels = 0
let warmBias = 0
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const i = y * WIDTH + x
    const r = rgb[i * 3] / 255
    const g = rgb[i * 3 + 1] / 255
    const b = rgb[i * 3 + 2] / 255
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lumas[i] = luma
    if (covered[i] === 1) {
      coveredPixels++
      rowCount[y]++
      columnCount[x]++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (r > 0.985 && g > 0.985 && b > 0.985) clipped++
    // "Emissive" here means saturated and brighter than the metal can get by
    // reflection alone: it is a proxy, and it is measured off the same buffer.
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max > 0.35 && max - min > 0.28) emissivePixels++
    if (max > 0.1 && max - min > 0.2) standbyPixels++
    if (r > b * 1.35 && r > 0.28) warmBias++
  }
}

const solidRows = Array.from(rowCount).filter((count) => count > WIDTH * 0.02).length
const solidColumns = Array.from(columnCount).filter((count) => count > HEIGHT * 0.02).length
const sorted = Float64Array.from(lumas).sort()
const percentile = (q) => (totalPixels ? sorted[Math.floor((totalPixels - 1) * q)] : 0)
const coverage = coveredPixels / totalPixels
const silhouetteHeight = maxX >= minX ? (maxY - minY + 1) / HEIGHT : 0
const silhouetteWidth = maxX >= minX ? (maxX - minX + 1) / WIDTH : 0

const info = {
  state: STATE,
  theme: THEME,
  variant: VARIANT,
  quality: QUALITY,
  speaking: SPEAKING,
  out: OUT,
  triangles: triangles.length,
  occupancyOfFrame: Number(silhouetteHeight.toFixed(3)),
  widthOccupancyOfFrame: Number(silhouetteWidth.toFixed(3)),
  // The number the brief is actually about: rows and columns the entity genuinely
  // fills, not the extremes of its projection.
  heightOccupancy: Number((solidRows / HEIGHT).toFixed(3)),
  widthOccupancy: Number((solidColumns / WIDTH).toFixed(3)),
  coverage: Number(coverage.toFixed(3)),
  bustHeightMetres: Number(size.y.toFixed(4)),
  bustWidthMetres: Number(size.x.toFixed(4)),
  cropHeight: Number(framing.cropHeight.toFixed(4)),
  framingLimitedBy: size.y / framing.occupancy > size.x / 0.86 / aspect ? 'height' : 'width',
  distance: Number(framing.distance.toFixed(3)),
  fov: framing.fov,
  exposure,
  luma: { p50: Number(percentile(0.5).toFixed(3)), p95: Number(percentile(0.95).toFixed(3)), p995: Number(percentile(0.995).toFixed(3)), max: Number(percentile(1).toFixed(3)) },
  clippedPixels: clipped,
  emissivePixels,
  standbyPixels,
  warmBiasPixels: warmBias,
  readout: machine.readout,
  // Exposed so an assertion can prove the pointer moved something real, rather than
  // trusting that a number in the middle of a JSON blob changed.
  headYaw: Number(machine.head.rotation.y.toFixed(6)),
  headPitch: Number(machine.head.rotation.x.toFixed(6)),
  jawOpen: Number(machine.drive.jaw.toFixed(6)),
  frameHash: (() => {
    let hash = 0x811c9dc5
    for (let i = 0; i < rgb.length; i += 997) {
      hash ^= rgb[i]
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16)
  })(),
}

await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(OUT)
console.log(JSON.stringify(info, null, 2))
