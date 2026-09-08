/**
 * RAVEN's machine rig: material policy, lighting, framing, motion and the
 * state→visual table.
 *
 * Nothing in this file imports `three`, on purpose. `lib/ravenMachine.ts` builds
 * geometry with it, `components/Raven3D.tsx` drives the loop with it, and
 * `scripts/render-machine-preview.mjs` rasterises the same numbers on the CPU. One
 * source of truth is what makes the offline render a measurement of the shipped
 * look instead of a drawing of an unrelated one.
 *
 * Why the rig changed with the entity. The previous version of this file was a
 * portrait setup for a *human* face: soft warm key at 1.55, weak ambient, exposure
 * tuned just under the point where pale skin clips. Metal inverts every one of
 * those decisions. A brushed-titanium shell has almost no diffuse response at all,
 * so it is lit by *what it reflects*: contrast between a bright narrow source and a
 * black room, not a soft wrap. So:
 *
 *   - the key is cool and hard, and it is the brightest thing here;
 *   - ambient is nearly gone (0.05) because ambient on metal only greys it;
 *   - two rim sources from behind define the silhouette, which is the whole read
 *     at portrait distance;
 *   - environment intensity is *high* (0.95 vs 0.2 for skin) because without an
 *     environment the plates have nothing to reflect and go dead plastic;
 *   - exposure sits a little lower (0.82) because the emissive channels are the
 *     highlights now, and they must not blow out the metal around them.
 *
 * The emissive budget is the other half of the look. `maxEmissive` below is a hard
 * ceiling enforced by the drive function, and `npm run check:machine-render` fails
 * if a rendered frame clips — the brief is "dark metallic with controlled energy",
 * and the failure mode of every sci-fi UI is the second half eating the first.
 */

export type StudioTheme = 'dark' | 'light'

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

/** The requested surface colours, as numbers, in one place. */
export const MACHINE_COLORS = {
  /** Void behind everything; matches the page's #05070A. */
  backdrop: 0x05070a,
  // The lit value, not the sRGB swatch: a metal whose albedo is #05070A reflects almost
  // nothing and photographs as a silhouette, so the primaries sit a stop above the page
  // background. This is what keeps "dark gunmetal" from becoming "invisible".
  gunmetal: 0x0f141b,
  gunmetalDeep: 0x0a0d12,
  titanium: 0x414a56,
  titaniumDim: 0x343b46,
  matteBlack: 0x040507,
  carbon: 0x0d1116,
  edgeTrim: 0x5d6875,
  cyan: 0x00e5ff,
  cyanDeep: 0x0b7f92,
  violet: 0x8b5cf6,
  violetDeep: 0x4c2f96,
  ember: 0xff5a3d,
  alertRed: 0xd9413b,
  white: 0xf5f7fa,
} as const

/**
 * Surface materials. `id`s are what the geometry tags parts with and what the
 * audit script counts, so renaming one is a breaking change, not a cosmetic one.
 *
 * `anisotropy`/`clearcoat` are MeshPhysicalMaterial features: brushed metal needs
 * the elongated highlight, and a lacquer layer over gunmetal is what separates
 * "machined housing" from "injection-moulded plastic toy".
 */
export type SurfaceSpec = {
  id: string
  color: number
  metalness: number
  roughness: number
  envMapIntensity: number
  clearcoat?: number
  clearcoatRoughness?: number
  anisotropy?: number
  /** Woven micro-relief (see `makeWeaveTextures`); only worth its cost on big flat plates. */
  weave?: boolean
  /** Cover glass only. Everything opaque stays opaque: additive transparency over a
   *  dark card is the cheap-hologram look the brief rules out. */
  transparent?: boolean
  opacity?: number
  note: string
}

