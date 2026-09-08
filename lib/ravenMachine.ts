/**
 * RAVEN, as a machine: an original procedural cybernetic head, neck and upper
 * torso, built entirely from Three.js geometry.
 *
 * Why procedural, stated plainly: the entity that shipped here before was a
 * licensed human avatar (`public/models/raven/raven.glb`, CC0 MPFB export) whose
 * entire animation system was 66 ARKit facial morphs. Nothing in that file is
 * armour, and no material or lighting change makes a skinned human face into a
 * synthetic machine — so that asset is discontinued rather than dressed up. This
 * module is the replacement, and it is deliberately built from the same
 * dependencies the project already has: `three` geometry, `ExtrudeGeometry`
 * bevels, `LatheGeometry`, `TubeGeometry`, and an `InstancedMesh` for the parts
 * that move every frame. No model file, no CDN, no new package, ₹0.
 *
 * What that buys, and what it costs:
 *  - the proportions, panel seams and emissive channels are *data* in this file, so
 *    the CPU rasteriser in `scripts/render-machine-preview.mjs` renders exactly
 *    what ships, and `check:machine-render` can measure it;
 *  - quality is a parameter (`high` / `medium` / `low` change segment counts,
 *    micro-relief textures and how many detail plates exist), not a second code path;
 *  - a procedural bust has no hair, no skin, no clothing, and no T-pose, because
 *    it has no limbs at all: the composition ends at the shoulders by construction.
 *
 * Everything that moves is driven from `driveRavenMachine()`, which reads the real
 * `RAVEN_STATES` value and the real measured speech energy. There is no internal
 * clock that pretends to be busy: with state `OFFLINE`, or `prefers-reduced-motion`,
 * or a hidden tab, the entity does not animate.
 */
import * as THREE from 'three'
import {
  EMISSIVE,
  MACHINE_COLORS,
  MAX_EMISSIVE,
  MOTION,
  SPEECH,
  STATE_LOOK,
  SURFACES,
  linearToSRGB,
  type StateLook,
  type SurfaceId,
  type SurfaceSpec,
} from './ravenStudio'

export type MachineQuality = 'high' | 'medium' | 'low'

/* ------------------------------------------------------------------ *
 * Small maths
 * ------------------------------------------------------------------ */

const clamp = THREE.MathUtils.clamp

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Frame-rate independent smoothing (same convention the portrait rig used). */
const damp = (current: number, target: number, lambda: number, dt: number) =>
  target + (current - target) * Math.exp(-lambda * Math.max(dt, 0))

type Vec3 = [number, number, number]

/* ------------------------------------------------------------------ *
 * Geometry helpers
 *
 * The look depends on these being *bevelled*, so the profile is extruded with a
 * real bevel instead of a BoxGeometry. Sharp-edged boxes are what make procedural
 * robots read as toys; a 0.4 mm chamfer catching a specular line is what makes them
 * read as machined.
 * ------------------------------------------------------------------ */

type ProfileOptions = {
  depth?: number
  bevel?: number
  /** 1 keeps corners crisp; higher rounds the outline itself. */
  curveSegments?: number
  /** Pulls the back face inward, so a plate looks like a shell, not a biscuit. */
  backInset?: number
}

/**
 * A lofted solid through a stack of cross-sections.
 *
 * This is the structural primitive the whole head is built from, and it exists
 * because lathes are round. `LatheGeometry` gave the previous attempt the silhouette
 * of a motorcycle helmet: a smooth dome, no cheekbones, no plane change anywhere. A
 * loft through octagonal sections with *per-section* half-width and half-depth gives
 * eight flat panels per band, so the surface is a machined faceting that catches a
 * light differently on every band — an angular skull, with a real front plane.
 *
 * `sections` are ordered bottom to top. Flat normals are the point: the facets are
 * what read as "assembled from plates" rather than "scanned from a human".
 */
function loftGeometry(
  sections: { y: number; halfWidth: number; halfDepth: number; twist?: number }[],
  options: { sides?: number; capBottom?: boolean; capTop?: boolean; flatness?: number } = {},
): THREE.BufferGeometry {
  const { sides = 8, capBottom = true, capTop = true, flatness = 0.5 } = options
  const positions: number[] = []
  const normals: number[] = []

  const ringOf = (index: number) => {
    const spec = sections[index]
    const twist = spec.twist ?? 0
    const points: [number, number][] = []
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + Math.PI / sides + twist
      // A regular octagon is round-ish. Pushing the vertices whose normal points
      // sideways out to the full half-width, and leaving the front/back ones at
      // 0.88, is what turns the same ring into a skull with cheekbones and a flat
      // facial plane instead of a barrel.
      const across = Math.abs(Math.cos(angle))
      const along = Math.abs(Math.sin(angle))
      const w = across > flatness ? spec.halfWidth : spec.halfWidth * 0.88
      const d = along > flatness ? spec.halfDepth : spec.halfDepth * 0.86
      points.push([Math.cos(angle) * w, Math.sin(angle) * d])
    }
    return { points, y: spec.y }
  }

  const pushFace = (corners: [number, number, number][]) => {
    const a = corners[0]
    const b = corners[1]
    const last = corners[corners.length - 1]
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = last[0] - a[0]
    const vy = last[1] - a[1]
    const vz = last[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    for (let i = 1; i < corners.length - 1; i++) {
      for (const corner of [a, corners[i], corners[i + 1]]) {
        positions.push(corner[0], corner[1], corner[2])
        normals.push(nx, ny, nz)
      }
    }
  }

  for (let band = 0; band < sections.length - 1; band++) {
    const lower = ringOf(band)
    const upper = ringOf(band + 1)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      pushFace([
        [lower.points[i][0], lower.y, lower.points[i][1]],
        [lower.points[j][0], lower.y, lower.points[j][1]],
        [upper.points[j][0], upper.y, upper.points[j][1]],
        [upper.points[i][0], upper.y, upper.points[i][1]],
      ])
    }
  }

  const cap = (index: number, outward: boolean) => {
    const ring = ringOf(index)
    const apex: [number, number, number] = [0, ring.y + (outward ? 0.0012 : -0.0012), 0]
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      const front: [number, number, number] = [ring.points[i][0], ring.y, ring.points[i][1]]
      const back: [number, number, number] = [ring.points[j][0], ring.y, ring.points[j][1]]
      pushFace(outward ? [apex, front, back] : [apex, back, front])
    }
  }
  if (capTop) cap(sections.length - 1, true)
  if (capBottom) cap(0, false)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Extrudes a closed polygon outline into a bevelled plate. `points` are in the
 * plate's own 2D space (x across, y up); the result is centred on x and sits with
 * its front face at +z.
 */
function plateGeometry(points: Vec3[] | [number, number][], options: ProfileOptions = {}): THREE.ExtrudeGeometry {
  const { depth = 0.012, bevel = 0.0022, curveSegments = 1, backInset = 0 } = options
  const shape = new THREE.Shape()
  points.forEach((point, index) => {
    const x = point[0]
    const y = point[1]
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 0.0015),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: curveSegments,
    curveSegments,
    steps: 1,
  })
  if (backInset > 0) {
    // Taper the rear verts toward the outline centroid: cheaper silhouette, and the
    // plate then casts a shadow line where it overlaps the next layer.
    const position = geometry.attributes.position as THREE.BufferAttribute
    const frontZ = depth / 2
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i)
      if (z > frontZ - bevel * 1.5) continue
      position.setX(i, position.getX(i) * (1 - backInset))
      position.setY(i, position.getY(i) * (1 - backInset))
    }
    position.needsUpdate = true
  }
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  return geometry
}

/** Rectangle with cut corners: the default mechanical outline. */
function chamferedRect(width: number, height: number, corner: number, steps = 2): [number, number][] {
  const w = width / 2
  const h = height / 2
  const c = Math.min(corner, w * 0.9, h * 0.9)
  const points: [number, number][] = []
  const cornerAt = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = from + (Math.PI / 2) * (i / steps)
      points.push([cx + Math.cos(a) * c, cy + Math.sin(a) * c])
    }
  }
  cornerAt(w - c, h - c, 0)
  cornerAt(-w + c, h - c, Math.PI / 2)
  cornerAt(-w + c, -h + c, Math.PI)
  cornerAt(w - c, -h + c, (3 * Math.PI) / 2)
  return points
}

/** Four-sided profile with different top/bottom widths — the workhorse plate. */
/**
 * A thin rectangular piece of hardware — a filament, a lens, a shutter.
 *
 * On `high` and `medium` these are chamfered extrusions (≈92 triangles) because a 0.6 mm
 * bevel is what catches the key light along an edge. On the phone tier the same piece is
 * four pixels wide, the bevel cannot be resolved, and 92 triangles for a rectangle is pure
 * waste — so `low` gets a box (12). Same silhouette, same drive handles. This is the
 * honest meaning of "adaptive quality": the tier that costs a device something loses the
 * detail that costs the eye nothing.
 */
function slab(quality: MachineQuality, width: number, height: number, depth: number, bevel = 0.0006): THREE.BufferGeometry {
  return quality === 'low'
    ? new THREE.BoxGeometry(width, height, depth)
    : plateGeometry(chamferedRect(width, height, bevel), { depth, bevel: bevel * 0.8 })
}


function trapezoid(widthTop: number, widthBottom: number, height: number, corner = 0.004): [number, number][] {
  const hh = height / 2
  const raw: [number, number][] = [
    [-widthTop / 2, hh],
    [widthTop / 2, hh],
    [widthBottom / 2, -hh],
    [-widthBottom / 2, -hh],
  ]
  // Round only the corners, by insetting each pair — no curve segments needed.
  const out: [number, number][] = []
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]
    const b = raw[(i + 1) % raw.length]
    const to = (from: [number, number], toward: [number, number]) => {
      const dx = toward[0] - from[0]
      const dy = toward[1] - from[1]
      const length = Math.hypot(dx, dy) || 1
      const k = Math.min(corner, length * 0.45) / length
      return [from[0] + dx * k, from[1] + dy * k] as [number, number]
    }
    out.push(to(a, b))
    out.push(to(b, a))
  }
  return out
}

/** Facet count that scales with quality, so `low` really is simpler geometry. */
function segments(quality: MachineQuality, high: number, medium: number, low: number): number {
  return quality === 'high' ? high : quality === 'medium' ? medium : low
}

/* ------------------------------------------------------------------ *
 * Micro-relief: brushed metal and woven composite, generated here
 * ------------------------------------------------------------------ */

export type WeaveTextures = { roughnessMap: THREE.DataTexture; normalMap: THREE.DataTexture }

/**
 * Deterministic 128×128 micro-relief. Two textures, one generator:
 *  - a roughness map whose anisotropic streaks break the perfect mirror of a
 *    default material, which is most of what separates "brushed titanium" from
 *    "chrome";
 *  - a normal map derived from the same height field, so the streaks have edges.
 *
 * Written as a `DataTexture` (no canvas, no fetch, no asset) and shared by every
 * surface that asks for it, so the whole entity costs one 2 × 128² upload.
 */
export function makeWeaveTextures(): WeaveTextures | null {
  const size = 128
  const height = new Float32Array(size * size)
  const random = mulberry32(0x7a3e)
  // Streaks along x for brushed metal; a twill cross for the carbon plates. Both in
  // one field: the low-frequency cross gives the weave, the high-frequency lines the
  // brushing. Cheaper than two textures and it reads correctly on both surfaces.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const streak = Math.sin((x / size) * Math.PI * 2 * 21 + Math.sin((y / size) * Math.PI * 2 * 3) * 1.9)
      const twill = Math.sin(((x + y) / size) * Math.PI * 2 * 7) * Math.cos(((x - y) / size) * Math.PI * 2 * 5)
      const grain = random() - 0.5
      height[y * size + x] = streak * 0.5 + twill * 0.24 + grain * 0.26
    }
  }

  const roughness = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const v = 0.5 + height[i] * 0.26
    const byte = Math.round(clamp(v, 0, 1) * 255)
    roughness[i * 4] = byte
    roughness[i * 4 + 1] = byte
    roughness[i * 4 + 2] = byte
    roughness[i * 4 + 3] = 255
  }

  const normal = new Uint8Array(size * size * 4)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  const strength = 1.6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const nx = -dx
      const ny = dy
      const nz = 1
      const length = Math.hypot(nx, ny, nz)
      const o = (y * size + x) * 4
      normal[o] = Math.round(((nx / length) * 0.5 + 0.5) * 255)
      normal[o + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255)
      normal[o + 2] = Math.round(((nz / length) * 0.5 + 0.5) * 255)
      normal[o + 3] = 255
    }
  }

  try {
    const roughnessMap = new THREE.DataTexture(roughness, size, size, THREE.RGBAFormat)
    const normalMap = new THREE.DataTexture(normal, size, size, THREE.RGBAFormat)
    for (const texture of [roughnessMap, normalMap]) {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(5, 5)
      texture.anisotropy = 2
      texture.needsUpdate = true
    }
    roughnessMap.colorSpace = THREE.NoColorSpace
    normalMap.colorSpace = THREE.NoColorSpace
    return { roughnessMap, normalMap }
  } catch {
    return null // a DataTexture failure must not take the entity down
  }
}

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

export type MachineMaterials = Record<SurfaceId, THREE.MeshPhysicalMaterial> & {
  emissive: Record<string, THREE.MeshStandardMaterial>
  glow: THREE.MeshBasicMaterial
}

function surfaceMaterial(spec: SurfaceSpec, weave: WeaveTextures | null): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.color),
    metalness: spec.metalness,
    roughness: spec.roughness,
    envMapIntensity: spec.envMapIntensity,
    // Metals must not have a dielectric specular layer on top of their own; three
    // handles this, but `specularIntensity` still helps keep the highlight tight.
    specularIntensity: spec.metalness > 0.9 ? 0.32 : 0.55,
    specularColor: new THREE.Color(0xbfd6e6),
    clearcoat: spec.clearcoat ?? 0,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0.3,
    anisotropy: spec.anisotropy ?? 0,
    anisotropyRotation: Math.PI / 2,
    side: THREE.FrontSide,
    flatShading: false,
    transparent: spec.transparent ?? false,
    opacity: spec.opacity ?? 1,
    depthWrite: spec.transparent ? false : true,
  })
  material.name = `raven.surface.${spec.id}`
  if (weave && spec.weave) {
    material.roughnessMap = weave.roughnessMap
    material.normalMap = weave.normalMap
    material.normalScale = new THREE.Vector2(0.35, 0.35)
  }
  return material
}

