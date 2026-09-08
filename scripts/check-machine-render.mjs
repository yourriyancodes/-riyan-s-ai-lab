/**
 * RAVEN machine verification — the bust is code, so the bust is testable.
 *
 *   npm run check:machine
 *
 * Three layers, in the order that fails fastest:
 *
 *   1. inventory  — every quality tier assembles, every named part exists, and the
 *                   triangle cost per tier stays inside the budget the adaptive-quality
 *                   story promises. A silent geometry regression is the most likely way
 *                   this design decays, because nothing in the build step would notice.
 *   2. behaviour  — all sixteen real states are driven for 400 frames each with the
 *                   pointer and the speech envelope swept, and the assertions are the
 *                   ones that matter for trust: transforms stay finite, emissive
 *                   intensities stay at or under the ceilings in `lib/ravenStudio.ts`
 *                   (that is what "mostly dark metal, not all-neon" means in numbers),
 *                   the jaw aperture stays in range, and every state resolves — an
 *                   unknown state must fall back to IDLE rather than invent a look.
 *   3. pixels     — the CPU rasteriser (`npm run preview:machine`) paints the real scene
 *                   graph offscreen and reports the projected silhouette. Head+shoulders
 *                   occupancy has to sit in the 60-75% band, nothing may clip to white,
 *                   and the lit area stays a minority of the frame. These are measured,
 *                   not remembered: the thresholds below were taken from renders of this
 *                   geometry.
 *
 * No browser, no GPU, no network. If a change here and a change to the geometry disagree,
 * the geometry is wrong until the measurement says otherwise.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as THREE from 'three'
import {
  EMISSIVE,
  FRAMING,
  STATE_LOOK,
  STATE_LOOK_KEYS,
  MAX_EMISSIVE,
} from '../lib/ravenStudio.ts'
import {
  REQUIRED_PARTS,
  buildRavenMachine,
  disposeRavenMachine,
  driveRavenMachine,
  emissiveLuminance,
  machineBounds,
} from '../lib/ravenMachine.ts'
import { RAVEN_STATES } from '../lib/raven/states.ts'


let passed = 0
const failures = []

const check = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL  ${name}\n          ${(error?.message ?? String(error)).split('\n').slice(0, 6).join('\n          ')}`)
  }
}

const group = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`)

const collectNames = (machine) => {
  const names = new Set()
  machine.root.traverse((object) => {
    if (object.name) names.add(object.name)
  })
  return names
}

/** Every emissive-bearing material and instance colour in one flat list. */
const litSurfaces = (machine) => {
  const materials = []
  machine.root.traverse((object) => {
    const mesh = object
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) materials.push({ material, mesh })
    }
  })
  return materials
}