export const SURFACES: Record<string, SurfaceSpec> = {
  shell: {
    id: 'shell',
    color: MACHINE_COLORS.gunmetal,
    // Black chrome, not gloss: a thin, *rough* lacquer over near-black metal gives the
    // broad dark reflection with a broken highlight, which is what reads as a premium
    // cinematic surface. The weave map is what supplies the roughness variation the brief
    // asks for — an even roughness across a 100 mm plate is what reads as a game asset.
    metalness: 0.95,
    roughness: 0.5,
    envMapIntensity: 0.75,
    clearcoat: 0.16,
    clearcoatRoughness: 0.5,
    weave: true,
    note: 'cranium and primary armour: matte black-over-gunmetal metal. It used to be lacquered (roughness 0.36, clearcoat 0.42) and that sheen is precisely what made a machined skull read as an injection-moulded toy; real armour scatters, so the highlight is broad, dim and broken up by the weave map',
  },
  plate: {
    id: 'plate',
    color: MACHINE_COLORS.gunmetalDeep,
    metalness: 0.84,
    roughness: 0.74,
    envMapIntensity: 0.5,
    clearcoat: 0.04,
    weave: true,
    note: 'layered face and torso plates: a step darker than the shell so the layering reads as thickness',
  },
  titanium: {
    id: 'titanium',
    color: MACHINE_COLORS.titanium,
    metalness: 1,
    roughness: 0.5,
    envMapIntensity: 0.62,
    anisotropy: 0.85,
    weave: true,
    note: 'brushed structural metal: exposed machined parts, actuator collars, hinge pins',
  },
  trim: {
    id: 'trim',
    color: MACHINE_COLORS.edgeTrim,
    metalness: 1,
    roughness: 0.4,
    envMapIntensity: 0.58,
    anisotropy: 0.5,
    note: 'plate-edge trim: thin bright lines that draw the engineering geometry under any lighting',
  },
  matte: {
    id: 'matte',
    color: MACHINE_COLORS.matteBlack,
    metalness: 0.2,
    roughness: 0.96,
    envMapIntensity: 0.12,
    note: 'seams, recesses and socket interiors: absorbs, which is what makes the plates look assembled',
  },
  carbon: {
    id: 'carbon',
    color: MACHINE_COLORS.carbon,
    metalness: 0.4,
    roughness: 0.7,
    envMapIntensity: 0.36,
    weave: true,
    note: 'woven composite on the neck wrap and inner shoulders: deliberately non-metallic so the silhouette has material contrast',
  },
  lens: {
    id: 'lens',
    color: 0x0a0f16,
    // The coating on the optic, not a pane of glass in front of it. The previous values —
    // roughness 0.1 against envMapIntensity 1.1 — made this plate a *mirror* 71 mm across, so
    // the key light drew a bright grey slab straight through the aperture and the band stopped
    // reading as light inside a recess. It is now smaller than the opening, seated under the
    // cowl, and reflects at a fraction of the environment: a hard coat keeps one glint along
    // the top edge, which is all cover glass has to do here. The glow must come through it
    // intact, so opacity stays low.
    metalness: 0.2,
    roughness: 0.22,
    envMapIntensity: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    transparent: true,
    opacity: 0.16,
    note: 'sensor cover glass: one hard specular edge, no mirror flood across the aperture',
  },
} as const

export type SurfaceId = keyof typeof SURFACES

/**
 * Emissive ceilings per family. Deliberately low: at `2.2` the eye slots arrived on
 * screen as two white rectangles, which is exactly the all-neon look the brief rules out,
 * and the blowout erased the detail inside the housing. RAVEN is mostly dark metal with a
 * few *contained* light sources, so the ceiling — not the per-state intensity alone — is
 * what enforces that. `npm run check:machine` renders every state and fails if the lit
 * area exceeds its budget, so this number is measured rather than decorative.
 */
export const EMISSIVE = {
  eye: { color: MACHINE_COLORS.cyan, max: 1.15 },
  /** The filament inside the eye slot: same family, harder, so the sensor has a focus. */
  eyeCore: { color: MACHINE_COLORS.white, max: 1.5 },
  // The core's ceiling is about the light it throws on the surrounding plates, not a
  // disc's brightness: the emitter is small and recessed, so this stays a hot point
  // inside a machined socket.
  core: { color: MACHINE_COLORS.cyan, max: 1.1 },
  // The channels sit in recessed ducts, so their on-screen area is small and they can
  // be the brightest thing after the eyes without the bust ever looking like a lamp.
  channel: { color: MACHINE_COLORS.cyan, max: 1.1 },
  vent: { color: MACHINE_COLORS.cyanDeep, max: 0.8 },
  // Trim is hairline-thin seam light, so it can carry a little more flux than the
  // surfaces without ever reading as a neon sign: what limits it is area, not ceiling.
  trim: { color: MACHINE_COLORS.violet, max: 0.85 },
} as const

/** Hard ceiling across every emissive family; enforced in `driveRavenMachine`. */
export const MAX_EMISSIVE = 1.5

/* ------------------------------------------------------------------ *
 * Lighting
 * ------------------------------------------------------------------ */

export type LightSpec = {
  kind: 'ambient' | 'directional' | 'point'
  color: number
  intensity: number
  position?: [number, number, number]
  distance?: number
  decay?: number
}