function emissiveMaterial(family: keyof typeof EMISSIVE): THREE.MeshStandardMaterial {
  const spec = EMISSIVE[family]
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x05070a),
    emissive: new THREE.Color(spec.color),
    emissiveIntensity: 0.5,
    metalness: 0,
    roughness: 0.35,
    // Never additive: additive emissive over a dark card is the "cheap hologram"
    // look. Emission through the tone mapper is what keeps it a physical light.
    transparent: false,
    toneMapped: true,
  })
  material.name = `raven.emissive.${family}`
  return material
}

/* ------------------------------------------------------------------ *
 * Instanced emissive elements (flow segments, vent slats, trim lines)
 * ------------------------------------------------------------------ */

type GlowGroup = {
  mesh: THREE.InstancedMesh
  count: number
  /** Per-instance phase along its channel, so a travelling pulse can be animated. */
  phase: Float32Array
  /** Per-instance base colour, copied from the family and tinted per state. */
  color: THREE.Color
  scratch: THREE.Color
}

function glowGroup(geometry: THREE.BufferGeometry, material: THREE.MeshBasicMaterial, count: number): GlowGroup {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.name = 'raven.glow'
  const colors = new Float32Array(count * 3)
  colors.fill(1)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
  return { mesh, count, phase: new Float32Array(count), color: new THREE.Color(0xffffff), scratch: new THREE.Color() }
}

/* ------------------------------------------------------------------ *
 * The entity
 * ------------------------------------------------------------------ */

export type RavenMachine = {
  root: THREE.Group
  head: THREE.Group
  skull: THREE.Group
  jaw: THREE.Group
  sockets: { left: THREE.Group; right: THREE.Group }
  sensors: { left: THREE.Group; right: THREE.Group }
  emitters: { left: THREE.Mesh; right: THREE.Mesh }
  shutters: { left: THREE.Mesh[]; right: THREE.Mesh[] }
  vanes: { left: THREE.Group; right: THREE.Group }
  neck: { group: THREE.Group; rings: THREE.Mesh[] }
  torso: THREE.Group
  core: {
    group: THREE.Group
    emitter: THREE.Mesh
    gimbals: THREE.Mesh[]
    petals: THREE.Mesh[]
    light: THREE.PointLight
  }
  lights: { eye: THREE.PointLight[] }
  groups: { flow: GlowGroup; vents: GlowGroup; ventsBody: GlowGroup; trim: GlowGroup }
  materials: MachineMaterials
  textures: WeaveTextures | null
  geometries: THREE.BufferGeometry[]
  stats: { meshes: number; triangles: number; parts: number; quality: MachineQuality }
  readout: MachineReadout
  drive: DriveMemory
}

/** Measured values the HUD/diagnostics overlay is allowed to show. */
export type MachineReadout = {
  state: string
  lookLabel: string
  eyeIntensity: number
  aperture: number
  coreRateHz: number
  coreIntensity: number
  flowSpeed: number
  jawOpen: number
  tracking: number
}

type DriveMemory = {
  yaw: number
  pitch: number
  roll: number
  torsoYaw: number
  sensorYaw: number
  sensorPitch: number
  aperture: number
  eyeIntensity: number
  coreIntensity: number
  corePhase: number
  jaw: number
  vane: number
  neck: number
  spread: number
  microClock: number
  microTarget: Vec3
  microCurrent: Vec3
  flowPhase: number
  scanPhase: number
  holdPhase: number
  random: () => number
  lastState: string
  stateChangedAt: number
}

/** Named parts the audit script looks for; each must exist at every quality level. */
export const REQUIRED_PARTS = [
  'skull.dome',
  'skull.plate.forehead',
  'skull.plate.brow',
  'skull.socket.left',
  'skull.socket.right',
  'skull.sensor.left',
  'skull.sensor.right',
  'skull.plate.cheek.left',
  'skull.plate.cheek.right',
  'skull.plate.temple.left',
  'skull.plate.temple.right',
  'skull.spine',
  'skull.vents',
  'jaw.hinge',
  'jaw.plate.left',
  'jaw.plate.right',
  'jaw.chin',
  'jaw.grille',
  'neck.column',
  'neck.ring.0',
  'shoulder.pauldron.left',
  'shoulder.pauldron.right',
  'core.housing',
  'core.emitter',
  'core.louvre',
  'core.gimbal.0',
  'channels',
  'torso.chest',
  'torso.sternum',
] as const

/**
 * Builds the bust. `quality` changes segment counts, whether the micro-relief
 * textures and per-eye lights exist, and how many secondary plates are created —
 * never the silhouette, so a phone shows the same *design*.
 */