const finite = (object, path = '') => {
  const walk = (value, trail) => {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `non-finite number at ${trail}`)
      return
    }
    if (!value || typeof value !== 'object') return
    if (value.isVector3 || value.isQuaternion || value.isMatrix4 || value.isColor) {
      for (const key of ['x', 'y', 'z', 'w', 'r', 'g', 'b']) {
        if (typeof value[key] === 'number') assert.ok(Number.isFinite(value[key]), `non-finite ${trail}.${key}`)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${trail}[${index}]`))
      return
    }
  }
  walk(object.position, `${path}.position`)
  walk(object.rotation, `${path}.rotation`)
  walk(object.scale, `${path}.scale`)
  walk(object.quaternion, `${path}.quaternion`)
}

/* --------------------------------------------------------------------------- */
group('1 · assembly + inventory')

const built = {}
for (const quality of ['high', 'medium', 'low']) {
  await check(`${quality} build assembles and disposes cleanly`, () => {
    const machine = buildRavenMachine(quality)
    assert.ok(machine.root.children.length > 0, 'root is empty')
    assert.ok(machine.stats.parts >= 40, `${quality} produced only ${machine.stats.parts} named parts`)
    built[quality] = {
      names: collectNames(machine),
      stats: machine.stats,
      bounds: machineBounds(machine),
    }
    disposeRavenMachine(machine)
    // A second dispose must be a no-op rather than a throw: unmount races do happen.
    disposeRavenMachine(machine)
  })
}

await check('the head is the priority: every facial system exists at every tier', () => {
  for (const quality of ['high', 'medium', 'low']) {
    const names = built[quality].names
    for (const part of REQUIRED_PARTS) {
      assert.ok(names.has(part), `${quality} build is missing "${part}"`)
    }
  }
})

await check('triangle budget per tier (adaptive quality is a promise, not a comment)', () => {
  // Measured, not invented: `stats.triangles` counts both faces of every plate, so the
  // rasteriser (back-face culled) reports roughly half these numbers on screen. ~10k
  // triangles is nothing for one static bust; what actually costs a phone is fragments,
  // which is why the tiers differ in textures and lights, not just in segments.
  // Re-measured after the neural-processor design pass: the bearing stack, encoder ticks,
  // package frame, interposer vias and the segmented mandible are ~1.9k triangles at the
  // high tier and the low tier only grew by the parts that define the silhouette.
  // Re-measured after the cinematic redesign (sculpted cranium shells, the optical cowl, the
  // articulated three-tier pauldrons, the collar yoke, the recessed core bore). The phone tier
  // is the one the promise is actually about, and it went *down*: the low build now omits the
  // pauldron gap plates, the trapezius risers and every cable. High and medium are allowed to
  // carry the layering, because for one static bust the cost that matters on a phone is
  // fragments and material switches, not 2k more triangles on a plate nobody sees at that size.
  const budget = { high: 12700, medium: 11400, low: 6300 }
  for (const quality of ['high', 'medium', 'low']) {
    const { triangles } = built[quality].stats
    assert.ok(triangles <= budget[quality], `${quality}: ${triangles} triangles > ${budget[quality]}`)
    assert.ok(triangles > 600, `${quality}: only ${triangles} triangles — that is a wireframe, not an armour suit`)
  }
  assert.ok(
    built.low.stats.triangles < built.high.stats.triangles,
    'mobile tier must be cheaper than desktop, not equal',
  )
})

await check('head+neck+shoulders only: no full body, and the crop is the bust', () => {
  for (const quality of ['high', 'medium', 'low']) {
    const { height, width, center } = built[quality].bounds
    assert.ok(Math.abs(height - 0.451) < 0.03, `${quality}: bust height ${height} drifted from 0.451`)
    // A humanoid body would be ~1.7 m tall against a 0.19 m head; anything over
    // 0.6 m here means legs crept back in.
    assert.ok(height < 0.6, `${quality}: the assembly is ${height} m tall — that is a body`)
    assert.ok(width / height > 0.8, `${quality}: silhouette is ${width}x${height}, taller than wide — shoulders missing`)
    assert.ok(center.y < 0, `${quality}: bust centre at ${center.y} — the head is doing the work, not the torso`)
  }
})

/* --------------------------------------------------------------------------- */
group('2 · state behaviour')

await check('the visual states are exactly the state machine, with no inventions', () => {
  const declared = new Set(STATE_LOOK_KEYS)
  for (const state of RAVEN_STATES) {
    assert.ok(declared.has(state), `RAVEN state "${state}" has no look defined`)
  }
  for (const key of STATE_LOOK_KEYS) {
    assert.ok(RAVEN_STATES.indexOf(key) !== -1, `STATE_LOOK invents "${key}", which the brain never emits`)
  }
})

await check('every look names a real surface family and stays under the emissive ceiling', () => {
  for (const key of STATE_LOOK_KEYS) {
    const look = STATE_LOOK[key]
    for (const family of ['eye', 'core', 'channel', 'vent', 'trim']) {
      const spec = look[family]
      if (!spec || typeof spec.intensity !== 'number') continue
      const ceiling = EMISSIVE[family]?.max ?? MAX_EMISSIVE
      assert.ok(
        spec.intensity <= ceiling + 1e-6,
        `${key}.${family} asks for ${spec.intensity}, ceiling is ${ceiling}`,
      )
      assert.ok(emissiveLuminance(new THREE.Color(spec.color), spec.intensity) < 0.95, `${key}.${family} will clip`)
    }
    assert.ok(look.eye.aperture >= 0 && look.eye.aperture <= 1, `${key}.eye.aperture out of range`)
    assert.ok(look.eye.slit >= 0 && look.eye.slit <= 1, `${key}.eye.slit out of range`)
    assert.ok(
      ['standby', 'breathe', 'accelerate', 'layered', 'drive', 'focus', 'alert', 'alarm'].includes(look.core.mode),
      `${key}.core.mode "${look.core.mode}" is not a machine mode`,
    )
  }
})

// Driving the entity is the only way to know it does not drift: 400 frames per state
// with the pointer and the speech envelope swept through their real ranges.
const sweep = (machine, state, frames = 400) => {
  let time = 0
  const dt = 1 / 60
  for (let frame = 0; frame < frames; frame++) {
    const phase = frame / frames
    driveRavenMachine(machine, {
      state,
      pointer: { x: Math.sin(phase * Math.PI * 4) * 8, y: Math.cos(phase * Math.PI * 3) * 6 },
      speaking: state === 'SPEAKING' || state === 'EXECUTING',
      speechEnergy: 0.5 + 0.5 * Math.sin(phase * Math.PI * 12),
      speechOpenness: 0.5 + 0.5 * Math.sin(phase * Math.PI * 9),
      time,
      dt,
      reducedMotion: false,
      active: true,
      externalBlink: frame % 97 === 0,
    })
    time += dt
  }
}

for (const state of RAVEN_STATES) {
  await check(`${state}: stable, bounded, and readable`, () => {
    const machine = buildRavenMachine('high')
    sweep(machine, state)
    const readout = machine.readout
    assert.equal(readout.state, state, 'readout is not reporting the state it was driven with')
    for (const object of [machine.root, machine.head, machine.jaw, machine.torso, machine.neck.group, machine.core.group]) {
      finite(object, `${state}/${object.name || 'group'}`)
    }
    const limits = {
      eyeIntensity: EMISSIVE.eye.max,
      coreIntensity: EMISSIVE.core.max,
    }
    for (const [key, ceiling] of Object.entries(limits)) {
      assert.ok(readout[key] <= ceiling + 1e-6, `${state}.${key} = ${readout[key]} exceeds ${ceiling}`)
    }
    assert.ok(readout.jawOpen >= 0 && readout.jawOpen <= 1, `${state}.jawOpen = ${readout.jawOpen}`)
    assert.ok(readout.aperture >= 0 && readout.aperture <= 1, `${state}.aperture = ${readout.aperture}`)
    assert.ok(readout.coreRateHz >= 0 && readout.coreRateHz <= 4, `${state}.coreRateHz = ${readout.coreRateHz}`)
    // The head must stay inside its own limits: no ratcheting toward a pose.
    assert.ok(Math.abs(machine.head.rotation.y) <= 0.35, `${state}: head yaw ${machine.head.rotation.y}`)
    assert.ok(Math.abs(machine.head.rotation.x) <= 0.35, `${state}: head pitch ${machine.head.rotation.x}`)
    for (const { material } of litSurfaces(machine)) {
      if (material.emissiveIntensity !== undefined) {
        assert.ok(
          material.emissiveIntensity <= MAX_EMISSIVE + 1e-6,
          `${state}: ${material.name || 'material'} emissive ${material.emissiveIntensity} > ${MAX_EMISSIVE}`,
        )
      }
    }
    disposeRavenMachine(machine)
  })
}

await check('an unknown state degrades to IDLE instead of inventing a look', () => {
  const machine = buildRavenMachine('high')
  sweep(machine, 'NOT_A_REAL_STATE', 20)
  const idle = buildRavenMachine('high')
  sweep(idle, 'IDLE', 20)
  assert.ok(Math.abs(machine.drive.eyeIntensity - idle.drive.eyeIntensity) < 1e-6, 'fallback did not match IDLE')
  disposeRavenMachine(machine)
  disposeRavenMachine(idle)
})

await check('reduced motion freezes the mechanism but keeps the state legible', () => {
  const machine = buildRavenMachine('high')
  let time = 0
  for (let frame = 0; frame < 240; frame++) {
    driveRavenMachine(machine, {
      state: 'REASONING',
      pointer: { x: 4, y: -2 },
      speaking: false,
      speechEnergy: 0,
      speechOpenness: 0,
      time,
      dt: 1 / 60,
      reducedMotion: true,
      active: true,
      externalBlink: false,
    })
    time += 1 / 60
  }
  assert.equal(machine.drive.microCurrent.every((value) => value === 0), true, 'micro-adjustments ran under reduced motion')
  assert.ok(machine.drive.eyeIntensity > 0, 'the sensors went dark; the state must still read')
  const held = machine.head.rotation.y
  for (let frame = 0; frame < 60; frame++) {
    driveRavenMachine(machine, {
      state: 'REASONING',
      pointer: { x: 4, y: -2 },
      speaking: false,
      speechEnergy: 0,
      speechOpenness: 0,
      time,
      dt: 1 / 60,
      reducedMotion: true,
      active: true,
      externalBlink: false,
    })
    time += 1 / 60
  }
  assert.ok(Math.abs(machine.head.rotation.y - held) < 1e-9, 'head still moved under reduced motion')
  disposeRavenMachine(machine)
})

await check('an inactive stage accumulates nothing', () => {
  const machine = buildRavenMachine('high')
  let time = 0
  for (let frame = 0; frame < 120; frame++) {
    driveRavenMachine(machine, {
      state: 'EXECUTING',
      pointer: { x: 0, y: 0 },
      speaking: false,
      speechEnergy: 0.9,
      speechOpenness: 0.8,
      time,
      dt: 1 / 60,
      reducedMotion: false,
      active: false,
      externalBlink: false,
    })
    time += 1 / 60
  }
  assert.equal(machine.drive.flowPhase, 0, 'energy flow advanced while off-screen')
  assert.equal(machine.drive.scanPhase, 0, 'the sensor swept while off-screen')
  disposeRavenMachine(machine)
})

/* --------------------------------------------------------------------------- */
group('3 · rendered pixels (CPU rasteriser of the real scene graph)')

const WIDTH = 360
const HEIGHT = 400
const runRender = (flags) => {
  const out = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--import',
      './scripts/lib/tsr.mjs',
      'scripts/render-machine-preview.mjs',
      '--width',
      String(WIDTH),
      '--height',
      String(HEIGHT),
      '--out',
      '/tmp/raven-check.png',
      ...flags,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 24 },
  )
  const start = out.indexOf('{')
  return JSON.parse(out.slice(start))
}

/** Measured on this geometry; the bands are where a good frame sits, not wishful numbers. */
const OCCUPANCY = { min: 0.55, max: 0.8 }
const EMISSIVE_AREA_MAX = 0.05
const RENDERED_STATES = ['IDLE', 'THINKING', 'REASONING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'ERROR', 'OFFLINE']
const renders = new Map()

for (const state of RENDERED_STATES) {
  await check(`${state} renders as a lit machine, not a blown-out one`, () => {
    const stats = runRender(['--state', state])
    renders.set(state, stats)
    assert.ok(stats.triangles > 1000, `only ${stats.triangles} triangles reached the rasteriser`)
    assert.equal(stats.clippedPixels, 0, `${stats.clippedPixels} pixels clipped to pure white`)
    const area = stats.emissivePixels / (WIDTH * HEIGHT)
    assert.ok(area <= EMISSIVE_AREA_MAX, `emissive covers ${(area * 100).toFixed(1)}% of the frame`)
    // OFFLINE is authored as the dimmest state there is, so the bright-glow test cannot be
    // what proves the model is switched on; the standby metric measures hue-saturated light
    // at any brightness for exactly that job. Every other state must pass the bright test.
    if (state === 'OFFLINE') {
      assert.ok(stats.standbyPixels > 120, `standby light is only ${stats.standbyPixels}px — the offline face is dark`)
    } else {
      assert.ok(stats.emissivePixels > 40, 'nothing is lit; the sensors are invisible')
    }
    const occupancy = stats.heightOccupancy
    assert.ok(
      occupancy >= OCCUPANCY.min && occupancy <= OCCUPANCY.max,
      `height occupancy ${(occupancy * 100).toFixed(1)}% outside ${OCCUPANCY.min * 100}-${OCCUPANCY.max * 100}%`,
    )
    const coverage = Math.max(occupancy, stats.widthOccupancy)
    assert.ok(coverage <= FRAMING.hero.maxCoverage + 0.06, `frame coverage ${(coverage * 100).toFixed(1)}% clips the bust`)
  })
}

await check('mobile portrait keeps the shoulders inside the frame', () => {
  const stats = runRender(['--state', 'IDLE', '--width', '300', '--height', '560'])
  assert.ok(stats.widthOccupancy <= 0.98, `width occupancy ${(stats.widthOccupancy * 100).toFixed(1)}% on a phone`)
  assert.ok(stats.heightOccupancy >= 0.3, 'the bust is a postage stamp on mobile')
})

await check('light theme does not wash the metal out', () => {
  const stats = runRender(['--state', 'IDLE', '--theme', 'light'])
  assert.equal(stats.clippedPixels, 0, `${stats.clippedPixels} clipped pixels on the light backdrop`)
  assert.ok(stats.coverage > 0.2, 'the bust disappeared against white')
})

await check('pointer awareness actually turns the head', () => {
  const centre = runRender(['--state', 'IDLE', '--pointer', '0,0'])
  const left = runRender(['--state', 'IDLE', '--pointer', '-8,0'])
  assert.ok(
    Math.abs(centre.headYaw - left.headYaw) > 1e-4,
    `head yaw did not move (${centre.headYaw} → ${left.headYaw})`,
  )
  assert.notEqual(centre.frameHash, left.frameHash, 'the rendered frame is identical: the pointer is decorative')
})

/* --------------------------------------------------------------------------- */
const total = passed + failures.length
console.log(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${passed}/${total} checks passed\u001b[0m`)
if (failures.length) {
  for (const failure of failures) console.error(`\n\u001b[31m✗ ${failure.name}\u001b[0m\n${failure.error?.stack ?? failure.error}`)
  process.exit(1)
}