/**
 * Below the clip point for metal + emissive. The human rig needed 0.9 to keep skin
 * off the ceiling; on reflective surfaces the same value plus a bright emissive eye
 * produced a white blob with a dark halo.
 */
export const STUDIO_EXPOSURE: Record<StudioTheme, number> = {
  // The whole entity is authored dark and the exposure stays under 1: the light is there to
  // reveal geometry, and the brief is explicit about not overexposing. Highlights are rare.
  dark: 0.84,
  // The paper theme cannot go brighter by much: a light card behind a dark metal
  // silhouette is the best contrast this entity will ever get, so the lights come
  // *down* rather than up, and the rim is switched off (nothing to separate from).
  light: 0.78,
}

export const STUDIO_ENV_INTENSITY: Record<StudioTheme, number> = {
  // The scene's IBL strength. 0.95 was tuned when the shell was lacquered; with matte
  // metal a bright environment just lifts the blacks, so the whole entity gets *less*
  // reflection and keeps its dark planes. Highlights come from the rig, not the room.
  dark: 0.78,
  light: 0.6,
}

export const studioEnvScale = (theme: StudioTheme): number => STUDIO_ENV_INTENSITY[theme] / STUDIO_ENV_INTENSITY.dark

export const STUDIO_LIGHTS: Record<StudioTheme, LightSpec[]> = {
  dark: [
    // Almost nothing ambient. The brief's "majority of RAVEN stays dark" is achieved by
    // removing fill, not by darkening albedo — a lifted black is how a render starts looking
    // like a lit grey object instead of a lit black one.
    { kind: 'ambient', color: 0x8ea6bc, intensity: 0.045 },
    // Restrained white key, upper camera-left: hard enough to describe the facets, soft
    // enough that no plate blows out. It is the only source allowed to be bright.
    { kind: 'directional', color: 0xe6f2ff, intensity: 2.62, position: [2.45, 3.0, 2.1] },
    // Cyan rim from behind-left, the entity's signature edge light. Strong enough to
    // separate the silhouette from #05070A, not strong enough to colour the metal.
    { kind: 'directional', color: 0x4fd2ff, intensity: 2.05, position: [-1.7, 1.7, -2.9] },
    // Violet *bounce*, not a violet light: low, from the right, at a fraction of the key.
    // It exists so the shadow side is not dead, and it is the only violet on the model.
    { kind: 'directional', color: 0x7c53c9, intensity: 0.5, position: [2.2, -0.35, -1.9] },
    // A whisper under the jaw so the chin line survives against a dark card.
    { kind: 'directional', color: 0x88a9bd, intensity: 0.13, position: [0, -1.55, 1.7] },
    // Warm counter-key, kept at almost nothing: it stops the whole rig reading monochrome
    // blue without introducing a colour the palette forbids.
    { kind: 'directional', color: 0xefd8c4, intensity: 0.12, position: [-2.65, 0.35, 1.95] },
    // The core's own light: local, weak, and short-ranged, so the processor looks like it is
    // inside the chest rather than spotlighting it.
    { kind: 'point', color: 0x63e2f7, intensity: 0.1, position: [0, -0.115, 0.16], distance: 0.5, decay: 2 },
  ],
  light: [
    // Dark metal on a pale card is the opposite problem from skin on a dark one: a broad
    // ambient wash turns gunmetal into a grey silhouette and the panel seams disappear.
    // So the fill is *thin* and the key is *harder* than the dark rig's, which is the
    // only way the plate edges keep reading when the background is brighter than the subject.
    { kind: 'ambient', color: 0xf6f8fb, intensity: 0.18 },
    { kind: 'directional', color: 0xeaf4ff, intensity: 2.05, position: [2.2, 2.9, 2.3] },
    { kind: 'directional', color: 0xd8e6f2, intensity: 0.3, position: [-2.4, 0.6, 2.0] },
    // On paper, a cyan rim has nothing to separate from; a *dark* contact does. This
    // is a shadow-casting light in spirit only (no shadow maps here), so it stays soft.
    { kind: 'directional', color: 0xbcc9d8, intensity: 0.5, position: [-1.3, 1.6, -2.6] },
    { kind: 'point', color: 0x9ecfe0, intensity: 0.22, position: [0, -0.115, 0.16], distance: 0.7, decay: 2 },
  ],
}

/* ------------------------------------------------------------------ *
 * Framing
 * ------------------------------------------------------------------ */

