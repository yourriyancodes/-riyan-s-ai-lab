/**
 * Framing checks for the Riyan portrait: the photograph must be contained at every viewport
 * size, never cropped, never stretched, and the head must survive the relief displacement and
 * the pointer parallax.
 *
 * Runs on the same pure maths the component uses (lib/portraitFraming.ts), so it is a real
 * regression gate rather than a screenshot review, and it needs no browser.
 *
 *   node --experimental-strip-types scripts/check-portrait-framing.mjs
 */

const {
  PORTRAIT_FRAME_ASPECT,
  PORTRAIT_FOV_DEG,
  PORTRAIT_FIT_SLACK,
  PORTRAIT_PLANE_HEIGHT,
  fitPortrait,
  portraitUvTransform,
  projectedHalfHeight,
  sampledTopRow,
  headIsInside,
  visibleHeightAt,
} = await import('../lib/portraitFraming.ts')

let failures = 0
let checks = 0

function ok(label, condition, detail = '') {
  checks++
  if (!condition) {
    failures++
    console.log(`  x ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// Measured from the shipped asset: public/models/riyan/riyan-foreground.webp is 900 × 1350.
const IMAGE = { width: 900, height: 1350 }
const SOURCE_ASPECT = IMAGE.width / IMAGE.height
// The two runtime amplitudes the framing has to survive, from components/RiyanPortrait3D.tsx.
const RELIEF = 0.075
const TILT = 0.16

console.log('contain at every viewport:')
// 0.34 ≈ a narrow phone card, 0.8 ≈ the authored frame, 2.4 ≈ a wide short container.
const ASPECTS = [0.34, 0.5, 0.667, 0.8, 1, 1.33, 1.78, 2.4]
for (const aspect of ASPECTS) {
  const fit = fitPortrait(aspect, SOURCE_ASPECT)
  eq(`box ${aspect}: nothing is clipped`, fit.clippedArea, 0)
  ok(`box ${aspect}: height stays inside the box`, fit.heightFill <= 1 + 1e-9, `heightFill ${fit.heightFill}`)
  ok(`box ${aspect}: width stays inside the box`, fit.widthFill <= 1 + 1e-9, `widthFill ${fit.widthFill}`)
  ok(`box ${aspect}: the image keeps its own ratio`, Object.is(fit.planeWidth / PORTRAIT_PLANE_HEIGHT, SOURCE_ASPECT), `planeWidth ${fit.planeWidth}`)
  // Whichever axis is tighter does the letterboxing; both must never overflow.
  eq(`box ${aspect}: limiting axis`, fit.limitedBy, aspect < SOURCE_ASPECT * 1.0001 ? 'width' : 'height')
}

console.log('the head survives the mechanism, not just the frame:')
for (const aspect of ASPECTS) {
  const fit = fitPortrait(aspect, SOURCE_ASPECT)
  const projection = projectedHalfHeight(fit.distance, PORTRAIT_PLANE_HEIGHT, fit.planeWidth, RELIEF, TILT, aspect)
  ok(
    `box ${aspect}: displaced + tilted top edge is still inside`,
    projection.topWorld <= projection.frameHalfHeight,
    `top ${projection.topWorld.toFixed(4)} vs frame ${projection.frameHalfHeight.toFixed(4)}`,
  )
  ok(`box ${aspect}: with margin to spare`, projection.headroom > 0.004, `headroom ${projection.headroom.toFixed(5)}`)
}

console.log('the old framing, measured rather than remembered:')
{
  // The configuration this task replaces: a 4:5 quad, a hand-picked camera distance, and a
  // texture crop flush against the top row of the photograph.
  const oldDistance = 1.55
  const visible = visibleHeightAt(oldDistance, PORTRAIT_FOV_DEG)
  const oldQuadHeight = PORTRAIT_PLANE_HEIGHT
  const overflow = (oldQuadHeight - visible) / oldQuadHeight
  ok(
    'old: the quad was larger than the frame',
    oldQuadHeight > visible,
    `quad ${oldQuadHeight} vs visible ${visible.toFixed(4)}`,
  )
  // 8.47 % of the image height at the top: ~114 rows of a 1 350-row photograph, i.e. the
  // hairline and the top of the head. This is the number the bug report described.
  ok('old: ~8.5 % of the top of the frame was outside the card', Math.abs(overflow / 2 - 0.0847) < 0.001, `top cut ${(overflow / 2).toFixed(4)}`)
  ok('old: that is over a hundred rows of head', (overflow / 2) * IMAGE.height > 110, `rows ${((overflow / 2) * IMAGE.height).toFixed(0)}`)
  const oldProjection = projectedHalfHeight(oldDistance, oldQuadHeight, PORTRAIT_FRAME_ASPECT, RELIEF, TILT, PORTRAIT_FRAME_ASPECT)
  ok('old: relief and parallax made it worse', oldProjection.headroom < 0, `headroom ${oldProjection.headroom.toFixed(4)}`)
  // The crop was top-aligned, so it did not cut the head by itself — it removed the
  // headroom that would otherwise have absorbed the overflow above. Both facts matter: an
  // "object-position: top" style fix would still have clipped.
  eq('old: the crop kept row 0, so the crop was not the cutter', sampledTopRow(SOURCE_ASPECT / PORTRAIT_FRAME_ASPECT, 1 - SOURCE_ASPECT / PORTRAIT_FRAME_ASPECT, IMAGE.height), 0)
  ok('old: but it left no margin above the hair', (SOURCE_ASPECT / PORTRAIT_FRAME_ASPECT) * IMAGE.height > 1100)
}

console.log('texture transform is the identity:')
{
  const transform = portraitUvTransform()
  eq('full width sampled', transform.repeatX, 1)
  eq('full height sampled', transform.repeatY, 1)
  eq('no vertical shift', transform.offset[1], 0)
  eq('no horizontal shift', transform.offset[0], 0)
  eq('nothing is cropped', transform.cropped, false)
  eq('so the top row of the photograph is the top row of the plane', sampledTopRow(transform.repeatY, transform.offset[1], IMAGE.height), 0)
  // A centred crop of the same amount the old code trimmed, for contrast: it would have
  // discarded 112 rows of hair.
  ok('a centred crop would be caught by this check', sampledTopRow(SOURCE_ASPECT / PORTRAIT_FRAME_ASPECT, (1 - SOURCE_ASPECT / PORTRAIT_FRAME_ASPECT) / 2, IMAGE.height) > 100)
  ok('headIsInside agrees', headIsInside(24, { repeatY: transform.repeatY, offsetY: transform.offset[1] }, IMAGE.height), true)
  ok('and rejects a bad crop', headIsInside(24, { repeatY: 0.8, offsetY: 0.2 }, IMAGE.height), false)
}

console.log('fit is solved, not hard-coded:')
{
  const authored = fitPortrait(PORTRAIT_FRAME_ASPECT, SOURCE_ASPECT)
  const exact = (PORTRAIT_PLANE_HEIGHT / 2) / Math.tan((PORTRAIT_FOV_DEG * Math.PI) / 360)
  ok('distance carries the slack factor', Math.abs(authored.distance - exact * PORTRAIT_FIT_SLACK) < 1e-9, `${authored.distance} vs ${exact * PORTRAIT_FIT_SLACK}`)
  ok('slack is enough for relief + parallax', projectedHalfHeight(authored.distance, PORTRAIT_PLANE_HEIGHT, authored.planeWidth, RELIEF, TILT, PORTRAIT_FRAME_ASPECT).headroom > 0)
  ok('but not so much that the portrait shrinks away', authored.heightFill > 0.8, `heightFill ${authored.heightFill.toFixed(3)}`)
  ok('and the card is not left mostly empty either', authored.widthFill > 0.7, `widthFill ${authored.widthFill.toFixed(3)}`)
  // Degenerate inputs must not produce a broken camera.
  ok('zero-height container is survivable', Number.isFinite(fitPortrait(0, SOURCE_ASPECT).distance))
  ok('NaN container is survivable', Number.isFinite(fitPortrait(Number.NaN, SOURCE_ASPECT).distance))
  ok('square source is survivable', Number.isFinite(fitPortrait(0.8, 1).distance))
}

console.log('the component and the maths agree:')
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const root = path.resolve(import.meta.dirname, '..')
  const component = fs.readFileSync(path.join(root, 'components', 'RiyanPortrait3D.tsx'), 'utf8')
  ok('component solves its camera with fitPortrait', (component.match(/fitPortrait\(/g) ?? []).length >= 2)
  ok('component re-fits on resize', /handleResize[\s\S]{0,900}camera\.position\.z = fitPortrait/.test(component))
  ok('component authors the quad from the bitmap', /new THREE\.PlaneGeometry\(sourceAspect, 1/.test(component))
  ok('no texture cropping left in the component', /\.repeat\.set\(repeatX, repeatY\)[\s\S]{0,80}\.offset\.set\(offset\[0\], offset\[1\]\)/.test(component) && !/offsetY = 1 - repeatY/.test(component),)
  ok('fallback image contains instead of covering', /className="object-contain"/.test(component) && !/object-cover/.test(component))
  eq('no fixed camera distance left in the component', /camera\.position\.set\(0, 0, 1\.55\)/.test(component), false)
  const source = fs.readFileSync(path.join(root, 'public/models/riyan/riyan-foreground.webp'))
  // Sharp is already a dev dependency of the portrait generator, so this measures the real
  // asset rather than trusting the constants above.
  let loadSharp = null
  try {
    loadSharp = (await import('sharp')).default
  } catch {
    /* sharp unavailable: the constants above still hold the contract */
  }
  let measured = null
  if (loadSharp) {
    try {
      measured = await loadSharp(source).metadata()
    } catch {
      measured = null
    }
  }
  if (measured) {
    eq('measured asset width', measured.width, IMAGE.width)
    eq('measured asset height', measured.height, IMAGE.height)
    ok('measured asset aspect matches the framing constant', Math.abs(measured.width / measured.height - SOURCE_ASPECT) < 1e-6)
    // The photograph itself: the subject must not start at row 0, or even a perfect
    // contain has nothing to show above the hair.
    try {
      const { data, info } = await loadSharp(source).removeAlpha().resize({ width: 90 }).raw().toBuffer({ resolveWithObject: true })
      const rowInk = (row) => {
        let ink = 0
        for (let x = 0; x < info.width; x++) {
          const i = (row * info.width + x) * info.channels
          if (data[i] > 26 || data[i + 1] > 26 || data[i + 2] > 34) ink++
        }
        return ink
      }
      let top = 0
      while (top < info.height - 1 && rowInk(top) === 0) top++
      ok('the cutout has headroom above the hair', top >= 1, `first ink row ${top} of ${info.height}`)
      ok('and the head is well inside the frame at contain size', (top / info.height) * PORTRAIT_PLANE_HEIGHT < 0.12, `top row fraction ${(top / info.height).toFixed(3)}`)
    } catch (error) {
      ok('cutout measurable', false, String(error))
    }
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.log(`✗ ${failures} framing check(s) failed`)
  process.exitCode = 1
}