export function buildRavenMachine(quality: MachineQuality = 'high'): RavenMachine {
  const textures = quality === 'low' ? null : makeWeaveTextures()
  const materials = {} as MachineMaterials
  for (const key of Object.keys(SURFACES) as SurfaceId[]) {
    materials[key] = surfaceMaterial(SURFACES[key], textures)
  }
  const emissive: Record<string, THREE.MeshStandardMaterial> = {}
  for (const family of Object.keys(EMISSIVE)) {
    emissive[family] = emissiveMaterial(family as keyof typeof EMISSIVE)
  }
  materials.emissive = emissive

  // A single basic material for every instanced glow element: colour arrives per
  // instance through `instanceColor`, so one material serves hundreds of lights.
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true })
  glow.name = 'raven.glow'
  materials.glow = glow

  const geometries: THREE.BufferGeometry[] = []
  const keep = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.push(geometry)
    return geometry
  }

  const parts = new Map<string, THREE.Object3D>()
  const name = <T extends THREE.Object3D>(object: T, part: string): T => {
    object.name = part
    parts.set(part, object)
    return object
  }

  const addMesh = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: Vec3,
    rotation: Vec3 = [0, 0, 0],
    part?: string,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(keep(geometry), material)
    mesh.position.set(position[0], position[1], position[2])
    mesh.rotation.set(rotation[0], rotation[1], rotation[2])
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false // the head rotates a lot; bounds are cheap to skip
    if (part) name(mesh, part)
    parent.add(mesh)
    return mesh
  }

  const root = new THREE.Group()
  name(root, 'raven.root')
  const torso = new THREE.Group()
  name(torso, 'raven.torso')
  root.add(torso)
  const neckGroup = new THREE.Group()
  name(neckGroup, 'raven.neck')
  torso.add(neckGroup)
  const head = new THREE.Group()
  name(head, 'raven.head')
  // The neck's top ring is the head's pivot: every head rotation happens at the
  // atlas joint, not at the centre of the skull, or the chin would slide sideways.
  head.position.set(0, -0.078, 0.004)
  neckGroup.add(head)

  const skull = new THREE.Group()
  name(skull, 'raven.skull')
  // The skull is centred 96 mm above the atlas pivot, and everything in it is
  // authored from the skull's own middle. That is what lets the head be re-seated on
  // the neck by changing this one number instead of re-flowing forty plates.
  // 88 mm, not 96: the cranium grew a swept keel at the top, and re-seating the skull a few
  // millimetres lower keeps the total bust height (and therefore the camera framing) where it
  // was instead of quietly pushing the head out of the card.
  skull.position.set(0, 0.088, 0.004)
  // 1.12 on the skull alone: a character reveal wants a head with mass on the
  // shoulders, and at 1.0 the loft reads as a small helmet on a large chassis.
  // Not uniform: 1.16 across and 1.10 tall widens the cranium and shortens the face,
  // which is the proportion that makes a head look engineered rather than mannequin-ish.
  // Everything inside `skull` is authored in this space, so the plates follow exactly.
  // 1.16 across, 1.04 tall, 1.02 deep. The height is deliberately *not* scaled up with the
  // width: a cranium that is wide and short reads as a helmet, and a cranium that is wide at
  // the parietals with a low crown reads as a skull that was designed.
  skull.scale.set(1.16, 1.04, 1.03)
  head.add(skull)

  /* ---------------- cranium ---------------- */
  // A loft through octagonal sections, not a lathe. A lathe is circular in section and
  // gives a motorcycle helmet: smooth, round, no cheekbones and no facial plane. The
  // loft below has six sections whose half-width peaks at the zygomatic line and
  // whose front vertices are pulled inboard (see `flatness` in `loftGeometry`), so the
  // result is eight flat panels per band with a genuinely flat front third: an angular
  // mechanical skull that catches the key light as a set of facets.
  const skullLoft = addMesh(
    skull,
    loftGeometry(
      [
        // Nine sections, and every one of them moves in both axes at once. This is the
        // difference between a head that reads as machinery and a head that reads as a
        // stack: the previous six-section version was near-constant in halfDepth from
        // temple to crown, so the *silhouette* was a rectangle with a step on top, however
        // much armour was bolted to it. Now: a 34 mm chin root, a jaw that widens to the
        // gonial corners, the face's own widest line at the zygomatics (84 mm), the cranium
        // peaking at the parietals (99 mm) and then closing to a 33 mm keel with the depth
        // *following* the width down, so the crown is a swept dome in plan and in profile.
        // Nothing about the outline is a straight vertical run.
        { y: -0.118, halfWidth: 0.0345, halfDepth: 0.0400 },
        { y: -0.092, halfWidth: 0.0520, halfDepth: 0.0540 },
        { y: -0.058, halfWidth: 0.0700, halfDepth: 0.0640 },
        { y: -0.016, halfWidth: 0.0840, halfDepth: 0.0720 },
        { y: 0.026, halfWidth: 0.0900, halfDepth: 0.0780 },
        { y: 0.066, halfWidth: 0.0985, halfDepth: 0.0845 },
        { y: 0.100, halfWidth: 0.0880, halfDepth: 0.0815 },
        { y: 0.126, halfWidth: 0.0590, halfDepth: 0.0640 },
        { y: 0.146, halfWidth: 0.0330, halfDepth: 0.0430 },
      ],
      // Six panels, not eight: fewer, wider facets means the key light crosses the skull as
      // three big planes per side and the cheek line actually exists. Eight on a loft this
      // size produced a soft gradient that read as a moulded helmet no matter what the
      // silhouette did. The front third is pulled inboard so the facial plane is flat.
      { sides: 6, flatness: 0.62 },
    ),
    materials.shell,
    [0, 0, -0.006],
    undefined,
    'skull.dome',
  )
  void skullLoft

  // Crown: a keel, not a plateau. A flat plate lying on top of a dome is the single most
  // "box with a lid" thing a procedural head can do, and it is what made the previous
  // silhouette read rectangular. The keel below is a narrow bevelled spine that follows the
  // loft's own taper from brow to occiput, and it is flanked by two swept parietal shells
  // that wrap the sides of the cranium — three continuous surfaces meeting at lines, which
  // is how pressed armour actually assembles.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.034, 0.026, 0.156, 0.006), { depth: 0.011, bevel: 0.0022, backInset: 0.16 }),
    materials.shell,
    [0, 0.1135, -0.012],
    [1.4708, 0, 0],
    'skull.plate.crown',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.014, 0.009, 0.088, 0.0028), { depth: 0.005, bevel: 0.0012 }),
    materials.titanium,
    [0, 0.1215, -0.016],
    [1.4708, 0, 0],
    'skull.ridge',
  )
  if (quality !== 'low') {
    // The parietal shells overlap the keel by a few millimetres. Overlap, not abutment, is
    // what lets you see a *gap* between armour sections from the front, and the shadow line
    // in that gap is the whole reason layered plate reads as layered.
    for (const side of [-1, 1] as const) {
      addMesh(
        skull,
        plateGeometry(trapezoid(0.052, 0.038, 0.104, 0.0066), { depth: 0.0075, bevel: 0.0016, backInset: 0.14 }),
        materials.plate,
        [side * 0.0505, 0.101, -0.014],
        [1.452, 0, side * 0.14],
        `skull.plate.parietal.${side < 0 ? 'left' : 'right'}`,
      )
      // Temporal crest: a brushed fin that leaves the brow line, runs back over the temple
      // and dies into the occiput. It is the part that ties the face to the cranium as one
      // object, and from the front it narrows the apparent width of the skull by throwing a
      // shadow line down the side of the face.
      addMesh(
        skull,
        plateGeometry(trapezoid(0.0135, 0.0105, 0.072, 0.0032), { depth: 0.0068, bevel: 0.0014, backInset: 0.22 }),
        materials.titanium,
        [side * 0.0808, 0.0475, 0.0125],
        [0.06, side * 1.36, side * -0.1],
        `skull.crest.temporal.${side < 0 ? 'left' : 'right'}`,
      )
    }
  }

  // Occiput: mass at the back so the profile is not a balloon, plus a yoke that ties
  // it into the neck — the part of a skull that always reads as structure.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.104, 0.068, 0.072, 0.009), { depth: 0.018, bevel: 0.003, backInset: 0.24 }),
    materials.plate,
    [0, 0.022, -0.088],
    [-0.2, 0, 0],
    'skull.plate.occiput',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.072, 0.056, 0.026, 0.005), { depth: 0.012, bevel: 0.0022 }),
    materials.titanium,
    [0, -0.036, -0.084],
    [-0.42, 0, 0],
    'skull.yoke',
  )

  // One seam line, following the loft at the temple line. Deliberately the only
  // bright trim on the head: seams that glow everywhere read as a decal set, and the
  // silhouette needs exactly one continuous edge to be legible at hero size.
  const seam = addMesh(
    skull,
    new THREE.TorusGeometry(0.0845, 0.0014, 3, segments(quality, 20, 14, 8)),
    materials.trim,
    [0, 0.058, -0.006],
    [Math.PI / 2, 0, 0],
    'skull.seam',
  )
  seam.scale.set(1.06, 1, 0.94)

  /* ---------------- forehead and brow ---------------- */
  // Three layers with a dark step between each. Two plates read as "a helmet with a
  // band on it"; a stepped stack with visible thickness reads as armour that was bolted
  // down over a skull, which is the difference the brief is asking for.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.126, 0.106, 0.034, 0.0062), { depth: 0.013, bevel: 0.0022, backInset: 0.12 }),
    materials.plate,
    [0, 0.0535, 0.0745],
    [0.3, 0, 0],
    'skull.plate.forehead',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.092, 0.072, 0.022, 0.0042), { depth: 0.011, bevel: 0.0016, backInset: 0.1 }),
    materials.shell,
    [0, 0.0735, 0.0792],
    [0.27, 0, 0],
    'skull.plate.forehead.upper',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.064, 0.046, 0.018, 0.0036), { depth: 0.009, bevel: 0.0014, backInset: 0.08 }),
    materials.plate,
    [0, 0.0885, 0.0768],
    [0.24, 0, 0],
    'skull.plate.forehead.crown',
  )
  // Central facial architecture: a matte keyway down the middle of the forehead. It is
  // dark on purpose — the bright version of this part read as a nose bridge, and the
  // face must not acquire a nose.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.0075, 0.0055, 0.026, 0.0014), { depth: 0.003, bevel: 0.0006 }),
    materials.matte,
    [0, 0.0685, 0.0792],
    [0.26, 0, 0],
    'skull.plate.forehead.keyway',
  )
  // The brow shelf. Its only job is to overhang the sensors, because an eye that is
  // lit from above is a decoration and an eye in shadow is a threat.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.152, 0.132, 0.014, 0.0026), { depth: 0.014, bevel: 0.0018, backInset: 0.03 }),
    materials.shell,
    [0, 0.0375, 0.0885],
    [0.075, 0, 0],
    'skull.plate.brow',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.016, 0.011, 0.0034, 0.0012), { depth: 0.002, bevel: 0.0006 }),
    materials.plate,
    [0, 0.0452, 0.0918],
    [0.1, 0, 0],
    'skull.brow.crest',
  )

  // The face is a mask bolted to the skull, not a skull with parts stuck on it. That
  // is both how you build a flat facial plane and how you get real recesses: the
  // sockets are bored *into* this plate, so the sensors sit 12 mm behind the surface
  // with a machined lip around them. Nothing about a face reads as engineered until
  // something is inside something else.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.132, 0.094, 0.108, 0.012), { depth: 0.019, bevel: 0.0032, backInset: 0.12 }),
    materials.plate,
    [0, 0.004, 0.0845],
    [0.055, 0, 0],
    'skull.plate.mask',
  )
  // Maxilla plate: the fixed upper half of the lower face. It ends at a hard edge, and
  // the jaw starts below it, so the two are visibly different parts.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.062, 0.05, 0.026, 0.005), { depth: 0.009, bevel: 0.0012, backInset: 0.14 }),
    materials.plate,
    [0, -0.0435, 0.0795],
    [0.13, 0, 0],
    'skull.plate.maxilla',
  )

  /* ------------------------------------------------------------ the band ---------
   * RAVEN's identity, in one object: a single narrow segmented optical band set into a
   * machined duct, with a continuous cowl overhanging it and a rail under it. Four
   * apertures, two long and two short, separated by 2 mm of dark metal, so the whole
   * face is one instrument rather than a pair of eyes. This replaced the previous
   * "two bright slits floating on a grey face", which read as a robot with eyes instead
   * of an intelligence that is looking at you.
   *
   * Rules this obeys: the band is the *only* bright thing on the head; the metal around it
   * is dark and matte; the light comes from inside recesses, never painted on the surface;
   * and it stays perfectly symmetrical, because asymmetry here would read as damage.
   */
  // The duct: a matte channel cut across the face. Everything optical lives inside it.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.146, 0.132, 0.0205, 0.0042), { depth: 0.0105, bevel: 0.0014, backInset: 0.34 }),
    materials.matte,
    [0, 0.0125, 0.0878],
    undefined,
    'visor.duct',
  )
  // The cowl: one continuous bevelled bar overhanging the duct. Its underside is the shadow
  // the apertures sit in, and from the front it is the line that makes the band read as
  // *recessed* rather than applied.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.156, 0.14, 0.0132, 0.0026), { depth: 0.0115, bevel: 0.0018, backInset: 0.05 }),
    materials.shell,
    [0, 0.0315, 0.0945],
    [0.04, 0, 0],
    'skull.plate.visor.upper',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.052, 0.034, 0.0052, 0.0012), { depth: 0.004, bevel: 0.0008 }),
    materials.plate,
    [0, 0.0398, 0.0992],
    [0.04, 0, 0],
    'visor.cowl.crest',
  )
  // The rail: the duct's floor, and the only bright line below the band.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.15, 0.134, 0.0075, 0.0018), { depth: 0.0075, bevel: 0.0012, backInset: 0.06 }),
    materials.plate,
    [0, -0.0085, 0.0932],
    [-0.03, 0, 0],
    'skull.plate.visor.lower',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.118, 0.102, 0.013, 0.0026), { depth: 0.009, bevel: 0.0016, backInset: 0.06 }),
    materials.plate,
    [0, 0.0315, 0.0958],
    [0.04, 0, 0],
    'skull.plate.visor.upper.inner',
  )
  // Cowl wings: the brow's two ends drop 7.5°, which turns the top of the band into a shallow
  // chevron. Without them every line on the face is horizontal and the head reads as a stack
  // of louvres; with them there is one angle on the face, and it is the angle that carries
  // the light. Also fixes a real bug — this second cowl layer used to share the outer plate's
  // part name, so `parts.get('skull.plate.visor.upper')` was returning whichever of the two
  // the build happened to register last.
  if (quality !== 'low') {
    for (const side of [-1, 1] as const) {
      addMesh(
        skull,
        plateGeometry(trapezoid(0.034, 0.026, 0.0116, 0.0022), { depth: 0.0085, bevel: 0.0014, backInset: 0.08 }),
        materials.shell,
        [side * 0.0735, 0.0322, 0.0945],
        [0.035, side * -0.05, side * 0.131],
        `skull.plate.visor.wing.${side < 0 ? 'left' : 'right'}`,
      )
    }
  }
  addMesh(
    skull,
    plateGeometry(trapezoid(0.11, 0.094, 0.0105, 0.0022), { depth: 0.008, bevel: 0.0014, backInset: 0.06 }),
    materials.plate,
    [0, -0.0085, 0.0948],
    [-0.03, 0, 0],
    'skull.plate.visor.lower',
  )
  // Bridge strap between the apertures, so the band is machined *around* the eyes.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.0135, 0.0105, 0.02, 0.0018), { depth: 0.0035, bevel: 0.0008 }),
    materials.plate,
    [0, 0.0115, 0.0985],
    undefined,
    'skull.bridge',
  )

  /* ---------------- sensors ---------------- */
  // Not eyeballs. Each eye is a pod that translates inside a machined track and
  // tilts on its own axis: the aperture is a slot, the lids are shutters that slide
  // horizontally, and the travel is bounded by the track. All of that is what makes
  // "aware of you" read as a mechanism instead of a stare.
  const sockets: { left: THREE.Group; right: THREE.Group } = { left: new THREE.Group(), right: new THREE.Group() }
  const sensors: { left: THREE.Group; right: THREE.Group } = { left: new THREE.Group(), right: new THREE.Group() }
  const emitters: { left: THREE.Mesh; right: THREE.Mesh } = {
    left: undefined as unknown as THREE.Mesh,
    right: undefined as unknown as THREE.Mesh,
  }
  const shutters: { left: THREE.Mesh[]; right: THREE.Mesh[] } = { left: [], right: [] }

  // 6.1 : 1 aspect. Slot width to height is the entire personality of this face: at
  // 2:1 it is a pair of goggles, at 3.6:1 with a bridge over the middle it is a sensor
  // array, and past 5:1 it is an *instrument* — which is where the brief wants it, since
  // the aperture has to stay legible at 90 px. The narrowness is also what lets the
  // recess read: a tall opening shows its own inner walls, a short one shows only light.
  // A sensor aperture is 54.5 mm wide and 7.2 mm tall, bored 36 mm into the face.
  // Height is the number that matters: at 13 mm it read as two glowing tablets, which is
  // "giant glowing eyeball" by another route. Thin over a long span is what an optical
  // array looks like, and the depth is what makes the eye *recessed* rather than painted.
  // 20 mm of height was two glowing tablets; 7.2 mm inside a 36 mm bore is an optical
  // array. The aspect is now 7.2:1, which is what keeps the band narrow at every framing
  // size, and the housing sits inside the duct rather than on the mask plate.
  const SLOT = { width: 0.0545, height: 0.0072, depth: 0.034 } as const

  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right'
    const socket = sockets[key]
    name(socket, `skull.socket.${key}`)
    // Back at 88.5 mm, so the bore runs into the lower visor band and the pod ends up a
    // few millimetres *behind* the lips. That is the only arrangement where both eyes
    // read identically from the hero camera.
    // 96.5 mm: the mouth of the bore has to be at or in front of the face plate's own
    // surface (94 mm) or the plate hides the recess it is supposed to contain. The
    // emitter then sits 4 mm behind that mouth — visible, and shadowed, which is the
    // whole effect a sensor housing is after.
    // 88.5 mm: the whole housing sits *behind* the mask plate's front face (94 mm), with
    // only the lips and the bore mouth reaching the surface. Anything that protrudes to the
    // same depth as the face gets lit like the face, and the aperture frame then competes
    // with the light inside it — which is exactly what the close-up kept showing.
    socket.position.set(side * 0.0475, 0.0125, 0.0885)
    // Angled back toward the ear, and tilted a few degrees down-and-in. Two flat
    // circles side by side is a mask; canted slots are a face.
    // A hint of angle, not a real yaw: at 0.19 rad the bore's own inner wall was being
    // projected *across* the emitter by parallax, which is the dark bar that appeared
    // inside each eye. The face plate's bands carry the angle instead.
    socket.rotation.set(0, side * 0.05, side * -0.02)
    skull.add(socket)

    // The bore: matte, and deeper than it looks, so the pod inside is never on the
    // surface. `SLOT.depth` of 24 mm of shadow is the whole difference.
    // The bore: four matte walls, deliberately *open* at the front. A closed box was
    // the original bug — its own front face sat in front of the emitter and swallowed
    // the eye, and which eye survived depended on the socket's yaw. An open rectangular
    // recess is also what a machined sensor housing actually is.
    const wall = 0.0022
    const boreWalls = quality === 'low' ? [1, 0] : [1, 1, 0, 0]
    boreWalls.forEach((horizontal, index) => {
      const side = index % 2 === 0 ? 1 : -1
      addMesh(
        socket,
        new THREE.BoxGeometry(
          horizontal ? SLOT.width + 0.006 : wall,
          horizontal ? wall : SLOT.height + 0.006,
          SLOT.depth,
        ),
        materials.matte,
        horizontal
          ? [0, side * (SLOT.height / 2 + wall / 2), -SLOT.depth / 2 - 0.0025]
          : [side * (SLOT.width / 2 + wall / 2), 0, -SLOT.depth / 2 - 0.0025],
      )
    })
    // Back plane of the cavity, so the pod is read against a shadowed interior rather
    // than against the inside of the face plate.
    addMesh(
      socket,
      new THREE.PlaneGeometry(SLOT.width + 0.006, SLOT.height + 0.006),
      materials.matte,
      [0, 0, -SLOT.depth - 0.0025],
    )

    // The lips: what the eye of the viewer actually catches first, because a bright
    // hard edge around a dark hole is how a machined aperture reads.
    const lip = (width: number, height: number, y: number, material: THREE.Material, z: number, part: string) =>
      addMesh(
        socket,
        plateGeometry(chamferedRect(width, height, 0.0008), { depth: 0.0042, bevel: 0.0008 }),
        material,
        [0, y, z],
        undefined,
        part,
      )
    // Lintel bright, sill dark. One hard edge of light on top of the aperture is what
    // makes a hole read as machined; two bright edges of the same length read as a visor,
    // and the pair of them nearly touched across the midline — which is how the face
    // acquired goggles instead of eyes.
    lip(SLOT.width + 0.0025, 0.0016, SLOT.height / 2 + 0.0009, materials.titanium, 0.0066, `skull.socket.lintel.${key}`)
    lip(SLOT.width + 0.0025, 0.0016, -(SLOT.height / 2 + 0.0008), materials.plate, 0.0066, `skull.socket.sill.${key}`)
    // The inner post only: it bisects the aperture into iris and duct, and the outer
    // edge stays clean so the silhouette of the head is not broken by protrusions.
    addMesh(
      socket,
      plateGeometry(chamferedRect(0.0022, SLOT.height + 0.004, 0.0007), { depth: 0.004, bevel: 0.0006 }),
      materials.plate,
      [side * (SLOT.width / 2 + 0.0014), 0, 0.0072],
      undefined,
      `skull.socket.post.${key}.inner`,
    )

    // The pod: what actually turns to look at you.
    const pod = sensors[key]
    name(pod, `skull.sensor.${key}`)
    pod.position.set(0, 0, -0.006)
    socket.add(pod)

    const emitter = addMesh(
      pod,
      // 58 % of the slot's span, a third of its height, set behind the mouth of the bore.
      // The dark part of a socket is not decoration: it is the reason the luminous part
      // reads as an instrument rather than an LED stuck onto a face.
      plateGeometry(chamferedRect(SLOT.width * 0.58, SLOT.height * 0.3, 0.001), { depth: 0.0026, bevel: 0.0007 }),
      emissive.eye,
      [0, 0, 0.0012],
      undefined,
      `skull.emitter.${key}`,
    )
    emitters[key] = emitter
    // A harder inner core: one bright line inside a wider glow gives the sensor a
    // focus point, which is what "narrow intelligent eyes" needs and what a plain
    // glowing rectangle does not.
    addMesh(
      pod,
      slab(quality, SLOT.width * 0.44, 0.0016, 0.0018, 0.0006),
      emissive.eye,
      [0, 0, 0.0044],
      undefined,
      `skull.core.${key}`,
    )
    // Lens: dark, hard-coated, sitting in front of the aperture so the key light has
    // something to draw across the eye. It is never additive and never emissive.
    const glass = addMesh(
      pod,
      // Smaller than the opening, not larger than it. Cover glass that overlaps the rim is a
      // second object in front of the sensor, and it catches the key along its own perimeter.
      slab(quality, SLOT.width - 0.004, SLOT.height - 0.0016, 0.001, 0.0016),
      materials.lens,
      // 2.6 mm into the bore mouth instead of 6.2 mm proud of it: the glass sits *inside* the
      // housing it protects. Anything standing proud of the face reads as its own bright
      // plate — which is how a 16 %-transparent cover ended up looking like a grey bar.
      [0, 0.0004, 0.0026],
      undefined,
      `skull.lens.${key}`,
    )
    glass.renderOrder = 2

    // Shutters: two plates in the aperture plane that slide toward each other.
    for (const half of [-1, 1] as const) {
      const shutterWidth = SLOT.width * 0.42
      const shutter = addMesh(
        socket,
        slab(quality, shutterWidth, SLOT.height * 0.58, 0.0022, 0.0012),
        // `matte`, not `plate`: these are lids inside a machined slot, and the previous
        // bright shutters parked beside the apertures read as two grey blocks competing
        // with the optics — the band stopped being one instrument. Dark also makes the
        // blink correct, because a closing lid must remove light, not add a highlight.
        materials.matte,
        // Parked fully clear of the window: half the aperture plus half the lid. At
        // `slit` 0 they do not cover a pixel of the emitter, which is the whole point.
        [half * (SLOT.width * 0.5 + shutterWidth * 0.5 + 0.0016), 0, 0.0034],
        undefined,
        `skull.shutter.${key}.${half < 0 ? 'outer' : 'inner'}`,
      )
      shutter.userData.half = half
      shutter.userData.travel = SLOT.width * 0.5 + shutterWidth * 0.5 - 0.0012
      shutter.userData.width = shutterWidth
      shutters[key].push(shutter)
    }

    if (quality !== 'low') {
      // Track the pod rides in — visible hardware, and the reason the travel reads as
      // bounded rather than floating.
      addMesh(
        socket,
        new THREE.BoxGeometry(SLOT.width + 0.002, 0.0014, 0.0014),
        materials.plate,
        [0, -SLOT.height / 2 - 0.0002, -0.0015],
      )
      for (let i = 0; i < 2; i++) {
        addMesh(socket, new THREE.BoxGeometry(0.0016, 0.0012, 0.0024), materials.plate, [side * (-0.006 + i * 0.012), SLOT.height / 2 + 0.0044, 0.0008])
      }
    }
  }

  // The inner two segments. Same emissive materials, so the state drives all four together
  // — which is the point: one band, one expression. No shutters here, because these are
  // fixed ducts, not sensors, and the drive code that moves the outer housings must not have
  // anything to grab onto in the middle of the face.
  if (quality !== 'low') {
    for (const side of [-1, 1] as const) {
      addMesh(
        skull,
        plateGeometry(chamferedRect(0.0155, 0.0058, 0.0011), { depth: 0.0022, bevel: 0.0006 }),
        emissive.eye,
        [side * 0.0128, 0.0125, 0.0888],
        undefined,
        `visor.duct.${side < 0 ? 'left' : 'right'}`,
      )
      addMesh(
        skull,
        plateGeometry(chamferedRect(0.0088, 0.0016, 0.0005), { depth: 0.0016, bevel: 0.0004 }),
        emissive.eyeCore,
        [side * 0.0128, 0.0125, 0.0902],
        undefined,
        undefined,
      )
    }
  }

  /* ---------------- mid-face ---------------- */
  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right'
    // Zygomatic plate: the widest point of the loft gets an armour plate over it,
    // which is where the cheekbone read comes from.
    addMesh(
      skull,
      plateGeometry(trapezoid(0.054, 0.032, 0.052, 0.005), { depth: 0.012, bevel: 0.0012, backInset: 0.18 }),
      materials.plate,
      [side * 0.0685, -0.0205, 0.0515],
      [0.2, side * 0.6, side * -0.3],
      `skull.plate.cheek.${key}`,
    )
    // A tight matte gutter beneath the plate. The hollow is what makes a cheek plane
    // *sharp* — an armour plate that meets the next plate flush has no shadow line, and
    // without shadow lines a faceted head reads as one smooth surface.
    addMesh(
      skull,
      plateGeometry(trapezoid(0.046, 0.03, 0.008, 0.0016), { depth: 0.006, bevel: 0.0006 }),
      materials.matte,
      [side * 0.063, -0.0455, 0.0495],
      [0.34, side * 0.5, side * -0.34],
      `skull.plate.cheek.gutter.${key}`,
    )
    // Three machined lamellae per temple, stepping down and back. The side structures of
    // a head are where "integrated" versus "bolted on" is decided: a single disc reads
    // as an ear cup, a graded stack reads as the edge of the housing itself.
    for (let i = 0; i < 3; i++) {
      addMesh(
        skull,
        plateGeometry(trapezoid(0.03 - i * 0.004, 0.023 - i * 0.003, 0.044 - i * 0.006, 0.0034), {
          depth: 0.009 - i * 0.0015,
          bevel: 0.0014,
          backInset: 0.2,
        }),
        i === 1 ? materials.titanium : materials.shell,
        [side * (0.083 + i * 0.0016), 0.0445 - i * 0.019, 0.006 - i * 0.0075],
        [0, side * 1.06, side * -0.06],
        i === 0 ? `skull.plate.temple.${key}` : undefined,
      )
    }
    // Mastoid vanes: they rotate toward the pointer further than the head does, which
    // is the entity's version of turning an ear toward you.
    const vaneGroup = new THREE.Group()
    name(vaneGroup, `skull.vane.${key}`)
    vaneGroup.position.set(side * 0.0865, 0.004, -0.03)
    vaneGroup.rotation.set(0, 0, side * 0.16)
    skull.add(vaneGroup)
    const vaneCount = quality === 'high' ? 3 : 2
    for (let i = 0; i < vaneCount; i++) {
      const disc = addMesh(
        vaneGroup,
        new THREE.CylinderGeometry(0.0125 - i * 0.002, 0.0142 - i * 0.002, 0.0038, segments(quality, 10, 8, 6)),
        i === 1 ? materials.titanium : materials.plate,
        [0, 0, -0.0036 * i],
        [0, 0, Math.PI / 2],
      )
      disc.userData.index = i
    }
    if (quality === 'high') {
      addMesh(vaneGroup, new THREE.TorusGeometry(0.0068, 0.0011, 3, 10), materials.trim, [0, 0, 0.0052], [0, Math.PI / 2, 0])
    }
  }

  // Central facial architecture: a machined key ridge from brow to chin with the
  // intake at its base. There is no nose because there is no reason for one — the
  // midline is structure, and the vents either side of it are the function.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.014, 0.011, 0.036, 0.0022), { depth: 0.008, bevel: 0.0014, backInset: 0.05 }),
    materials.plate,
    [0, 0.001, 0.0935],
    [0.05, 0, 0],
    'skull.spine',
  )
  addMesh(
    skull,
    plateGeometry(trapezoid(0.042, 0.03, 0.011, 0.0022), { depth: 0.005, bevel: 0.0012 }),
    materials.matte,
    [0, -0.0185, 0.0912],
    undefined,
    'skull.intake',
  )
  for (let i = 0; i < 3; i++) {
    addMesh(
      skull,
      new THREE.BoxGeometry(0.036 - i * 0.006, 0.0009, 0.0014),
      materials.plate,
      [0, -0.0135 - i * 0.0032, 0.0952],
      [0.06, 0, 0],
    )
  }
  if (quality !== 'low') {
    // Louvres down the ascending ramus: the segmentation the brief asks a jaw to have,
    // and the thing that stops the lower face reading as one unbroken shield.
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        addMesh(
          skull,
          new THREE.BoxGeometry(0.016, 0.0018, 0.0026),
          materials.matte,
          [side * (0.0345 + i * 0.0022), -0.032 - i * 0.0062, 0.0855 - i * 0.0022],
          [0.1, side * 0.3, side * 0.16],
        )
      }
    }
  }
  if (quality !== 'low') {
    for (const side of [-1, 1] as const) {
      // Sub-orbital heat exchangers: three slats under each socket, angled with the
      // cheek plate, so the mid-face has scale-appropriate detail at hero distance.
      for (let i = 0; i < 3; i++) {
        addMesh(
          skull,
          new THREE.BoxGeometry(0.014, 0.0019, 0.0024),
          materials.matte,
          [side * (0.0365 + i * 0.0032), -0.0255 - i * 0.0048, 0.0955 - i * 0.0014],
          [0.06, side * 0.4, side * 0.22],
        )
      }
    }
  }

  /* ---------------- jaw ---------------- */
  const jaw = new THREE.Group()
  name(jaw, 'jaw.hinge')
  // The hinge is at the condyle, back and above the chin. Placing it at the chin
  // instead is what makes a mechanical jaw look like it is dislocating.
  jaw.position.set(0, 0.008, 0.004)
  skull.add(jaw)
  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right'
    addMesh(
      jaw,
      plateGeometry(trapezoid(0.046, 0.03, 0.046, 0.0044), { depth: 0.011, bevel: 0.0014, backInset: 0.18 }),
      materials.plate,
      [side * 0.05, -0.042, 0.0245],
      [0.2, side * 0.46, side * 0.22],
      `jaw.plate.${key}`,
    )
    if (quality !== 'low') {
      addMesh(
        jaw,
        new THREE.CylinderGeometry(0.0054, 0.0054, 0.011, 8),
        materials.plate,
        [side * 0.0685, -0.0205, -0.004],
        [0, 0, Math.PI / 2],
        `jaw.pivot.${key}`,
      )
    }
  }
  addMesh(
    jaw,
    plateGeometry(trapezoid(0.034, 0.016, 0.026, 0.0034), { depth: 0.013, bevel: 0.0012, backInset: 0.2 }),
    // A *point*, not a shelf: 34 mm across at the top narrowing to 16 mm at the bottom is what
    // makes the chin silhouette read as designed rather than as the end of a tube. `plate`,
    // not `shell`, because a glossy chin catches the key as one broad highlight.
    materials.plate,
    [0, -0.0655, 0.0585],
    [0.22, 0, 0],
    'jaw.chin',
  )
  // Two side segments under the chin, each with a matte gap between it and the centre:
  // a single chin shield is one shape, three plates are a mechanism. They ride `jaw`, so
  // speech opens the whole mandible, not just a floating bottom lip.
  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right'
    addMesh(
      jaw,
      plateGeometry(trapezoid(0.028, 0.022, 0.022, 0.0034), { depth: 0.009, bevel: 0.001, backInset: 0.18 }),
      materials.plate,
      [side * 0.0325, -0.0555, 0.0525],
      [0.2, side * 0.3, side * -0.1],
      `jaw.plate.segment.${key}`,
    )
    addMesh(
      jaw,
      plateGeometry(trapezoid(0.0075, 0.006, 0.02, 0.0016), { depth: 0.004, bevel: 0.0006 }),
      materials.matte,
      [side * 0.0175, -0.0545, 0.0615],
      [0.2, side * 0.24, 0],
      undefined,
    )
  }
  // One bright edge on the mandible so the segmented jaw has a line to be read by, at the
  // bottom of the face where no highlight can be mistaken for a lip.
  addMesh(
    jaw,
    plateGeometry(trapezoid(0.026, 0.02, 0.002, 0.0005), { depth: 0.0028, bevel: 0.0005 }),
    materials.titanium,
    [0, -0.0745, 0.0565],
    [0.24, 0, 0],
    'jaw.edge',
  )
  // The separation line. Two plates meeting flush read as one shape; a 1.6 mm matte gap
  // between the maxilla plate and the mandible is what makes the lower face a *part that
  // moves* — the difference between a jaw and a chin.
  addMesh(
    skull,
    plateGeometry(trapezoid(0.062, 0.05, 0.0034, 0.001), { depth: 0.004, bevel: 0.0006 }),
    materials.matte,
    [0, -0.0565, 0.0845],
    [0.12, 0, 0],
    'skull.faceline',
  )
  // The mouth: a grille over a heat-exchanger cavity, opening on the jaw. It lights
  // with measured speech energy — there are no lips here and nothing pretends there
  // are.
  addMesh(
    jaw,
    plateGeometry(trapezoid(0.05, 0.042, 0.0092, 0.0022), { depth: 0.006, bevel: 0.001 }),
    materials.matte,
    [0, -0.0425, 0.0685],
    [0.12, 0, 0],
    'jaw.grille',
  )
  const grilleCount = quality === 'low' ? 3 : 5
  for (let i = 0; i < grilleCount; i++) {
    const t = i / (grilleCount - 1)
    addMesh(
      jaw,
      new THREE.BoxGeometry(0.0022, 0.0086, 0.0024),
      materials.plate,
      [-0.02 + t * 0.04, -0.0425, 0.0712],
      [0.12, 0, 0],
    )
  }

  /* ---------------- identification marks ---------------- */
  // Three asymmetric details, and only three. A bust that is perfectly symmetric on every
  // axis looks machine-made in the bad sense — CAD-default — while a single encoder ridge
  // on one temple, a spare heat-sink slat on one mastoid and a scored line on one pauldron
  // look like a machine that was *built*, and they are the parts a viewer can remember.
  if (quality !== 'low') {
    for (let i = 0; i < 3; i++) {
      addMesh(
        skull,
        plateGeometry(trapezoid(0.01, 0.008, 0.0055, 0.0014), { depth: 0.0032, bevel: 0.0006 }),
        i === 1 ? materials.titanium : materials.plate,
        [-0.0925 - i * 0.0012, 0.0155 + i * 0.0088, -0.006 - i * 0.003],
        [0, -1.02, 0.1],
        i === 0 ? 'skull.encoder.left' : undefined,
      )
    }
    addMesh(
      skull,
      plateGeometry(trapezoid(0.014, 0.011, 0.006, 0.0016), { depth: 0.004, bevel: 0.0008 }),
      materials.titanium,
      [0.0935, -0.0115, -0.026],
      [0, 1.06, -0.22],
      'skull.heatsink.right',
    )
  }

  // Gonial corners: the jaw's *angle*, which a loft alone cannot give you because the loft's
  // lower band is a smooth taper. Two bevelled wedges that overlap the jaw plates from
  // outside, with a matte gap under each, are what produce the silhouette line from ear to
  // chin — "mechanical cheek/jaw structures" and "defined chin" are the same feature seen
  // from two different angles.
  if (quality !== 'low') {
    for (const side of [-1, 1] as const) {
      const key = side < 0 ? 'left' : 'right'
      addMesh(
        skull,
        plateGeometry(trapezoid(0.03, 0.022, 0.052, 0.0062), { depth: 0.0125, bevel: 0.0012, backInset: 0.26 }),
        materials.shell,
        [side * 0.0655, -0.0495, 0.0225],
        [0.26, side * 0.62, side * -0.42],
        `jaw.gonial.${key}`,
      )
      addMesh(
        skull,
        plateGeometry(trapezoid(0.026, 0.02, 0.008, 0.0018), { depth: 0.005, bevel: 0.0007 }),
        materials.matte,
        [side * 0.0625, -0.0725, 0.0205],
        [0.3, side * 0.5, side * -0.5],
        undefined,
      )
    }
  }

  /* ---------------- neck ---------------- */
  const neckRings: THREE.Mesh[] = []
  const ringCount = quality === 'high' ? 4 : 3
  // Central structural column, then a bearing stack around it. The column is *fluted*:
  // six machined ribs, so the part that would otherwise be a pipe reads as an actuator
  // that can rotate, and the ribs are what catch the key light as vertical lines.
  addMesh(
    neckGroup,
    new THREE.CylinderGeometry(0.031, 0.0365, 0.064, segments(quality, 14, 10, 8)),
    materials.plate,
    [0, -0.096, 0.002],
    undefined,
    'neck.column',
  )
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    addMesh(
      neckGroup,
      new THREE.BoxGeometry(0.005, 0.052, 0.006),
      i % 2 === 0 ? materials.titanium : materials.carbon,
      [Math.cos(a) * 0.0335, -0.096, Math.sin(a) * 0.0335 + 0.002],
      [0, -a, 0],
      undefined,
    )
  }
  // The rings: tighter near the atlas, alternating in radius, and the two lowest are
  // collar bearings rather than rings. Evenly spaced identical tori was what made this
  // read as a spring, and a spring is a toy.
  for (let i = 0; i < ringCount; i++) {
    const ring = addMesh(
      neckGroup,
      new THREE.TorusGeometry(0.0375 - i * 0.0006, i % 2 === 0 ? 0.0042 : 0.0052, 4, segments(quality, 14, 10, 7)),
      i % 2 === 0 ? materials.plate : materials.carbon,
      [0, -0.0785 - (i * 0.0148 + i * i * 0.0012), 0.003],
      [Math.PI / 2, 0, 0],
      `neck.ring.${i}`,
    )
    ring.scale.set(1.18, 1.04, 1)
    ring.userData.baseY = ring.position.y
    neckRings.push(ring)
  }
  if (quality !== 'low') {
    // Encoder ticks around the top ring only: a repeated radial detail that exists on the
    // real machine because the ring has to be *driven*, and reads at hero size as
    // something that turns.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      addMesh(
        neckGroup,
        new THREE.BoxGeometry(0.0022, 0.0038, 0.0022),
        materials.titanium,
        [Math.cos(a) * 0.0455, -0.0785, Math.sin(a) * 0.0425 + 0.003],
        [0, -a, 0],
        undefined,
      )
    }
    for (const y of [-0.1295, -0.1465]) {
      addMesh(
        neckGroup,
        new THREE.CylinderGeometry(0.0435, 0.0435, 0.0075, segments(quality, 12, 10, 8)),
        y === -0.1295 ? materials.titanium : materials.plate,
        [0, y, 0.002],
        undefined,
        undefined,
      )
    }
    // Front conduits: two channels that run up the column and into the skull base. The
    // emissive strip inside each one is driven by the state, so the neck carries the same
    // "energy moves here" signal as the chest instead of being dead structure.
    for (const side of [-1, 1] as const) {
      addMesh(
        neckGroup,
        plateGeometry(chamferedRect(0.0072, 0.052, 0.0016), { depth: 0.005, bevel: 0.0008 }),
        materials.plate,
        [side * 0.026, -0.098, 0.0335],
        [0.1, side * 0.1, side * 0.06],
        `neck.conduit.${side < 0 ? 'left' : 'right'}`,
      )
      addMesh(
        neckGroup,
        plateGeometry(chamferedRect(0.0026, 0.044, 0.0008), { depth: 0.0022, bevel: 0.0004 }),
        emissive.channel,
        [side * 0.026, -0.098, 0.0368],
        [0.1, side * 0.1, side * 0.06],
        undefined,
      )
    }
  }
  // Cables behind the neck: two tubes, and they are the head's own energy feed, so
  // they carry flow in the same pattern as the chest channels.
  const channelPaths: THREE.CatmullRomCurve3[] = []
  for (const side of [-1, 1] as const) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.042, -0.03, -0.078),
      new THREE.Vector3(side * 0.05, -0.062, -0.055),
      new THREE.Vector3(side * 0.038, -0.1, -0.036),
      new THREE.Vector3(side * 0.05, -0.14, -0.02),
      new THREE.Vector3(side * 0.058, -0.168, 0.028),
    ])
    channelPaths.push(curve)
    addMesh(
      neckGroup,
      new THREE.TubeGeometry(curve, quality === 'low' ? 6 : 12, 0.0055, 5, false),
      materials.carbon,
      [0, 0.004, 0],
      undefined,
      `neck.cable.${side < 0 ? 'left' : 'right'}`,
    )
  }

  // Collar yoke: two plates that rise from the top of the chest and wrap the neck's lower
  // bearing, plus a trapezius ridge that ties them into the shoulders. This is what makes the
  // head look *carried* by the chassis — before it the skull sat on a floating spring, and no
  // amount of neck detail could fix that, because the connection to the torso is the thing
  // that sells the movement. The yoke is a child of the torso (not the head), so it stays put
  // while the head turns inside it.
  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right'
    addMesh(
      torso,
      plateGeometry(trapezoid(0.062, 0.05, 0.03, 0.0068), { depth: 0.0125, bevel: 0.0016, backInset: 0.22 }),
      materials.shell,
      [side * 0.058, -0.0985, -0.014],
      [0.24, side * -0.42, side * -0.26],
      `neck.yoke.${key}`,
    )
    if (quality === 'low') continue
    addMesh(
      torso,
      plateGeometry(trapezoid(0.05, 0.036, 0.024, 0.005), { depth: 0.01, bevel: 0.0014, backInset: 0.24 }),
      materials.plate,
      [side * 0.098, -0.1085, 0.012],
      [0.1, side * -0.3, side * -0.5],
      `neck.trapezius.${key}`,
    )
  }
  addMesh(
    torso,
    new THREE.TorusGeometry(0.047, 0.0042, 4, segments(quality, 14, 10, 5)),
    materials.titanium,
    [0, -0.118, 0.002],
    [Math.PI / 2, 0, 0],
    'neck.collar',
  )

  /* ---------------- torso ---------------- */
  // The bust is a lofted shell, so the top of the shoulders is a real surface and
  // not three boxes meeting at a seam.
  // Explicit sections rather than a sine: the widest point has to sit on the
  // deltoid line (about 70 mm below the neck opening) or the bust becomes a traffic
  // cone, which is the single most common failure of a procedural torso.
  const bustSections: [number, number][] = [
    [0.0525, -0.12],
    [0.1, -0.139],
    [0.152, -0.166],
    [0.1785, -0.196],
    [0.183, -0.224],
    [0.1765, -0.263],
    [0.169, -0.305],
  ]
  const bustProfile = bustSections.map(([w, y]) => new THREE.Vector2(w, y))
  const chest = addMesh(
    torso,
    new THREE.LatheGeometry(bustProfile, segments(quality, 24, 18, 12)),
    materials.shell,
    [0, 0, 0],
    undefined,
    'torso.chest',
  )
  // 0.62 front-to-back against a 1.0 span. A lathe is circular in section, and a
  // human bust is roughly 1 : 0.55 — without this squash the entity looks inflated.
  chest.scale.set(1, 1, 0.62)

  // Sternum plate over the core, with a bevelled frame around the reactor socket.
  addMesh(
    torso,
    plateGeometry(trapezoid(0.104, 0.128, 0.128, 0.014), { depth: 0.02, bevel: 0.004, backInset: 0.3 }),
    materials.plate,
    [0, -0.19, 0.098],
    [-0.05, 0, 0],
    'torso.sternum',
  )
  addMesh(
    torso,
    new THREE.TorusGeometry(0.043, 0.005, 5, segments(quality, 6, 6, 6)),
    materials.trim,
    [0, -0.188, 0.112],
    [0, 0, Math.PI / 6],
    'core.housing.rim',
  )

  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right'
    addMesh(
      torso,
      plateGeometry(trapezoid(0.104, 0.082, 0.03, 0.007), { depth: 0.012, bevel: 0.0022, backInset: 0.14 }),
      materials.plate,
      [side * 0.088, -0.146, 0.068],
      [0.1, side * -0.14, side * -0.14],
      `torso.plate.clavicle.${key}`,
    )
    // Two level tiers, wide and shallow. Three things changed here from the first version
    // and all three matter: the span is wider than the head so the bust reads as a
    // platform, the tilt is nearly zero because a strongly angled pauldron is armour for a
    // *humanoid* shoulder while a level slab is the corner of a chassis, and the top faces
    // are flat enough to catch the key as a single clean plane.
    // Three articulating tiers, each a shallow dished plate that steps down and inboard, and
    // each rotated a few degrees more than the one above it. That stack-with-rotation is what
    // "articulated" means geometrically: the tiers can move relative to one another, so the
    // shoulder reads as a joint assembly rather than a slab. Span is deliberately compact
    // (the previous two wide slabs read as bulk, and bulk is the toy signature) and the top
    // faces stay near-level so the light rakes across them as one clean plane.
    const layers = quality === 'low' ? 2 : 3
    for (let i = 0; i < layers; i++) {
      addMesh(
        torso,
        plateGeometry(trapezoid(0.104 - i * 0.019, 0.094 - i * 0.018, 0.05 - i * 0.006, 0.0075), {
          depth: 0.0115 - i * 0.0015,
          bevel: 0.0014,
          backInset: 0.28,
        }),
        i === 1 ? materials.shell : materials.plate,
        [side * (0.1635 + i * 0.0135), -0.1455 - i * 0.0215, 0.0085 - i * 0.0075],
        [0.045 - i * 0.03, side * -0.075, side * (0.115 - i * 0.085)],
        `shoulder.pauldron.${key}${i > 0 ? `.layer${i}` : ''}`,
      )
      // Matte gap under every tier after the first. Without a dark line between plates an
      // overlapping stack photographs as one thick object.
      if (i > 0 && quality !== 'low') {
        addMesh(
          torso,
          plateGeometry(trapezoid(0.078 - i * 0.014, 0.07 - i * 0.014, 0.0042, 0.0012), { depth: 0.003, bevel: 0.0006 }),
          materials.matte,
          [side * (0.1615 + i * 0.0125), -0.1365 - i * 0.0205, 0.0065 - i * 0.006],
          [0.045 - i * 0.03, side * -0.075, side * (0.115 - i * 0.085)],
          undefined,
        )
      }
    }
    // Tie-in: the tier is welded into the clavicle plate. Without this the pauldron is a
    // separate object next to the chest, which is what an *arm* looks like.
    addMesh(
      torso,
      plateGeometry(trapezoid(0.072, 0.058, 0.026, 0.005), { depth: 0.011, bevel: 0.0012, backInset: 0.34 }),
      materials.plate,
      [side * 0.126, -0.1335, 0.026],
      [0.06, side * -0.22, side * -0.06],
      `shoulder.tie.${key}`,
    )
    // The pivot is inboard, vertical and dark: it is a bearing the chassis turns on, not a
    // deltoid. Bright titanium here was the main reason the previous silhouette read as a
    // figure with its arms cut off.
    // The joint, shown rather than hidden: a boss with a machined collar and a hex cap, on
    // the axis the tiers turn about. "Visible mechanical joints" is the brief's phrase, and
    // a bolted boss is the cheapest honest way to say *this part rotates*.
    addMesh(
      torso,
      new THREE.CylinderGeometry(0.0175, 0.0195, 0.034, segments(quality, 12, 10, 6)),
      materials.plate,
      [side * 0.1875, -0.186, -0.004],
      [0, 0, side * 0.05],
      `shoulder.actuator.${key}`,
    )
    if (quality !== 'low') {
      addMesh(
        torso,
        new THREE.CylinderGeometry(0.0205, 0.0205, 0.0045, segments(quality, 12, 10, 6)),
        materials.titanium,
        [side * 0.2045, -0.1862, -0.0044],
        [0, 0, side * 0.05],
        `shoulder.boss.${key}`,
      )
      addMesh(
        torso,
        new THREE.CylinderGeometry(0.0072, 0.0072, 0.0058, 6),
        materials.plate,
        [side * 0.2095, -0.1863, -0.0046],
        [0, Math.PI / 2, Math.PI / 2],
        `shoulder.boss.cap.${key}`,
      )
      // Two short cables from the collar to the back of the boss — the shoulder's own feed,
      // and the only "subtle cables" this chassis needs.
      for (let c = 0; c < 2; c++) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.062, -0.108 - c * 0.016, -0.052 + c * 0.012),
          new THREE.Vector3(side * 0.112, -0.134 - c * 0.014, -0.078 + c * 0.01),
          new THREE.Vector3(side * 0.163, -0.168 - c * 0.01, -0.058 + c * 0.016),
          new THREE.Vector3(side * 0.183, -0.184 + c * 0.004, -0.02),
        ])
        addMesh(
          torso,
          new THREE.TubeGeometry(curve, segments(quality, 10, 8, 6), 0.0034 - c * 0.0006, 5, false),
          c === 0 ? materials.carbon : materials.plate,
          [0, 0, 0],
          undefined,
          `shoulder.cable.${key}.${c}`,
        )
      }
    }
    if (key === 'left' && quality !== 'low') {
      // A single scored line on one pauldron: one bright hairline across a dark slab, and
      // the silhouette stops being mirror-perfect at the widest point of the bust.
      addMesh(
        torso,
        plateGeometry(trapezoid(0.062, 0.056, 0.0022, 0.0006), { depth: 0.0022, bevel: 0.0004 }),
        materials.trim,
        [side * 0.196, -0.1415, 0.0125],
        [0.05, side * -0.05, -0.34],
        'shoulder.score.left',
      )
    }
    if (quality === 'high') {
      addMesh(
        torso,
        plateGeometry(trapezoid(0.07, 0.05, 0.06, 0.01), { depth: 0.012, bevel: 0.0024, backInset: 0.24 }),
        materials.plate,
        [side * 0.148, -0.212, -0.1],
        [-0.16, side * 0.36, side * -0.2],
        `torso.plate.scapula.${key}`,
      )
      for (let i = 0; i < 3; i++) {
        addMesh(
          torso,
          plateGeometry(trapezoid(0.05, 0.042, 0.012, 0.003), { depth: 0.008, bevel: 0.0016, backInset: 0.2 }),
          materials.plate,
          [side * (0.086 + i * 0.004), -0.226 - i * 0.016, 0.096 - i * 0.008],
          [0.18 + i * 0.05, side * -0.18, side * -0.32],
          `torso.plate.rib.${key}.${i}`,
        )
      }
    }
  }

  const CHEST_FLATTEN = 0.62
  const CHEST_TOP = bustSections[0][1]
  const CHEST_BOTTOM = bustSections[bustSections.length - 1][1]
  /**
   * The lathe's own profile, sampled. The bust is narrower below the deltoid line than
   * at it, so a channel computed from one fixed radius walks off the silhouette near
   * the bottom of the crop. `bustSections` is the same data the shell was built from,
   * which is what makes the glow follow the surface it is welded to at every height.
   */
  const radiusAt = (y: number) => {
    if (y >= CHEST_TOP) return bustSections[0][0]
    if (y <= CHEST_BOTTOM) return bustSections[bustSections.length - 1][0]
    for (let i = 0; i < bustSections.length - 1; i++) {
      const [r0, y0] = bustSections[i]
      const [r1, y1] = bustSections[i + 1]
      if (y <= y0 && y >= y1) {
        const t = (y0 - y) / Math.max(y0 - y1, 1e-6)
        return r0 + (r1 - r0) * t
      }
    }
    return bustSections[0][0]
  }
  const chestSurfaceZ = (x: number, y: number) => {
    const r = Math.max(radiusAt(y), 1e-4)
    const inside = Math.max(0.02, 1 - (x / r) ** 2)
    return r * CHEST_FLATTEN * Math.sqrt(inside)
  }
  /* ---------------- the core ---------------- */
  const coreGroup = new THREE.Group()
  name(coreGroup, 'core')
  coreGroup.position.set(0, -0.188, 0.094)
  torso.add(coreGroup)

  // A hexagonal socket, not a circle: six flat faces give the housing edges to catch
  // the key light, and the recess puts the emitter *inside* the chest.
  addMesh(
    coreGroup,
    // 34 mm deep, 6 mm narrower: the recess is the object, and the emission is something you
    // find inside it. A shallow socket with a bright ring is a lamp; a bore this deep is a
    // component installed in a structure.
    new THREE.CylinderGeometry(0.0315, 0.026, 0.034, 6, 1, true),
    materials.matte,
    [0, 0, -0.0015],
    [Math.PI / 2, 0, 0],
    'core.housing',
  )
  addMesh(coreGroup, new THREE.CircleGeometry(0.031, 6), materials.matte, [0, 0, -0.012], [0, Math.PI / 6, 0])
  const emitter = addMesh(
    coreGroup,
    // 21 mm across, set 3.5 mm inside the bore. The brief is explicit that this is not a
    // big glowing circle on the chest, and the first version was exactly that: a 4 cm cyan
    // disc that dominated a 45 cm bust. The *housing* is the object — hex socket, petals,
    // gimbals — and the emission is a detail found inside it.
    // A flat hexagonal die, not a sphere. A round emissive solid is the shape of an arc
    // reactor; a faceted slab set deep in a recess is the shape of a processor, and the
    // six faces give the key light something to describe.
    // 16 mm across, 5 mm inside the bore. "Small enough to feel powerful" is a literal
    // instruction: the first version of this chest had a 40 mm glowing disc, which is a logo,
    // not a core. Six flat faces so the little light it throws has edges.
    new THREE.CylinderGeometry(0.0082, 0.0094, 0.0045, 6),
    emissive.core,
    [0, 0, -0.0058],
    undefined,
    'core.emitter',
  )
  // Three bars across the mouth of the socket, which is what stops the recess reading as a
  // round lamp, and the only thing in the chest that casts a real shadow into it.
  const louvreCount = quality === 'low' ? 2 : 3
  for (let i = 0; i < louvreCount; i++) {
    addMesh(
      coreGroup,
      new THREE.BoxGeometry(0.058, 0.0026, 0.0022),
      materials.plate,
      [0, -0.013 + (i * 0.026) / Math.max(louvreCount - 1, 1), 0.0128],
      [0, 0, Math.PI / 12],
      i === 0 ? 'core.louvre' : undefined,
    )
  }
  const gimbals: THREE.Mesh[] = []
  const gimbalCount = quality === 'low' ? 1 : 2
  for (let i = 0; i < gimbalCount; i++) {
    // Retaining rings, hexagonal and in `plate`. Rings around a lit disc is the literal
    // drawing of an arc reactor; a hex cage around a recessed die is a package. The one
    // metallic ring is the inside edge, where it catches a line of light rather than a face.
    const gimbal = addMesh(
      coreGroup,
      new THREE.CylinderGeometry(0.0245 - i * 0.0045, 0.0245 - i * 0.0045, 0.0022 - i * 0.0004, 6, 1, true),
      i === 1 ? materials.titanium : materials.plate,
      [0, 0, 0.005 + i * 0.0042],
      [Math.PI / 2, 0, i * (Math.PI / 6)],
      `core.gimbal.${i}`,
    )
    gimbal.userData.spin = (i % 2 === 0 ? 1 : -1) * (0.6 + i * 0.35)
    gimbals.push(gimbal)
  }
  // Lattice over the die: two cross-bars in front of the emitter, so the energy has to be
  // *found* through the structure instead of being presented as a lit face. This is the
  // single change that moves the chest from reactor to processor.
  if (quality !== 'low') {
    for (let i = 0; i < 2; i++) {
      addMesh(
        coreGroup,
        new THREE.BoxGeometry(i === 0 ? 0.03 : 0.0028, i === 0 ? 0.0022 : 0.03, 0.002),
        materials.matte,
        [0, 0, 0.0042],
        undefined,
        `core.lattice.${i}`,
      )
    }
  }
  // Six petals around the socket open as the core works: real apertures, not a spin.
  const petals: THREE.Mesh[] = []
  const petalCount = 6
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2 + Math.PI / 6
    const petal = addMesh(
      coreGroup,
      // Interposer pads: `plate`, not `trim`. Six bright trapezoids around a glowing disc
      // is the ring-and-spokes drawing of a reactor; dark pads around a recessed die is
      // hardware. One thin edge stays metallic so the package has a rim light.
      plateGeometry(trapezoid(0.0155, 0.0125, 0.0095, 0.0022), { depth: 0.0045, bevel: 0.0009 }),
      materials.plate,
      [Math.cos(angle) * 0.0365, Math.sin(angle) * 0.0365, 0.01],
      [0, 0, angle - Math.PI / 2],
      i === 0 ? 'core.petal.0' : undefined,
    )
    petal.userData.angle = angle
    petals.push(petal)
  }
  // The package frame. Everything above is a socket; this is the *die edge* that the
  // socket is set into — a raised hexagonal collar, 52 mm across, so the processor reads
  // as a component installed in the chest plate rather than a lamp in a hole. Layered:
  // collar, then a 0.8 mm matte gap, then the recessed hex floor already in place.
  addMesh(
    coreGroup,
    // Thin and set *into* the chest, not proud of it: a 8.5 mm collar standing off the
    // sternum catches the key as a bright ring, and a bright ring around a lit centre is
    // the arc-reactor drawing again however hexagonal the geometry is.
    new THREE.CylinderGeometry(0.047, 0.0425, 0.0055, 6),
    materials.plate,
    [0, 0, 0.0102],
    [Math.PI / 2, 0, 0],
    'core.frame',
  )
  addMesh(
    coreGroup,
    new THREE.CylinderGeometry(0.05, 0.05, 0.0022, 6),
    materials.matte,
    [0, 0, 0.0078],
    [Math.PI / 2, 0, 0],
    'core.frame.gap',
  )
  // Via field: the little studs a package is soldered down with. Eight of them, static,
  // non-emissive, at exactly the size where they stop being detail and start being noise.
  if (quality !== 'low') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      addMesh(
        coreGroup,
        new THREE.CylinderGeometry(0.0019, 0.0019, 0.0022, 6),
        i % 3 === 0 ? materials.titanium : materials.plate,
        [Math.cos(a) * 0.041, Math.sin(a) * 0.041, 0.0165],
        [Math.PI / 2, 0, 0],
        undefined,
      )
    }
  }
  // Armour over the bore: four chevrons that point at the core from above and below, each a
  // bevelled plate with a matte gap under it. This is what makes the core *embedded* rather
  // than mounted, and it gives the chest a direction — everything on the bust converges on
  // the processor. Layered, not one giant symbol: the brief is explicit about that.
  if (quality !== 'low') {
    for (let i = 0; i < 2; i++) {
      for (const side of [-1, 1] as const) {
        addMesh(
          torso,
          plateGeometry(trapezoid(0.056 - i * 0.012, 0.04 - i * 0.01, 0.019 - i * 0.003, 0.0042), {
            depth: 0.009 - i * 0.0015,
            bevel: 0.0014,
            backInset: 0.24,
          }),
          i === 0 ? materials.shell : materials.plate,
          [side * (0.036 + i * 0.016), -0.1295 - i * 0.02, 0.0935 - i * 0.006],
          [-0.36 - i * 0.1, side * 0.26, side * (i === 0 ? 0.5 : 0.36)],
          `torso.chevron.pectoral.${side < 0 ? 'left' : 'right'}${i > 0 ? '.upper' : ''}`,
        )
        addMesh(
          torso,
          plateGeometry(trapezoid(0.05 - i * 0.012, 0.036 - i * 0.01, 0.017 - i * 0.003, 0.0038), {
            depth: 0.0085 - i * 0.0015,
            bevel: 0.0012,
            backInset: 0.24,
          }),
          i === 0 ? materials.plate : materials.shell,
          [side * (0.03 + i * 0.018), -0.244 + i * 0.021, 0.0885 - i * 0.005],
          [0.3 + i * 0.08, side * 0.24, side * (i === 0 ? -0.44 : -0.3)],
          `torso.chevron.abdominal.${side < 0 ? 'left' : 'right'}${i > 0 ? '.lower' : ''}`,
        )
      }
    }
  }
  const coreLight = new THREE.PointLight(new THREE.Color(EMISSIVE.core.color), 0.1, 0.16, 2)
  coreLight.position.set(0, 0, 0.05)
  name(coreLight, 'core.light')
  coreGroup.add(coreLight)

  /* ---------------- emissive detail, instanced ---------------- */
  const flowGeometry = keep(new THREE.BoxGeometry(0.0062, 0.0017, 0.0016))
  const ventGeometry = keep(new THREE.BoxGeometry(0.0016, 0.0072, 0.0024))
  const trimGeometry = keep(new THREE.BoxGeometry(0.013, 0.0016, 0.0016))

  // Energy channels: the two neck cables plus six chest feeds, sampled along their
  // curves. `flow` segments are what the state table's `speed` moves.
  const chestPaths: THREE.CatmullRomCurve3[] = []
  // Four feeds, fanning out and *down* from the housing. Straight-up and straight-down
  // runs stack their segments into one bright line on the centre line (a zipper), and
  // the mirrored pair across it crosses into a star. Energy leaving a reactor goes out
  // into the structure, so a downward fan is both the better read and the truer one.
  // Data traces, not rays. A reactor throws energy outward in arcs; a processor routes it
  // along the substrate in runs that turn at right angles. Each path below is built from
  // axis-aligned legs (with a short lead-in at the die corner so the bend is visible),
  // projected onto the chest surface, and the pulse the state drives then travels *along a
  // trace*, which is why the six paths replaced the four fan angles.
  const traceLegs: [number, number][][] = [
    [[-0.018, -0.166], [-0.018, -0.134], [-0.042, -0.134], [-0.042, -0.112]],
    [[0.018, -0.166], [0.018, -0.134], [0.042, -0.134], [0.042, -0.112]],
    [[-0.03, -0.204], [-0.064, -0.204], [-0.064, -0.232], [-0.094, -0.232]],
    [[0.03, -0.204], [0.064, -0.204], [0.064, -0.232], [0.094, -0.232]],
    [[-0.005, -0.224], [-0.005, -0.256], [-0.02, -0.256]],
    [[0.005, -0.224], [0.005, -0.256], [0.02, -0.256]],
  ]
  const tracePath = (legs: [number, number][]) =>
    new THREE.CatmullRomCurve3(
      legs.map(([x, y]) => new THREE.Vector3(x, y, chestSurfaceZ(x, y) + 0.0036)),
      false,
      'catmullrom',
      0.08,
    )
  if (quality === 'low') traceLegs.length = 4
  for (const legs of traceLegs) chestPaths.push(tracePath(legs))
  // The head's feed is the pair of neck cables above, and those are geometry, not glow.
  // A second pair of glowing risers on top of them put a bright blob in the throat, so
  // the cables carry the flow and nothing else is drawn there.
  const perPath = quality === 'low' ? 4 : quality === 'medium' ? 6 : 8
  const paths = [...channelPaths, ...chestPaths]
  const flowCount = paths.length * perPath
  const flow = glowGroup(flowGeometry, glow, flowCount)
  name(flow.mesh, 'channels')
  const flowMatrix = new THREE.Matrix4()
  const flowQuat = new THREE.Quaternion()
  const flowPos = new THREE.Vector3()
  const flowTangent = new THREE.Vector3()
  const flowScale = new THREE.Vector3(1, 1, 1)
  const AXIS_X_UNIT = new THREE.Vector3(1, 0, 0)
  let instanceIndex = 0
  for (let p = 0; p < paths.length; p++) {
    const curve = paths[p]
    for (let i = 0; i < perPath; i++) {
      const t = (i + 0.5) / perPath
      curve.getPointAt(t, flowPos)
      curve.getTangentAt(t, flowTangent)
      flowQuat.setFromUnitVectors(AXIS_X_UNIT, flowTangent)
      flowMatrix.compose(flowPos, flowQuat, flowScale)
      flow.mesh.setMatrixAt(instanceIndex, flowMatrix)
      // Phase carries both the path index and the position along it, so a pulse can
      // visibly travel outward from the core instead of blinking in place.
      flow.phase[instanceIndex] = t + p * 0.11
      instanceIndex++
    }
  }
  flow.mesh.instanceMatrix.needsUpdate = true
  torso.add(flow.mesh)

  // Vent slats: cheek intakes, temple slots, throat array, collar vents. Static
  // transforms, per-instance brightness, so "the machine is working" is one draw call.
  const ventSlots: Vec3[] = [
    // Nothing glows at mouth height: two intakes flanking the grille, both lit, were
    // being read as the corners of a mouth. They moved up to the temples instead.
    [-0.0845, 0.0495, 0.024],
    [0.0845, 0.0495, 0.024],
    [-0.028, -0.0885, 0.03],
    [0.028, -0.0885, 0.03],
    [0, -0.078, 0.062],
    [-0.104, -0.152, 0.03],
    [0.104, -0.152, 0.03],
    [-0.14, -0.2, 0.05],
    [0.14, -0.2, 0.05],
    [0, -0.256, 0.06],
  ]
  // Head intakes ride the head; chest and shoulder vents ride the torso. One group
  // would shear them apart the moment the head turns, so they are two parents and one
  // material.
  const headSlots = ventSlots.filter((slot) => slot[1] > -0.12)
  const bodySlots = ventSlots.filter((slot) => slot[1] <= -0.12)
  const slotsFor = (list: Vec3[], limit: number) => (quality === 'low' ? list.slice(0, limit) : list)
  const buildVents = (list: Vec3[], partName: string): GlowGroup => {
    const group = glowGroup(ventGeometry, glow, Math.max(list.length * 2, 2))
    name(group.mesh, partName)
    const matrix = new THREE.Matrix4()
    const euler = new THREE.Euler()
    for (let v = 0; v < list.length; v++) {
      for (let s = 0; s < 2; s++) {
        const slot = list[v]
        euler.set(0, 0, slot[1] > -0.12 ? 0.1 : -0.08)
        matrix.makeRotationFromEuler(euler)
        matrix.setPosition(slot[0] + (s === 0 ? -0.0048 : 0.0048), slot[1], slot[2])
        const index = v * 2 + s
        group.mesh.setMatrixAt(index, matrix)
        group.phase[index] = v * 0.17 + s * 0.06
      }
    }
    group.mesh.instanceMatrix.needsUpdate = true
    return group
  }
  const vents = buildVents(slotsFor(headSlots, 3), 'skull.vents')
  skull.add(vents.mesh)
  const ventsBody = buildVents(slotsFor(bodySlots, 3), 'torso.vents')
  torso.add(ventsBody.mesh)

  // Trim lines: the thin violet filaments in the forehead/temple architecture.
  // Trim filaments live on the *cranium*, never on the face. The two that used to sit above
  // the band were the reason the forehead read as a wiring diagram, and the brief is
  // explicit: the optical band is the one glowing element on this head, minimalism included.
  const trimSlots: Vec3[] = [
    [-0.0705, 0.0615, 0.05],
    [0.0705, 0.0615, 0.05],
    [-0.042, 0.0985, 0.036],
    [0.042, 0.0985, 0.036],
  ]
  const trimCount = quality === 'low' ? 3 : trimSlots.length
  const trim = glowGroup(trimGeometry, glow, trimCount)
  name(trim.mesh, 'skull.trim.energy')
  const trimMatrix = new THREE.Matrix4()
  for (let i = 0; i < trimCount; i++) {
    const slot = trimSlots[i]
    trimMatrix.makeRotationFromEuler(new THREE.Euler(0.2, 0, Math.abs(slot[0]) > 0.04 ? 0.5 : 0))
    trimMatrix.setPosition(slot[0], slot[1], slot[2])
    trim.mesh.setMatrixAt(i, trimMatrix)
    trim.phase[i] = i * 0.21
  }
  trim.mesh.instanceMatrix.needsUpdate = true
  skull.add(trim.mesh)

  /* ---------------- eye lights ---------------- */
  // Two real point lights, so the sensors cast onto their own housings. A glow that
  // lights nothing is a decal; this is the difference between emissive and lit.
  const eyeLights: THREE.PointLight[] = []
  if (quality !== 'low') {
    for (const side of [-1, 1] as const) {
      const light = new THREE.PointLight(new THREE.Color(EMISSIVE.eye.color), 0.16, 0.14, 2)
      light.position.set(side * 0.044, 0.008, 0.072)
      name(light, `skull.light.${side < 0 ? 'left' : 'right'}`)
      skull.add(light)
      eyeLights.push(light)
    }
  }

  /* ---------------- stats ---------------- */
  let meshes = 0
  let triangles = 0
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    meshes++
    const geometry = mesh.geometry as THREE.BufferGeometry
    const count = geometry.index ? geometry.index.count : (geometry.attributes.position as THREE.BufferAttribute)?.count ?? 0
    triangles += (count / 3) * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1)
  })

  const drive: DriveMemory = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    torsoYaw: 0,
    sensorYaw: 0,
    sensorPitch: 0,
    aperture: STATE_LOOK.IDLE.eye.aperture,
    eyeIntensity: STATE_LOOK.IDLE.eye.intensity,
    coreIntensity: STATE_LOOK.IDLE.core.intensity,
    corePhase: 0,
    jaw: 0,
    vane: 0,
    neck: 0,
    spread: 0,
    microClock: 1.4,
    microTarget: [0, 0, 0],
    microCurrent: [0, 0, 0],
    flowPhase: 0,
    scanPhase: 0,
    holdPhase: 0,
    random: mulberry32(quality === 'high' ? 0x2fa17 : quality === 'medium' ? 0x51a7 : 0x1d3f),
    lastState: 'IDLE',
    stateChangedAt: 0,
  }

  const machine: RavenMachine = {
    root,
    head,
    skull,
    jaw,
    sockets,
    sensors,
    emitters,
    shutters,
    vanes: { left: parts.get('skull.vane.left') as THREE.Group, right: parts.get('skull.vane.right') as THREE.Group },
    neck: { group: neckGroup, rings: neckRings },
    torso,
    core: { group: coreGroup, emitter, gimbals, petals, light: coreLight },
    lights: { eye: eyeLights },
    groups: { flow, vents, ventsBody, trim },
    materials,
    textures,
    geometries,
    stats: { meshes, triangles, parts: parts.size, quality },
    readout: {
      state: 'IDLE',
      lookLabel: STATE_LOOK.IDLE.label,
      eyeIntensity: 0,
      aperture: 0,
      coreRateHz: 0,
      coreIntensity: 0,
      flowSpeed: 0,
      jawOpen: 0,
      tracking: 0,
    },
    drive,
  }

  root.userData.parts = parts
  root.userData.ravenMachine = machine
  return machine
}