/**
 * The entity is authored in metres, head-centred at the origin: crown at about
 * +0.163, jaw tip at about −0.107, shoulder line at −0.30, so the whole bust is
 * ~0.47 m tall and 0.62 m wide.
 *
 * `occupancy` is the *target* fraction of the frame's height the entity should
 * cover — 60-75% per the brief. `cropHeight` is then solved from it in
 * `framingFor()`, and `npm run check:machine-render` measures the real silhouette
 * and fails if it drifts outside that band. Authoring against a measured number is
 * the only reason that check means anything.
 */
export const FRAMING = {
  // `aimOffset` is relative to the measured bust centre, which sits at chest height.
  // Negative aims *below* it, pushing the head toward the upper third of the frame —
  // the character-reveal composition, and the reason the crop is not centred.
  // 74 % of the card, aimed 55 mm under the bust centre. Both numbers exist for the same
  // reason: the portrait is about the head, so the head gets the frame and the chest gets
  // cropped by the card, exactly like a photographer's 85 mm head-and-shoulders.
  hero: { occupancy: 0.74, maxCoverage: 0.86, fov: 24, aimOffset: -0.055, bias: 1.03 },
  stage: { occupancy: 0.66, maxCoverage: 0.9, fov: 30, aimOffset: -0.03, bias: 1.03 },
} as const

export type FramingVariant = keyof typeof FRAMING

export type ResolvedFraming = {
  /** Visible world-space height around the aim point. */
  cropHeight: number
  /** Which constraint set the crop: height target, or shoulder span in a narrow frame. */
  limitedBy?: 'height' | 'width'
  fov: number
  /** Camera distance that produces the crop. */
  distance: number
  /** Vertical aim, in entity space. */
  lookY: number
}

/**
 * Bust height in metres, as authored. The component measures the real bounds at
 * build time and passes that in; this is the fallback for callers (and the number
 * `npm run check:machine` compares the measured height against, so a geometry
 * change that moves the silhouette has to update it deliberately).
 */
export const BUST_HEIGHT = 0.4681

/** Shoulder-to-shoulder width, same caveat as `BUST_HEIGHT`. */
export const BUST_WIDTH = 0.4513

/**
 * Solves the portrait crop from the occupancy target. Long-lens on purpose: 24°
 * flattens the face the way a 105 mm portrait lens does, which makes a mechanical
 * head look monumental instead of wide-angle toy-like.
 */
export function framingFor(
  variant: FramingVariant,
  bustHeight: number = BUST_HEIGHT,
  options: { bustWidth?: number; aspect?: number } = {},
): ResolvedFraming {
  const framing = FRAMING[variant]
  const { bustWidth = BUST_WIDTH, aspect = 1 } = options
  // The frame has to be *taller* than the subject for the subject to cover a
  // fraction of it: crop = height ÷ occupancy. `bias` adds the small margin that
  // keeps a crown inside the frame when the head tilts.
  const cropFromHeight = (bustHeight / framing.occupancy) * framing.bias
  // Shoulder span is the binding constraint in a tall container — a phone in
  // portrait gives an aspect well under 1, and the pauldrons would run off-frame.
  // Widening the crop (never zooming in) is the only correct response, so the
  // 60-75% coverage target becomes a ceiling there rather than a target.
  const cropFromWidth = (bustWidth / framing.maxCoverage) / Math.max(aspect, 0.2)
  const cropHeight = Math.max(cropFromHeight, cropFromWidth)
  const fov = framing.fov
  const distance = cropHeight / 2 / Math.tan(((fov / 2) * Math.PI) / 180)
  return { cropHeight, fov, distance, lookY: framing.aimOffset }
}

/* ------------------------------------------------------------------ *
 * Motion — machine articulation, not biology
 * ------------------------------------------------------------------ */

export const MOTION = {
  /** Servo, not muscle: orientation is critically damped and slightly quantised. */
  headYaw: 0.12,
  headPitch: 0.075,
  headRoll: 0.02,
  headYawLimit: 0.2,
  headPitchLimit: 0.12,
  /** Radians of encoder step. A real actuator has finite resolution; snapping to it
   *  is what stops pointer tracking from reading as a human eye sliding. */
  encoder: 0.006,
  /** Sensor travel inside the socket, radians. Small, because the head does the rest. */
  sensorYaw: 0.16,
  sensorPitch: 0.1,
  /** Aperture (iris) range, as a scale on the emitter's size, not a morph. */
  apertureMin: 0.78,
  apertureMax: 1.18,
  /** Head-to-torso lag, in seconds of first-order delay. */
  headLag: 9.5,
  torsoLag: 4.5,
  coreLag: 6.0,
  /** Mastoid vanes rotate toward the pointer a little further than the head does. */
  vaneGain: 0.3,
  /** Servo micro-adjustment: a real held position drifts and re-corrects. */
  microInterval: [2.2, 5.4] as [number, number],
  // 0.37° at full scale. Anything larger and the head never stops moving, which reads as
  // restlessness rather than servo trim.
  microAmplitude: 0.0065,
  /** Vertical settle of the neck stacks, in metres. */
  neckSettle: 0.0045,
  /** Jaw travel at full speech energy, radians about the hinge. */
  jawMax: 0.075,
  /** Amplitude limits so no state can produce a dance. */
  maxSway: 0.02,
} as const

