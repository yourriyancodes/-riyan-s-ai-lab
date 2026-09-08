# RAVEN — the machine

How the thing on this page actually works. Everything below is what the code does today;
nothing here is aspirational.

RAVEN is not a person. There is no scanned face, no rigged body, no hair, no clothing and
no blendshape table anywhere in this repository. What renders is a synthetic humanoid
**machine** — head, neck, shoulders and upper chest — assembled from geometry in
`lib/ravenMachine.ts` and driven from the real state machine by `driveRavenMachine`. The
presentation goal is the one the brief set: *I am not a chatbot, I am an autonomous
engineering intelligence.* Powerful, cold, intelligent, imposing, unmistakably artificial.

## Why there is no model file

There used to be: `public/models/raven/raven.glb`, a 3.4 MB CC0 rigged human with 66 ARKit
facial morphs, loaded through a meshopt/WebP/quantization pipeline and driven by morph
targets. It was inspected before this rewrite, not skipped, and it cannot reach the target.
Every attempt to make it read as a machine produced the same object: a person wearing a
helmet, because the entire asset is a *face* — brows that raise, lips that part, skin that
blushes. Its material set has no roughness or occlusion maps, its hair is one alpha shell,
and its eyes are textured spheres. Those are human features with numbers attached; no
lighting rig turns them into an engineered head.

So the character is procedural. That is also what keeps the project at zero cost and zero
new dependencies: the only 3D library involved is `three`, already here for the portrait.

The retired pipeline is parked, not destroyed, in `.raven-data/legacy-glb-tools/`
(gitignored): the loader, the two GLB-only check scripts and the asset itself, with a
README explaining how to resurrect them and why they should not be. Audited again during the
cinematic redesign, because "is there a model file we should be using instead?" is the first
question a reviewer asks: `find` and `git ls-files` over the whole tree return **zero**
`.glb`, `.gltf`, `.fbx` or `.obj` files under version control, `public/models/` contains only
`riyan` (the portrait depth data), and `scripts/check-assets.mjs` fails the build if a shipped
character asset ever reappears. There is no mesh to preserve, no rig to re-target, and no
baked animation to keep — which is why the redesign is real sculpting in the builder rather
than a texture swap.

## How the bust is built

Nothing is a primitive. Every part is either a **loft** through an authored profile or a
**bevelled plate** extruded from a 2D shape:

| Helper | What it produces | Used for |
| --- | --- | --- |
| `loftGeometry(sections, { sides, flatness })` | a many-sided solid swept through radius/height sections, optionally flattened front-to-back | cranium, jaw shell, neck column, torso |
| `plateGeometry(shape, { depth, bevel, backInset })` | an extruded shape with a real bevel and a hollowed back, so plates sit *over* a surface instead of inside it | forehead, brow, visor bands, cheeks, temples, chin, pauldrons, sternum |
| `trapezoid` / `chamferedRect` | the 2D footprints the plates extrude from | every armour edge |
| `makeWeaveTextures()` | a procedural carbon-weave roughness + normal pair from a `DataTexture` | the shell surfaces, at medium/high tiers only |