/** Everything created here is owned by the caller and released together. */
export function disposeRavenMachine(machine: RavenMachine): void {
  for (const geometry of machine.geometries) geometry.dispose?.()
  const all: THREE.Material[] = [machine.materials.glow, ...Object.values(machine.materials.emissive)]
  for (const key of Object.keys(SURFACES) as SurfaceId[]) all.push(machine.materials[key])
  for (const material of all) material.dispose?.()
  machine.textures?.roughnessMap.dispose?.()
  machine.textures?.normalMap.dispose?.()
  machine.root.removeFromParent()
}

/* ------------------------------------------------------------------ *
 * The drive function
 * ------------------------------------------------------------------ */

export type MachineDriveInput = {
  state: string
  /** Pointer or tracker position, in the ±8 / ±6 units `lib/ravenStore` publishes. */
  pointer: { x: number; y: number }
  speaking: boolean
  /** Measured speech energy from `lib/speechSync.ts`; 0 when nothing is speaking. */
  speechEnergy: number
  speechOpenness: number
  time: number
  dt: number
  reducedMotion: boolean
  /** False while the tab is hidden or the stage is off-screen: no motion accrues. */
  active: boolean
  externalBlink: boolean
}

type StateLookResolved = StateLook & { defaulted: boolean }

/** Unknown states fall back to IDLE rather than to a guess; the audit forbids that. */
const lookFor = (state: string): StateLookResolved => {
  const look = STATE_LOOK[state] ?? STATE_LOOK.IDLE
  return { ...look, defaulted: !STATE_LOOK[state] }
}