/**
 * Speech response. The jaw and the throat illumination are driven by the *measured*
 * `speechSynthesis` boundary energy from `lib/speechSync.ts` — when nothing is
 * speaking, `energy` is 0 and nothing moves. `fallbackRate` is used only for the
 * labelled procedural case and the status line says which one is live.
 */
export const SPEECH = {
  jawGain: 1,
  throatGain: 0.85,
  lamLambda: 16,
} as const

/* ------------------------------------------------------------------ *
 * State → visual table
 *
 * Keys are the real `RAVEN_STATES` union (`lib/raven/types.ts`), all sixteen. The
 * brief named ten; the other six are states the application genuinely enters, so
 * they get their own look rather than falling into a default. An unmapped state
 * would be the visual equivalent of a fake status, so
 * `scripts/check-machine.mjs` asserts full coverage and no extras.
 *
 * Every field is a *setting on the machine*, never a number invented for
 * decoration:
 *   eye.aperture  iris diaphragm opening (0..1 of MOTION.aperture* range)
 *   eye.slit      eyelid-equivalent: how far the housing shutters close
 *   core.rate     Hz of the reactor's real breathing cycle
 *   core.mode     how the reactor behaves (see MachineCoreMode)
 *   flow          channel travel: −1/1 directional, 0 = standing field
 *   settle        how quickly activity quiets toward the state's floor
 * ------------------------------------------------------------------ */

export type MachineCoreMode = 'standby' | 'breathe' | 'accelerate' | 'layered' | 'drive' | 'focus' | 'alert' | 'alarm'
export type MachineChannelMode = 'idle' | 'sample' | 'deliberate' | 'execute' | 'settle' | 'fault' | 'off'

export type StateLook = {
  eye: { color: number; intensity: number; aperture: number; slit: number; scan: number }
  core: { color: number; intensity: number; rate: number; mode: MachineCoreMode }
  channel: { color: number; intensity: number; speed: number; mode: MachineChannelMode }
  vent: { color: number; intensity: number }
  /** Small violet trim lights on the forehead/temple architecture. */
  trim: { color: number; intensity: number }
  posture: { lean: number; lift: number; spread: number; hold: number }
  /** 0..1: how much the servo micro-adjustment runs. OFFLINE and VERIFYING take 0. */
  micro: number
  /** Sensor tracking gain: LISTENING/VISION look for the pointer, ERROR/OFFLINE do not. */
  track: number
  /** Jaw floor, so a state can hold the mandible slightly open. */
  jaw: number
  label: string
}

const C = MACHINE_COLORS