The head is the priority, so it is where the part budget goes, and its loft is a **wedge,
not a barrel**: the widest band is the upper cranium (107 mm half-width at the parietals)
and the profile narrows to a 40 mm jaw root, with the whole skull scaled 1.16 × 1.10 so the
mass sits above the face. Constant width from ear to crown is what reads as a helmet.
From the outside in: a lofted skull in eight flat panels; a layered forehead of **three**
stepped plates with a matte keyway over the midline; a **visor split into two bands** above
and below the eyes; recessed sensor housings bored 36 mm into a mask plate, each with a
matte four-wall bore, a bright lintel over a *dark* sill, a shutter that slides across the
aperture, and an emissive slit (58 % of the slot's span) with a 1.6 mm filament at its
centre; cheek plates over a matte gutter so the zygomatic line casts a shadow; three
temple lamellae per side stepping down and back; mastoid vanes; a five-bar grille over a
heat-exchanger cavity under a **plate → dark gap → three-segment mandible** stack. The neck
is a fluted column (six machined ribs) inside an alternating bearing stack that tightens
toward the atlas, with encoder ticks on the driven ring and two emissive conduits running up
the front into the skull base; two carbon-sheathed cables run behind the head into the chest
— those cables are the head's feed, which is why the core's energy channels point *down*
into the structure instead of floating around.

The chest is a **neural package**, not a reactor: a 55 mm hexagonal collar with a 0.8 mm
matte gap under it, an inner hex socket, six interposer pads in `plate` (one metallic edge
each), eight via studs, two hexagonal retaining rings that counter-rotate, a flat hexagonal
die 4.5 mm inside the bore, three louvres and a two-bar lattice *in front* of the die, and
six right-angled data traces that carry the state's flow outward along the substrate. There
is not a circle in the assembly. The reason for the lattice and the pads is attention: with
the emitter as the brightest element, the eye lands on a glowing disc and the read is
"Iron Man"; with the *housing* brightest and the emission found through structure, the read
is a processor doing work.

Three asymmetric marks are placed on purpose — an encoder ridge on the left temple, a spare
heat-sink slat on the right mastoid, one scored line on the left pauldron. Perfect symmetry
on every axis reads as CAD default; these three read as something that was built, and they
survive at thumbnail size.

Two construction facts are load-bearing, because both were bugs found by rendering:

- **The visor cannot be a solid plate.** A plate in front of an emitter either buries the
  emitter or forces it outside the housing; whichever eye won the depth test survived, so
  the face rendered with one eye. The bands frame the aperture instead.
- **A bore cannot be a `BoxGeometry`.** A box has a front face; the box that was supposed to
  be the sensor cavity was a closed lid painted matte black, and the eye inside it could
  never be seen. The recess is now four walls plus a back plane.

Materials are six surfaces (`SURFACES` in `lib/ravenStudio.ts`): gunmetal `#151a21`,
brushed titanium `#5f6875`, matte black mechanical, carbon weave, and an edge trim
`#7f8b9d` used only for seams about 1.5 mm wide. Dark metal covers the bust; emissive
elements are small and *contained*, each inside a housing, a duct or a recess. The
ceilings that enforce that are data, not vibes:

```
eye 1.15 · eyeCore 1.5 · core 1.1 · channel 1.1 · vent 0.8 · trim 0.85  (max 1.5 overall)
```

`npm run check:machine` fails if any state asks for more than its family's ceiling, and
the rendered check fails if the lit area of a frame exceeds 5% of it. Measured on the
current geometry, the emissive area of a hero frame is **0.10%** idle and **0.17%** while
executing. The reactor in the chest is a 21 mm kernel set 3.5 mm inside a hexagonal socket
under three machined louvres — not a glowing disc on the sternum, which is what the first
version was and what the brief forbids.

## The cinematic redesign: silhouette first, one signature, then restraint

The previous round of this bust earned two criticisms that no amount of relighting could
fix: the head had no skull under it (a plateau where the cranium should be, a jaw that went
straight into the neck) and *everything glowed* (two bright slits, four forehead ticks, a
40 mm hexagon on the chest, so the face had no single focus). The redesign therefore started
from anatomy and ended by removing lights:

- **Cranium.** The skull plate is now a nine-section keel loft swept from a 34 mm chin root
  through an 84 mm zygomatic arch to 99 mm at the parietals and back to a 33 mm keel, with a
  crown keel plate, two swept parietal shells and two temporal crest fins replacing the old
  plateau and its ladder of rungs. The seat the skull sits in dropped 8 mm and the skull
  itself is scaled 1.16 / 1.04 / 1.03 to compensate, so the head reads as a *head* carried by
  a chassis instead of a box on a spring.
- **One optical band.** The face is one instrument: a matte `visor.duct` cut across it, a
  continuous overhanging cowl above (with two wing plates at 7.5° so the brow is a shallow
  chevron and not one more horizontal bar), a lower rail cut on the reverse angle, and inside
  the duct two apertures at 54.5 × 7.2 mm bored 36 mm deep with two fixed inner ducts. Four
  emissive segments, one expression — the drive moves all four together, which is the point.
  The shutters that blink are now `matte` and park *outside* the window, because a bright
  closed lid next to a glowing aperture is two objects where there should be one. The two
  forehead trim ticks were deleted: the band is the only light on the face.
- **Jaw and chin.** `jaw.edge` became titanium and shrank, the jaw pivots became `plate`, two
  gonial wedges and a pointed chin (34 mm tapering to 16 mm) were added, so the jaw line
  survives against a dark card.
- **Shoulders, neck, core.** Three dished pauldron tiers, each rotated a few degrees more than
  the one above (that stack-with-rotation is what "articulated" means geometrically), a bolted
  pivot boss with a machined collar, two short cables per side, and a span cut from 0.5049 m
  to 0.4513 m because wide flat slabs read as bulk. A collar yoke and trapezius risers tie the
  neck into the chassis, with the bearing rings hugging the atlas pivot. The chest core went
  the other way: housing bored 34 mm deep, frame from 0.111 m to 0.094 m across, emitter from
  20 mm to 16 mm, four chevron plates converging on it — a component installed in a structure
  rather than a logo applied to one.
- **Motion.** Head, sensors and apertures are encoder-quantised (6 mrad steps) with a lag chain
  (head 9.5 s, torso 4.5 s, core 6 s), servo micro-correction at 0.37° full scale, and an idle
  "breath" that is *not* a sine: a slow wave quantised into three detents, driving spread, lift
  and a counter-lean, so the plates tick over and hold. Slaved to the core pulse on purpose —
  the light and the chassis move as one machine.

Nothing in this section is expressed as a shader trick. It is all authored geometry in
`lib/ravenMachine.ts` with the numbers in `lib/ravenStudio.ts`, because the alternative — a
purchased character file — is what the brief forbids and the asset gate enforces (see
*Why there is no model file*).

## Materials and light: the anti-toy pass

The first version of this bust was called "a toy robot" while every part in it was
authored geometry, and the reason was not the geometry — it was the sheen. The shell was
roughness 0.36 with clearcoat 0.42 under a 0.95 environment, which is the material recipe
for a lacquered action figure. So the surface set is now:

| Surface | Roughness | Clearcoat | IBL | What it is for |
| --- | --- | --- | --- | --- |
| `shell` | 0.50 | 0.16 @ 0.62 | 0.75 | black chrome: a thin *rough* lacquer over near-black metal, weave map breaking the highlight |
| `plate` | 0.74 | 0.04 | 0.50 | the layered plates, a step darker so the layering reads as thickness |
| `titanium` | 0.50 | — | 0.62 | brushed machined metal, anisotropic, only where a part is *structural* |
| `trim` | 0.40 | — | 0.58 | plate edges; the brightest metal on the entity, and rare |
| `matte` | 0.96 | — | 0.12 | seams, bores, gutters, and now the visor duct and the blink shutters — the reason anything else looks assembled |

Palette is the page's own, lifted by one stop: the albedos are `#0F141B` / `#0A0D12` /
`#414A56` rather than the raw background swatches, because a metal with `#05070A` in its
albedo reflects almost nothing and photographs as a silhouette. `#00E5FF` is still the only
energy colour, `#8B5CF6` a secondary voice that now appears as a *bounce* and in the
REASONING/PLANNING states rather than as lit lines on the face, and `#FF5A3D` is reserved
for WARNING. Chrome is not a material here — `edgeTrim` is the brightest fixed colour and it
is dimmed by the environment rather than by a light.

The rig follows from the same rule: light exists to reveal the geometry and nothing else.
Key 2.62 cool-neutral from upper camera-left, cyan rim 2.05 from behind-left (the separation
light, strong enough to lift the silhouette off `#05070A` and not strong enough to colour the
metal), violet **bounce** 0.5 low-right — a bounce, not a violet key, which is why it reads as
a reflection rather than a neon sign — a 0.13 under-jaw fill so a matte head does not lose its
chin line against a dark card, warm counter 0.12, ambient 0.045, and the core's own point light
at 0.10 over an 0.16 m range so the processor washes the plates around it instead of casting a
halo. Exposure 0.84, environment intensity 0.78. What that measures on the dark theme at hero
framing: luma p50 0.027 / p95 0.096 / p995 0.331 with **zero** clipped pixels — mostly dark
planes, a handful of controlled highlights, and nothing anywhere near white except the band.

## Voice: one controller, one voice

`lib/ravenVoice.ts` is the only module in the app allowed to touch `speechSynthesis`; the
answers (`lib/ravenStore.ts`) and the welcome greeting (`components/CinematicIntro.tsx`) are
callers, not managers. This exists because two components each resolving their own voice was
the actual cause of RAVEN alternating between a male and a female voice:

- **Selection** is a pure score (`resolveRavenVoice`) over a ranked name table
  (`PREFERRED_RAVEN_VOICES`, feminine and calm voices first) with a locale preference, a hard
  veto on masculine names, and a tie-break on the name itself. Never array position, never
  `Math.random()`, so the answer cannot depend on what order the browser listed voices in.
  Gender is matched on **tokens**, not substrings — `"female"` contains `"male"`, and a naive
  substring veto would disqualify every feminine voice on Windows.
- **One voice per session**: the resolved voice is cached and reused; it is re-resolved only if
  that voice disappears from the list. `ravenVoiceState().source` reports which rule chose it,
  including the honest `masculine-only` case on a platform with nothing else in English.
- **Never the default by accident**: `speakRaven` awaits `voicesReady()` (bounded by
  `voiceWaitMs`) because `getVoices()` is empty on Chrome's first tick — the old code spoke
  with the default voice for exactly that first utterance and with a preferred one afterwards.
- **Overlap and duplicates**: every request carries a generation id, `cancel()` always precedes
  `speak()`, and a superseded request's `onend`/`onerror`/`onboundary` are dropped, so "A is
  speaking, B arrives" means A stops, A's late callbacks are inert and B speaks once. A stall
  timer guarantees `onDone` fires even if the browser forgets to end an utterance, so the UI can
  never be left in SPEAKING. Muting and sending a new message both interrupt immediately.
- **One listener**, reference-counted, removed by `resetRavenVoice()` — Strict Mode's double
  effect run cannot stack `voiceschanged` handlers.
- **Prosody is fixed and conservative**: rate 1.02, pitch 1.06, volume 0.92.

`npm run check:voice` (92 checks) runs all of this against seven fake platform voice lists and
a fake engine, including the order-independence and supersession assertions. Lip-sync remains
`lib/speechSync.ts`, fed by boundary events; the jaw driver now starts when audio starts.

## State → visual mapping

`STATE_LOOK` in `lib/ravenStudio.ts` is the whole mapping. It covers exactly the sixteen
states the brain emits — IDLE, LISTENING, UNDERSTANDING, THINKING, RESEARCHING, REASONING,
PLANNING, EXECUTING, VERIFYING, SPEAKING, VISION, WAITING, SUCCESS, WARNING, ERROR,
OFFLINE — with no invented states and no timers that decide to flash. An unknown state
string falls back to IDLE's look rather than guessing.

| State | Sensors | Core | Channels | Character of it |
| --- | --- | --- | --- | --- |
| `IDLE` | cyan 0.44, narrowed 0.46 | breathe 0.16 Hz | 0.3 @ 0.12 | calm, awake, doing nothing — deliberately the dimmest state there is |
| `LISTENING` | cyan 0.86, wide 0.80 | accelerate 0.28 | 0.55 @ 0.5 | aperture open, shutters retracted, tracking gain 1.0 |
| `UNDERSTANDING` | cyan 0.68 | accelerate 0.40 | 0.62 @ 0.72 | parsing |
| `THINKING` | cyan 0.92 | accelerate 0.86 | 0.72 @ 0.95 | faster scan sweep, brightest optical activity outside EXECUTING |
| `RESEARCHING` | cyan 0.74 | accelerate 0.60 | 0.8 @ 1.25 | retrieval running |
| `REASONING` | **violet** 0.96, white-hot filament | layered 1.05 Hz | 0.8 @ 1.6 | two counter-rotating gimbal rings visible; violet costs luma (Rec.709 weights blue at 0.072), so the violet states are driven harder than the cyan ones and the filament stays white |
| `PLANNING` | violet 0.88, shuttered 0.12 | layered 1.28 | 0.74 @ 1.9 | deliberating, apertures narrowing |
| `EXECUTING` | cyan 1.00, wide 0.88 | **drive** 2.1 Hz | 1.0 @ 3.4 | brightest flow, tools running |
| `VERIFYING` | **white** 0.90, aperture 0.94 | focus 0.5 | 0.5 @ 0.25 | held, scan off — checking, not searching |
| `SPEAKING` | cyan 0.88 | drive 0.9 | 0.8 @ 1.1 | jaw follows measured speech energy |
| `VISION` | cyan 0.82, wide 0.86 | accelerate 0.55 | 0.7 @ 0.9 | tracking gain 1.0, camera feed active |
| `WAITING` | cyan 0.54, shuttered 0.26 | breathe 0.26 | 0.3 @ 0.2 | patient, micro-adjustments most visible |
| `SUCCESS` | cyan 0.95 | accelerate 1.4 | 0.9 @ 1.6 | one settled pulse, no confetti |
| `WARNING` | **ember** 0.80 | alert 1.15 | 0.75 @ 1.2 | restrained red-orange, no strobe |
| `ERROR` | red 0.85, shuttered 0.20 | alarm 1.65 | 0.6 @ 0.4 | alarm cadence only in the core |
| `OFFLINE` | dim teal 0.46, shuttered 0.44 | standby 0.05 | 0.34 @ 0 | shutters drawn to just under half; standby is carried by **area** — the chassis traces and vent ticks that no shutter can occlude — because a 2 mm slit inside a closed housing cannot read at 360 px |

Nothing random is layered on top. `scan` (the sensor sweeping its own travel) exists only
because LISTENING and VISION really are sampling states, and it stops when the stage is
inactive or off-screen — asserted in `scripts/check-machine-render.mjs`.

## Interaction: machine awareness, not eye contact

There is no eye tracking of the user and no gaze-at-cursor mimicry. What there is:

- **Pointer awareness.** The pointer offset (or the head-tracker depth from the camera, when
  vision is enabled) drives head yaw/pitch and a *separate*, larger rotation of the sensor
  pods and their shutters, so the optics lean toward something before the head does. Gain:
  0.55 in most states, 1.0 while LISTENING/VISION, 0 while OFFLINE.
- **An encoder, not a smooth servo.** Orientation is quantised to `MOTION.encoder` (0.006
  rad) and damped with `headLag` 9.5, so the head arrives in small steps and settles, like
  hardware with a position loop. Limits: yaw ±0.2 rad, pitch ±0.12 rad.
- **Micro-adjustment.** A held position drifts by up to 0.0075 rad every 2.2–5.4 s and
  re-corrects — a servo maintaining a pose, not breathing.
- **Speech.** The jaw grille opens from measured `speechSynthesis` energy and the openness
  table in `lib/speechSync.ts`; the aperture and the vents pulse with it. When nothing is
  speaking there is nothing to follow, and the jaw stays shut.
- **State transitions are mechanical events.** Each change re-seats the mastoid vanes and
  takes one small head correction over 0.42 s, once — not on a loop.

`prefers-reduced-motion: reduce` removes drift, sway, scan, dust and the intro's motion;
the *state* still reads, because then the only signal left is the one that matters.

## Framing, and how it is verified

`framingFor()` solves the crop from the **measured** bounding box of what was actually
built — `hero` targets 74% of frame height at a 24° lens (a long lens flattens a mechanical
face into something monumental; a wide one makes it a toy), `stage` 66% at 30°. Both aim
55 mm and 30 mm *below* the measured bust centre respectively, which is the whole portrait
decision: the bust's centre of mass is chest height, the optical band is 94 mm above it, and
aiming under the centre is what puts the face in the upper third and lets the card crop the
torso. That is a head-and-shoulders shot, not a product spin of a whole object. Narrow
viewports get a wider crop, never a zoom, so the pauldrons stay inside the frame on a phone.
Max coverage is capped so the bust cannot touch the edges, and zero clipped pixels is asserted
so no plate ever blows out to white.

Two scripts hold this line, and both run in CI-able time without a browser or GPU:

```bash
npm run check:machine      # 38 assertions: assembly, part inventory, 16×400-frame drive, rendered pixels
npm run preview:machine    # writes a PNG you can look at
```

`scripts/render-machine-preview.mjs` is a CPU rasteriser of the real scene graph — same
`buildRavenMachine()` output, a z-buffer painter, back-face culling, instanced-mesh
expansion, 90 settling frames, ACES in `lib/ravenStudio.ts` and PNG out through `sharp`.
It exists because "I think it looks good" is not a test. Flags: `--state --theme --variant
--quality --time --width --height --out --pointer --speaking`, plus `--crop 0.24`
to frame the head alone (the crop is centred by the framer, so there is no aim flag — an
`--aim` that only the preview understood was exactly the kind of divergence this script
exists to catch, and it is gone). Approximations it admits to: Blinn-Phong rather than GGX, a flat
IBL rather than PMREM, no clearcoat.

The checks in `check-machine-render.mjs` are the ones worth naming: every named part exists
at every tier; triangle budgets per tier (12 700 high / 11 400 medium / **6 300** low). The
two upper numbers moved because the redesign spent them where the brief asked for detail —
cranium shells, the cowl, three-tier pauldrons, the chevron stack — while the *phone* tier
went **down**: `low` builds without the pauldron gap plates, the trapezius risers, every
cable, and swaps chamfered extrusions for boxes on the sub-5-pixel hardware inside the
optics (5 966 triangles, from 6 300). That is the honest meaning of adaptive quality: the
tier that costs a device something loses the detail that costs the eye nothing. Height is
0.4681 m and no taller (a body creeping back in is a *design* regression) and the shoulder
span is 0.4513 m — 0.965× the height. The old ratio was 1.13× and the comment here called
that "a platform on purpose"; the redesign deliberately reversed that call, because wide flat
slabs are what made the previous bust read as bulk under a small head, and the frame is a
portrait now, where the shoulders are cropped by the card anyway. The gate therefore asserts
coverage against the *frame* (max 0.86 + 0.06) rather than a fixed width/height ratio, which
is the thing that actually matters; zero clipped pixels; lit area under 5% of the frame
(IDLE measures 0.076%); pointer input changes the rendered frame hash; reduced motion freezes
the mechanism; an inactive stage accumulates nothing. The "is anything actually lit" floor is
per-state, and the reason is worth keeping in the repo: the first version of that assertion
used one bright-and-saturated pixel test for all sixteen states, which OFFLINE cannot pass by
construction — it is *authored* to be the dimmest state. So the raster now reports
`standbyPixels` (hue far from grey, at any brightness) alongside `emissivePixels`, and the
offline state is measured against that. The model was then changed until it passed honestly:
standby light moved out of the occluded optics and onto the traces and vents, which is both
what the gate asks for and the better picture of a machine that is powered but idle.

`npm run check:assets` audits the other half: no shipped code may reference the retired
avatar, nothing may serve a character asset, all RAVEN visuals must come from
`buildRavenMachine` + `driveRavenMachine`, no R3F render path may be added next to the
manual renderer, and no asset marketplace or named IP may appear in code or UI copy.

## Performance

Startup tier comes from `hardwareConcurrency`, `deviceMemory`, `(pointer: coarse)` and
viewport width. It sets DPR cap, antialiasing, the IBL, dust count and the geometry tier —
`high` / `medium` / `low` change segment counts, texture generation, the per-eye point
lights and the number of secondary plates. **They never change the silhouette**, which is
what makes "simplified on mobile" mean the same design rather than a different object.

A rolling 48-frame sample then acts on what it measured, in the order that costs the user
least: DPR down by 20%, then the dust field off, then — only if it is still over ~45 ms —
a rebuild at the next tier down. There is no post-processing pass of any kind: no bloom, no
DOF, no SSAO. Emissive surfaces read as emissive because the tone mapper's exposure is set
below their clip point, not because a blur was stacked on top. Rendering stops when the
stage leaves the viewport or the tab hides, the context is force-released on unmount, and a
lost context pauses the stage instead of throwing. The `high` build reports 12 646 triangles
across 231 meshes and 150 named parts — 6 128 of them reach the rasteriser at hero framing
after back-face culling — while `medium` reports 11 250 and `low` 5 966. Each glow family is a
single `InstancedMesh`, so ~90 animated segments cost three draw calls, and the 11 materials
are shared by every plate that uses them.

## The portrait of Riyan

`components/RiyanPortrait3D.tsx` is not the machine: it is the real photograph on a
displaced plane. `public/models/riyan/README.md` documents the deterministic local pipeline
**Framing rule: contain, never crop.** The card is a 4:5 box, but the photograph is not
authored into it any more — the plane is built at the *bitmap's own* aspect ratio and the
camera distance is solved from the projection on every resize (`lib/portraitFraming.ts`).
That replaced a real bug: a height-1 quad in front of a `PerspectiveCamera(30°)` at `z = 1.55`
shows only 0.83 units, so ~8.5 % of the top of the image (≈114 rows of 1 350) sat outside the
card and `overflow-hidden` cut the hair — by a different amount at each viewport size. The
texture transform is now the identity (`portraitUvTransform()`), which is asserted, along with
the relief (0.075) and parallax (0.16 rad) still fitting inside the frame at box aspects from
0.34 to 2.4, by `npm run check:framing`. The no-WebGL `<Image>` fallback uses
`object-contain` for the same reason `cover` was wrong: it disagreed with the 3D stage about
what was visible.

(`npm run gen:portrait`) that produces the cutout and the depth proxy, including the
distance-transform selftest that the pipeline runs before it writes anything. If WebGL or
the assets are unavailable it shows the original photo in the same frame and says so — it
never fakes depth.

One texture fact owns this component, and it cost a full round of "the asset is upside
down": **`Texture.flipY` is ignored for `ImageBitmap` sources.** three's own docs say so —
"this property has no effect when using `ImageBitmap`" — and the loader here builds bitmaps
with `createImageBitmap`, so the default flip that `PlaneGeometry`'s v-up UVs assume never
happened and the photograph rendered mirrored. The fix is at upload time, on the bitmap:
`createImageBitmap(blob, { imageOrientation: 'flipY' })`. Three consequences, all asserted
by the 13th check in `check-assets.mjs`:

- the **foreground** flips (it goes to the GPU);
- the **depth proxy** does *not*, because it is sampled by CPU code (`readLuminance`) that
  indexes rows top-down — flipping both maps cancels the relief and puts the forehead on the
  chin;
- the **contact-shadow** `CanvasTexture` gets an explicit un-flip in its own 2D context,
  because canvas-drawn sources *do* honour `flipY`, unlike bitmaps.

The source asset was never touched. The guard compares the vertical ink profile of the
cutout against the source photograph decile by decile, so an inversion can only come back
by re-breaking runtime config, and if it does the check names the decile that moved.