/** sRGB-ish luminance of an emissive colour × intensity, for the clip guard. */
export function emissiveLuminance(color: THREE.Color, intensity: number): number {
  const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return (0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b)) * intensity
}

/**
 * Applies one frame of state to the entity. Everything below is derived from
 * `STATE_LOOK[state]`, the pointer and the measured speech signal; nothing here
 * reads a timer to decide to move.
 */
export function driveRavenMachine(machine: RavenMachine, input: MachineDriveInput): void {
  const drive = machine.drive
  const look = lookFor(input.state)
  const dt = Math.max(Math.min(input.dt, 0.05), 0)
  const allowMotion = !input.reducedMotion && input.active
  const off = input.state === 'OFFLINE'

  if (input.state !== drive.lastState) {
    drive.lastState = input.state
    drive.stateChangedAt = input.time
  }
  // A state change is a mechanical event: the vanes re-seat and the head takes one
  // small correction. Once per change, not on a loop.
  const sinceChange = input.time - drive.stateChangedAt
  const settle = sinceChange < 0.42 ? 1 - sinceChange / 0.42 : 0

  /* ---- gaze: pointer awareness, encoder-quantised ---- */
  const pointerX = clamp(input.pointer.x / 8, -1, 1)
  const pointerY = clamp(input.pointer.y / 6, -1, 1)
  const track = look.track * (off ? 0 : 1)

  // `scan` is the sensor searching its own travel — the only autonomous motion here,
  // and it exists because LISTENING/VISION really are sampling states.
  drive.scanPhase += dt * (allowMotion ? 0.6 + look.eye.scan * 1.7 : 0)
  const scan = allowMotion ? Math.sin(drive.scanPhase * Math.PI * 2) * look.eye.scan : 0

  const targetYaw = (pointerX * track + scan * 0.35) * MOTION.headYaw
  const targetPitch = (pointerY * track * 0.7 + (allowMotion ? Math.sin(drive.scanPhase * Math.PI * 1.3) * 0.06 * look.eye.scan : 0)) * MOTION.headPitch
  const quantise = (value: number) => Math.round(value / MOTION.encoder) * MOTION.encoder
  const quantiseStep = (value: number, step: number) => Math.round(value / step) * step

  /* ---- servo micro-adjustment: a held position drifts and re-corrects ---- */
  drive.microClock -= dt * (look.micro > 0 ? 1 : 0)
  if (allowMotion && look.micro > 0 && drive.microClock <= 0) {
    drive.microClock = MOTION.microInterval[0] + drive.random() * (MOTION.microInterval[1] - MOTION.microInterval[0])
    const amplitude = MOTION.microAmplitude * look.micro
    drive.microTarget = [(drive.random() - 0.5) * amplitude, (drive.random() - 0.5) * amplitude * 0.8, (drive.random() - 0.5) * amplitude * 0.5]
  }
  if (!allowMotion || look.micro === 0) {
    drive.microTarget = [0, 0, 0]
  }
  for (let i = 0; i < 3; i++) {
    drive.microCurrent[i] = damp(drive.microCurrent[i], drive.microTarget[i], 3.2, dt)
  }

  drive.yaw = damp(drive.yaw, quantise(clamp(targetYaw, -MOTION.headYawLimit, MOTION.headYawLimit)), MOTION.headLag, dt)
  drive.pitch = damp(
    drive.pitch,
    quantise(clamp(targetPitch + look.posture.lean, -MOTION.headPitchLimit, MOTION.headPitchLimit)),
    MOTION.headLag,
    dt,
  )
  drive.roll = damp(drive.roll, quantise(clamp(-targetYaw * 0.22 + drive.microCurrent[2], -0.05, 0.05)), 4.5, dt)
  drive.torsoYaw = damp(drive.torsoYaw, drive.yaw * 0.34, MOTION.torsoLag, dt)
  // ---- idle "breathing": stepped, never sinusoidal ----
  // A continuous sine on the chassis is the single most reliable way to make a machine look
  // like a person in a suit, so the cycle here is generated as a continuous wave and then
  // quantised into three detents. The visible result is: hold, tick over, hold, tick back —
  // an actuator compensating, not lungs. Rate is slaved to the core pulse so the chest light
  // and the plate motion are the same event, and the damp time is short enough that the
  // transition between detents is a *move* rather than a glide.
  const breathPhase = (input.time * look.core.rate * 0.5) % 1
  const breath = allowMotion ? Math.round(Math.sin(breathPhase * Math.PI * 2) * 2) / 2 : 0
  drive.spread = damp(drive.spread, look.posture.spread + breath * 0.0075, 11, dt)
  drive.neck = damp(drive.neck, look.posture.lift + breath * 0.0011, 11, dt)

  machine.head.rotation.set(drive.pitch, drive.yaw, drive.roll)
  machine.torso.rotation.y = drive.torsoYaw * 0.5
  // Counter-lean, same detents, opposite phase: when the chassis rises it tips back a
  // fraction, which is what a two-point suspension actually does.
  machine.torso.rotation.x = breath * -0.0022
  machine.torso.position.y = drive.neck

  /* ---- sensors: they lead, the head lags, the encoder quantises both ---- */
  const sensorYawTarget = clamp((pointerX * 0.75 + scan * 0.5) * MOTION.sensorYaw, -MOTION.sensorYaw, MOTION.sensorYaw)
  const sensorPitchTarget = clamp(pointerY * 0.6 * MOTION.sensorPitch, -MOTION.sensorPitch, MOTION.sensorPitch)
  drive.sensorYaw = damp(drive.sensorYaw, quantise(sensorYawTarget), 12, dt)
  drive.sensorPitch = damp(drive.sensorPitch, quantise(sensorPitchTarget), 12, dt)
  const slide = clamp(sensorYawTarget, -MOTION.sensorYaw, MOTION.sensorYaw) / MOTION.sensorYaw
  const tilt = clamp(sensorPitchTarget, -MOTION.sensorPitch, MOTION.sensorPitch) / MOTION.sensorPitch
  for (const key of ['left', 'right'] as const) {
    const pod = machine.sensors[key]
    // The head has already turned part-way, so the pod takes the residual: a bounded
    // slide along its track plus a small tilt on its own axis. Bounded travel is the
    // whole difference between a mechanism and a pair of eyeballs.
    const residual = clamp((slide - drive.yaw / MOTION.headYawLimit * 0.55) * 0.0044, -0.0048, 0.0048)
    pod.position.x = damp(pod.position.x, quantiseStep(residual, 0.0006), 12, dt)
    pod.rotation.y = damp(pod.rotation.y, quantise(clamp(slide * 0.16, -0.16, 0.16)), 12, dt)
    pod.rotation.x = damp(pod.rotation.x, quantise(clamp(tilt * 0.1, -0.1, 0.1)), 12, dt)
  }

  /* ---- apertures and shutters ---- */
  const speech = input.speaking ? clamp(input.speechEnergy, 0, 1) : 0
  const apertureTarget = clamp(look.eye.aperture + speech * 0.08 + settle * 0.05, 0, 1)
  drive.aperture = damp(drive.aperture, apertureTarget, 7, dt)
  const apertureScale = MOTION.apertureMin + drive.aperture * (MOTION.apertureMax - MOTION.apertureMin)
  const eyeIntensity = clamp(look.eye.intensity + speech * 0.16, 0, MAX_EMISSIVE)
  drive.eyeIntensity = damp(drive.eyeIntensity, eyeIntensity, 9, dt)
  const blink = input.externalBlink ? 1 : 0

  const emissiveEye = machine.materials.emissive.eye
  emissiveEye.emissive.setHex(look.eye.color)
  emissiveEye.emissiveIntensity = clamp(drive.eyeIntensity, 0, EMISSIVE.eye.max)
  // The filament keeps a fixed ratio above the slot so the eye has a hot centre at
  // every state, including the dim ones — that contrast is what makes it look like it
  // is looking at something rather than being switched on.
  const filament = machine.materials.emissive.eyeCore
  filament.emissive.setHex(look.eye.color === MACHINE_COLORS.white ? MACHINE_COLORS.white : look.eye.color)
  filament.emissiveIntensity = clamp(drive.eyeIntensity * 1.12 + 0.06, 0, EMISSIVE.eyeCore.max)
  machine.materials.emissive.channel.emissive.setHex(look.channel.color)
  machine.materials.emissive.channel.emissiveIntensity = clamp(look.channel.intensity * 0.55, 0, EMISSIVE.channel.max)
  for (const key of ['left', 'right'] as const) {
    const emitter = machine.emitters[key]
    // Aperture on a slot is height, and a scan is a hint of width: the glow itself
    // grows and shrinks inside the bezel rather than the housing changing shape.
    emitter.scale.set(0.9 + drive.aperture * 0.1, 0.36 + apertureScale * 0.34, 1)
    // Shutters slide toward each other across the aperture. `slit` is the state's
    // lid position; `blink` is a real external blink event.
    const close = clamp(look.eye.slit + blink * (1 - look.eye.slit), 0, 1)
    machine.shutters[key].forEach((shutter) => {
      const half = shutter.userData.half as number
      const travel = (shutter.userData.travel as number) ?? 0.02
      shutter.position.x = half * (travel - close * (travel - shutter.userData.width! * 0.24))
    })
  }
  for (const light of machine.lights.eye) {
    light.color.setHex(look.eye.color)
    light.intensity = clamp(drive.eyeIntensity * 0.13, 0, 0.3)
  }

  /* ---- jaw: measured speech only ---- */
  const jawTarget = clamp(
    look.jaw + (input.speaking ? input.speechOpenness * 0.55 + speech * 0.45 : 0) * MOTION.jawMax * SPEECH.jawGain,
    0,
    MOTION.jawMax,
  )
  drive.jaw = damp(drive.jaw, jawTarget, SPEECH.lamLambda, dt)
  machine.jaw.rotation.x = drive.jaw
  // A mandible on a hinge translates as well as rotates, or the chin grows.
  machine.jaw.position.z = 0.006 - drive.jaw * 0.045

  /* ---- mastoid vanes ---- */
  drive.vane = damp(drive.vane, clamp(pointerX * MOTION.vaneGain + (off ? -0.5 : 0), -0.7, 0.7), 3.5, dt)
  for (const key of ['left', 'right'] as const) {
    const vane = machine.vanes[key]
    if (!vane) continue
    vane.children.forEach((child, index) => {
      child.rotation.x = drive.vane * (0.5 + index * 0.35) + (allowMotion ? Math.sin(input.time * 0.7 + index) * 0.02 : 0)
    })
  }

  /* ---- neck stack ---- */
  machine.neck.rings.forEach((ring, index) => {
    const base = (ring.userData.baseY as number) ?? ring.position.y
    const travel = Math.sin(input.time * 1.1 - index * 0.8) * (allowMotion ? MOTION.neckSettle * 0.5 : 0)
    ring.position.y = base + drive.neck + travel - drive.pitch * 0.004
    ring.rotation.z = (allowMotion ? drive.yaw * (0.3 + index * 0.12) : 0) + drive.microCurrent[1] * (index + 1)
  })

  /* ---- the core ---- */
  drive.corePhase += dt * (allowMotion ? look.core.rate : 0)
  const phase = drive.corePhase * Math.PI * 2
  let coreWave = 0
  switch (look.core.mode) {
    case 'standby':
      coreWave = 0.04
      break
    case 'breathe':
      coreWave = 0.5 + 0.5 * Math.sin(phase)
      break
    case 'accelerate':
      coreWave = 0.5 + 0.5 * Math.sin(phase) * (0.7 + 0.3 * Math.sin(phase * 2.3))
      break
    case 'layered':
      // Two detuned layers: the "thinking in parallel" read, and it is still just a
      // sum of two sines at the state's own rate, not random flicker.
      coreWave = 0.42 + 0.3 * Math.sin(phase) + 0.28 * Math.sin(phase * 1.618 + 1.1)
      break
    case 'drive':
      coreWave = 0.5 + 0.5 * Math.pow(Math.abs(Math.sin(phase)), 0.5)
      break
    case 'focus':
      coreWave = 0.86 + 0.04 * Math.sin(phase * 0.5)
      break
    case 'alert':
      coreWave = 0.55 + 0.45 * Math.sin(phase * 1.4)
      break
    case 'alarm':
      // A two-beat alarm, then a hold: mechanical, and the only state allowed to
      // demand attention.
      coreWave = Math.max(0, Math.sin(phase * 0.85)) ** 3
      break
  }
  coreWave *= input.speaking ? 0.85 + 0.15 * (0.5 + speech) : 1
  drive.coreIntensity = damp(drive.coreIntensity, clamp(look.core.intensity * (0.55 + 0.45 * coreWave), 0, EMISSIVE.core.max), MOTION.coreLag, dt)
  const coreMaterial = machine.materials.emissive.core
  coreMaterial.emissive.setHex(look.core.color)
  coreMaterial.emissiveIntensity = drive.coreIntensity
  machine.core.emitter.scale.setScalar(0.86 + 0.2 * coreWave + speech * 0.05)
  machine.core.emitter.rotation.z = allowMotion ? input.time * 0.16 : 0
  machine.core.gimbals.forEach((gimbal) => {
    const spin = (gimbal.userData.spin as number) ?? 1
    gimbal.rotation.z += spin * dt * (allowMotion ? 0.25 + look.core.rate * 0.5 : 0)
    gimbal.rotation.x = 0.4 + Math.sin(phase * 0.5) * 0.16 * (allowMotion ? 1 : 0)
  })
  // Petals open with the core: aperture behaviour on the reactor, same language as
  // the eyes, so the two read as one system.
  machine.core.petals.forEach((petal) => {
    const angle = (petal.userData.angle as number) ?? 0
    const open = 0.0105 * (0.35 + 0.65 * coreWave)
    petal.position.set(Math.cos(angle) * (0.0395 + open), Math.sin(angle) * (0.0395 + open), 0.011 + open * 0.35)
    petal.rotation.z = angle - Math.PI / 2 + open * 6
  })
  machine.core.light.color.setHex(look.core.color)
  machine.core.light.intensity = clamp(drive.coreIntensity * 0.34, 0, 0.55)

  /* ---- instanced emissive families ---- */
  const flow = machine.groups.flow
  drive.flowPhase += dt * (allowMotion ? look.channel.speed : 0)
  const flowColor = new THREE.Color(look.channel.color)
  const directional = Math.abs(look.channel.speed) > 0.01
  for (let i = 0; i < flow.count; i++) {
    const phasePosition = flow.phase[i]
    let level: number
    if (!allowMotion || off || look.channel.mode === 'off') level = 0.03
    else if (look.channel.mode === 'idle') level = 0.2 + 0.16 * Math.sin((drive.flowPhase + phasePosition) * Math.PI * 2)
    else if (look.channel.mode === 'settle') level = 0.24 + 0.2 * Math.sin((drive.flowPhase * 0.4 + phasePosition) * Math.PI * 2)
    else if (look.channel.mode === 'fault') level = 0.3 + 0.55 * Math.pow(Math.abs(Math.sin((drive.flowPhase * 0.8 + phasePosition) * Math.PI)), 3)
    else {
      // Travelling front: `frac(phase - position)` is a sawtooth that walks along the
      // channel, sharpened so it looks like a discharge, not a sine chasing itself.
      const wave = directional ? (drive.flowPhase * 0.9 - phasePosition) % 1 : 0
      const wrapped = wave < 0 ? wave + 1 : wave
      const attack = Math.exp(-wrapped * 7.5)
      level = 0.14 + (allowMotion ? attack * (look.channel.mode === 'execute' ? 1.25 : 0.8) : 0)
    }
    setGlow(flow, i, flowColor, clamp(level * look.channel.intensity, 0, EMISSIVE.channel.max))
  }
  flow.mesh.instanceColor!.needsUpdate = true

  const vents = machine.groups.vents
  const ventsBody = machine.groups.ventsBody
  const ventColor = new THREE.Color(look.vent.color)
  for (const group of [vents, ventsBody]) {
    for (let i = 0; i < group.count; i++) {
      const breathing = allowMotion ? 0.5 + 0.5 * Math.sin((input.time * (0.5 + look.core.rate * 0.4) + group.phase[i] * 3) * Math.PI * 2) : 0.5
      const push = clamp(look.vent.intensity * (0.55 + 0.45 * breathing) + speech * 0.25 + coreWave * 0.12, 0, EMISSIVE.vent.max)
      setGlow(group, i, ventColor, push)
    }
    group.mesh.instanceColor!.needsUpdate = true
  }

  const trim = machine.groups.trim
  const trimColor = new THREE.Color(look.trim.color)
  for (let i = 0; i < trim.count; i++) {
    const cycle = allowMotion ? 0.5 + 0.5 * Math.sin((drive.flowPhase * 0.6 + trim.phase[i]) * Math.PI * 2) : 0.4
    setGlow(trim, i, trimColor, clamp(look.trim.intensity * (0.4 + 0.6 * cycle) + settle * 0.2, 0, EMISSIVE.trim.max))
  }
  trim.mesh.instanceColor!.needsUpdate = true

  // The surface palette is per-theme in the component, but the emissive families all
  // follow the state, so the entity never looks half-lit by two different intentions.
  machine.materials.emissive.eye.color.setHex(look.core.mode === 'standby' ? 0x03050a : 0x05070a)

  /* ---- readout: measured, shown only in diagnostics ---- */
  const readout = machine.readout
  readout.state = input.state
  readout.lookLabel = look.label
  readout.eyeIntensity = Number(drive.eyeIntensity.toFixed(3))
  readout.aperture = Number(drive.aperture.toFixed(3))
  readout.coreRateHz = look.core.rate
  readout.coreIntensity = Number(drive.coreIntensity.toFixed(3))
  readout.flowSpeed = look.channel.speed
  readout.jawOpen = Number(drive.jaw.toFixed(4))
  readout.tracking = track
}

/**
 * Writes one instance's colour. Linear values on purpose: `instanceColor` is read
 * as-is by the material, and three's output stage does the sRGB encode, so
 * pre-encoding here would double it — hence the `linearToSRGB` reference kept in
 * sync only for the CPU rasteriser, not for the GPU path.
 */
function setGlow(group: GlowGroup, index: number, color: THREE.Color, level: number): void {
  const attribute = group.mesh.instanceColor
  if (!attribute) return
  const clamped = level > MAX_EMISSIVE ? MAX_EMISSIVE : level < 0 ? 0 : level
  group.scratch.copy(color).multiplyScalar(clamped)
  attribute.setXYZ(index, group.scratch.r, group.scratch.g, group.scratch.b)
}

/** `linearToSRGB` is re-exported for the CPU preview so both paths agree. */
export { linearToSRGB }

/* ------------------------------------------------------------------ *
 * Bounds, measured from the real geometry — used by framing and by the audit
 * ------------------------------------------------------------------ */

export function machineBounds(machine: RavenMachine): { height: number; width: number; center: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(machine.root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return { height: size.y, width: size.x, center }
}