export const STATE_LOOK: Record<string, StateLook> = {
  IDLE: {
    eye: { color: C.cyan, intensity: 0.44, aperture: 0.46, slit: 0.08, scan: 0.06 },
    core: { color: C.cyan, intensity: 0.42, rate: 0.16, mode: 'breathe' },
    channel: { color: C.cyanDeep, intensity: 0.3, speed: 0.12, mode: 'idle' },
    vent: { color: C.cyanDeep, intensity: 0.22 },
    trim: { color: C.violet, intensity: 0.22 },
    posture: { lean: 0, lift: 0, spread: 0, hold: 1 },
    micro: 0.42,
    track: 0.45,
    jaw: 0,
    label: 'calm cyan, slow core — the machine is powered and unoccupied',
  },
  LISTENING: {
    eye: { color: C.cyan, intensity: 0.86, aperture: 0.8, slit: 0, scan: 0.22 },
    core: { color: C.cyan, intensity: 0.58, rate: 0.28, mode: 'accelerate' },
    channel: { color: C.cyan, intensity: 0.55, speed: 0.5, mode: 'sample' },
    vent: { color: C.cyan, intensity: 0.3 },
    trim: { color: C.cyan, intensity: 0.24 },
    // Leans in, by a degree and a half. That is all "attending" needs to read as.
    posture: { lean: -0.026, lift: 0.0016, spread: 0, hold: 0.6 },
    micro: 0.28,
    track: 1,
    jaw: 0.02,
    label: 'aperture open, brighter cyan, head committed slightly forward',
  },
  UNDERSTANDING: {
    eye: { color: C.cyan, intensity: 0.68, aperture: 0.68, slit: 0.04, scan: 0.42 },
    core: { color: C.cyan, intensity: 0.6, rate: 0.4, mode: 'accelerate' },
    channel: { color: C.cyan, intensity: 0.62, speed: 0.72, mode: 'sample' },
    vent: { color: C.cyan, intensity: 0.34 },
    trim: { color: C.violet, intensity: 0.3 },
    posture: { lean: -0.016, lift: 0, spread: 0, hold: 0.8 },
    micro: 0.34,
    track: 0.8,
    jaw: 0.015,
    label: 'sensors sweep their travel while the utterance is parsed',
  },
  THINKING: {
    eye: { color: C.cyan, intensity: 0.92, aperture: 0.64, slit: 0.08, scan: 0.3 },
    core: { color: C.cyan, intensity: 0.72, rate: 0.86, mode: 'accelerate' },
    channel: { color: C.violet, intensity: 0.72, speed: 0.95, mode: 'deliberate' },
    vent: { color: C.cyan, intensity: 0.4 },
    trim: { color: C.violet, intensity: 0.5 },
    posture: { lean: 0.008, lift: 0.001, spread: 0.004, hold: 0.5 },
    micro: 0.42,
    track: 0.34,
    jaw: 0.01,
    label: 'cyan/violet alternation: the eyes brighten, the channels start cycling',
  },
  RESEARCHING: {
    eye: { color: C.cyan, intensity: 0.74, aperture: 0.72, slit: 0.05, scan: 0.66 },
    core: { color: C.cyan, intensity: 0.66, rate: 0.6, mode: 'accelerate' },
    channel: { color: C.cyan, intensity: 0.8, speed: 1.25, mode: 'sample' },
    vent: { color: C.cyan, intensity: 0.46 },
    trim: { color: C.cyan, intensity: 0.36 },
    // Looks down-left slightly: it is reading, not watching you.
    posture: { lean: 0.02, lift: 0, spread: 0.006, hold: 0.7 },
    micro: 0.5,
    track: 0.15,
    jaw: 0.008,
    label: 'retrieval: fast low-channel traffic, eyes at partial aperture',
  },
  REASONING: {
    eye: { color: C.violet, intensity: 0.86, aperture: 0.68, slit: 0.06, scan: 0.5 },
    core: { color: C.violet, intensity: 0.7, rate: 1.05, mode: 'layered' },
    channel: { color: C.violet, intensity: 0.8, speed: 1.6, mode: 'deliberate' },
    vent: { color: C.violetDeep, intensity: 0.55 },
    trim: { color: C.violet, intensity: 0.75 },
    posture: { lean: 0, lift: 0.0014, spread: 0.008, hold: 0.4 },
    micro: 0.6,
    track: 0.3,
    jaw: 0.006,
    label: 'controlled violet/cyan activity, layered core pulse, energy crossing the skull',
  },
  PLANNING: {
    eye: { color: C.violet, intensity: 0.78, aperture: 0.6, slit: 0.12, scan: 0.28 },
    core: { color: C.violet, intensity: 0.86, rate: 1.28, mode: 'layered' },
    channel: { color: C.violet, intensity: 0.74, speed: 1.9, mode: 'deliberate' },
    vent: { color: C.violetDeep, intensity: 0.6 },
    trim: { color: C.violet, intensity: 0.66 },
    posture: { lean: 0.006, lift: 0, spread: 0.012, hold: 0.3 },
    micro: 0.3,
    track: 0.25,
    jaw: 0.004,
    label: 'the layered pulse tightens: the decision tree is being walked',
  },
  EXECUTING: {
    eye: { color: C.cyan, intensity: 1.0, aperture: 0.88, slit: 0, scan: 0.12 },
    core: { color: C.cyan, intensity: 1.05, rate: 2.1, mode: 'drive' },
    // Directional: flow runs out of the core toward the head, then snaps back.
    channel: { color: C.cyan, intensity: 1.0, speed: 3.4, mode: 'execute' },
    vent: { color: C.cyan, intensity: 0.8 },
    trim: { color: C.cyan, intensity: 0.6 },
    posture: { lean: -0.034, lift: 0.0022, spread: 0.02, hold: 0.15 },
    micro: 0.18,
    track: 0.6,
    jaw: 0.012,
    label: 'strongest energy activity of the cycle; channels run one direction',
  },
  VERIFYING: {
    eye: { color: C.white, intensity: 0.9, aperture: 0.94, slit: 0.18, scan: 0 },
    core: { color: C.white, intensity: 0.92, rate: 0.5, mode: 'focus' },
    channel: { color: C.cyan, intensity: 0.5, speed: 0.25, mode: 'settle' },
    vent: { color: C.cyanDeep, intensity: 0.3 },
    trim: { color: C.white, intensity: 0.2 },
    posture: { lean: -0.008, lift: 0, spread: 0, hold: 0.95 },
    micro: 0,
    track: 0.45,
    jaw: 0.01,
    label: 'everything stops moving except the aperture: white-cyan, held',
  },
  SPEAKING: {
    eye: { color: C.cyan, intensity: 0.88, aperture: 0.76, slit: 0.03, scan: 0.18 },
    core: { color: C.cyan, intensity: 0.98, rate: 0.9, mode: 'drive' },
    channel: { color: C.cyan, intensity: 0.8, speed: 1.1, mode: 'execute' },
    vent: { color: C.cyan, intensity: 0.52 },
    trim: { color: C.cyan, intensity: 0.3 },
    posture: { lean: -0.012, lift: 0, spread: 0.006, hold: 0.5 },
    micro: 0.2,
    track: 0.7,
    jaw: 0,
    label: 'jaw and throat illumination follow measured speech energy, not a loop',
  },
  VISION: {
    eye: { color: C.cyan, intensity: 0.82, aperture: 0.86, slit: 0, scan: 1 },
    core: { color: C.cyan, intensity: 0.78, rate: 0.55, mode: 'accelerate' },
    channel: { color: C.cyan, intensity: 0.7, speed: 0.9, mode: 'sample' },
    vent: { color: C.cyan, intensity: 0.4 },
    trim: { color: C.cyan, intensity: 0.32 },
    posture: { lean: -0.018, lift: 0.0012, spread: 0, hold: 0.55 },
    micro: 0.22,
    // Full tracking: this is the state where the camera is actually feeding frames.
    track: 1,
    jaw: 0.01,
    label: 'sensors sweep full travel and the vanes rotate out: camera is live',
  },
  WAITING: {
    eye: { color: C.cyan, intensity: 0.54, aperture: 0.48, slit: 0.26, scan: 0.06 },
    core: { color: C.cyan, intensity: 0.52, rate: 0.26, mode: 'breathe' },
    channel: { color: C.cyanDeep, intensity: 0.3, speed: 0.2, mode: 'idle' },
    vent: { color: C.cyanDeep, intensity: 0.2 },
    trim: { color: C.violet, intensity: 0.24 },
    posture: { lean: 0.014, lift: -0.001, spread: 0, hold: 1 },
    micro: 0.7,
    track: 0.2,
    jaw: 0,
    label: 'held open: an approval is outstanding, so it waits with lids half closed',
  },
  SUCCESS: {
    eye: { color: C.cyan, intensity: 0.95, aperture: 0.84, slit: 0, scan: 0.15 },
    core: { color: C.cyan, intensity: 0.95, rate: 1.4, mode: 'accelerate' },
    channel: { color: C.cyan, intensity: 0.9, speed: 1.6, mode: 'settle' },
    vent: { color: C.cyan, intensity: 0.6 },
    trim: { color: C.cyan, intensity: 0.4 },
    posture: { lean: -0.006, lift: 0.0016, spread: 0.004, hold: 0.4 },
    micro: 0.2,
    track: 0.6,
    jaw: 0.02,
    label: 'one clean rise and settle: nothing was decoration about it',
  },
  WARNING: {
    eye: { color: C.ember, intensity: 0.8, aperture: 0.68, slit: 0.1, scan: 0.4 },
    core: { color: C.ember, intensity: 0.84, rate: 1.15, mode: 'alert' },
    channel: { color: C.ember, intensity: 0.75, speed: 1.2, mode: 'fault' },
    vent: { color: C.ember, intensity: 0.62 },
    trim: { color: C.ember, intensity: 0.5 },
    posture: { lean: 0.01, lift: 0, spread: 0.016, hold: 0.6 },
    micro: 0.4,
    track: 0.5,
    jaw: 0.01,
    label: 'controlled ember, no red yet: something needs your attention',
  },
  ERROR: {
    eye: { color: C.alertRed, intensity: 0.85, aperture: 0.58, slit: 0.2, scan: 0.16 },
    core: { color: C.alertRed, intensity: 0.88, rate: 1.65, mode: 'alarm' },
    channel: { color: C.alertRed, intensity: 0.6, speed: 0.4, mode: 'fault' },
    vent: { color: C.alertRed, intensity: 0.5 },
    trim: { color: C.alertRed, intensity: 0.32 },
    posture: { lean: 0.022, lift: -0.0018, spread: 0.01, hold: 0.75 },
    micro: 0.55,
    track: 0.2,
    jaw: 0,
    label: 'restrained red: two families lit, everything else left dark',
  },
  OFFLINE: {
    // Standby, not dead: the band stays lit behind the half-closed shutters and the ducts
    // along the chassis carry the glow. This looks too bright next to the other states'
    // numbers and is exactly right in the frame — the recessed optics plus 62 % closed
    // shutters leave only a few pixels of the ducts visible, so OFFLINE needs a *higher*
    // drive value than LISTENING to read as dim. A silhouette on a dark card reads as a
    // broken canvas, which is the worst possible thing the offline state can say.
    eye: { color: C.cyanDeep, intensity: 0.46, aperture: 0.18, slit: 0.44, scan: 0 },
    core: { color: C.cyanDeep, intensity: 0.2, rate: 0.05, mode: 'standby' },
    // Standby is carried by area, not by brightness: the traces along the chassis and the
    // vent ticks are the parts that are never occluded, so they are what says "powered,
    // idle" at a size where a 2 mm slit inside a closed housing simply cannot.
    channel: { color: C.cyanDeep, intensity: 0.34, speed: 0, mode: 'off' },
    vent: { color: C.cyanDeep, intensity: 0.26 },
    trim: { color: C.violetDeep, intensity: 0.07 },
    posture: { lean: 0.03, lift: -0.004, spread: -0.02, hold: 1 },
    micro: 0,
    track: 0,
    jaw: 0,
    label: 'dim cyan, shutters drawn to just under half, no motion at all',
  },
}

export const STATE_LOOK_KEYS = Object.keys(STATE_LOOK)

/* ------------------------------------------------------------------ *
 * Diagnostics overlay
 * ------------------------------------------------------------------ */

/**
 * The on-canvas readout (measured quality tier, part counts, live state look) is
 * real, but it is not part of a character reveal. `?ravenDebug=1` or
 * `localStorage['raven:diagnostics'] = '1'` brings it back.
 */
export function ravenDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('ravenDebug') === '1') return true
    return window.localStorage?.getItem('raven:diagnostics') === '1'
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Tonemapping — copied in behaviour, not in comment, from three.js
 * ------------------------------------------------------------------ */
const ACES_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
]
const ACES_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07277, 1.07197],
]

const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** three.js ACESFilmicToneMapping, including the 1/0.6 exposure scale. */
export function acesToneMap(r: number, g: number, b: number, exposure: number): [number, number, number] {
  let x = r * exposure * (1 / 0.6)
  let y = g * exposure * (1 / 0.6)
  let z = b * exposure * (1 / 0.6)
  let tx = ACES_IN[0][0] * x + ACES_IN[0][1] * y + ACES_IN[0][2] * z
  let ty = ACES_IN[1][0] * x + ACES_IN[1][1] * y + ACES_IN[1][2] * z
  let tz = ACES_IN[2][0] * x + ACES_IN[2][1] * y + ACES_IN[2][2] * z
  x = (tx * (2.51 * tx + 0.03)) / (tx * (2.43 * tx + 0.59) + 0.14)
  y = (ty * (2.51 * ty + 0.03)) / (ty * (2.43 * ty + 0.59) + 0.14)
  z = (tz * (2.51 * tz + 0.03)) / (tz * (2.43 * tz + 0.59) + 0.14)
  tx = ACES_OUT[0][0] * x + ACES_OUT[0][1] * y + ACES_OUT[0][2] * z
  ty = ACES_OUT[1][0] * x + ACES_OUT[1][1] * y + ACES_OUT[1][2] * z
  tz = ACES_OUT[2][0] * x + ACES_OUT[2][1] * y + ACES_OUT[2][2] * z
  return [sat(tx), sat(ty), sat(tz)]
}

/** three.js `SRGBColorSpace` output encoding. */
export function linearToSRGB(v: number): number {
  const c = sat(v)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}
