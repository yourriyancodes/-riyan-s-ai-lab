// Offline asset generator for the 3D Riyan portrait.
//
// Produces, from public/riyan-portrait.png (a studio shot on a pure black
// background):
//   public/models/riyan/riyan-foreground.webp  alpha-matted subject (RGBA)
//   public/models/riyan/riyan-depth.png        grayscale depth proxy
//   public/models/riyan/_debug-*.png            inspection only (not imported)
//
// Tooling: `sharp` only (MIT). Install it ad-hoc when regenerating:
//   npm i --no-save sharp && node scripts/generate-portrait-depth.mjs
// No generative model is used: the colour pixels are the original photograph,
// the alpha is background segmentation, and the depth is geometry-derived
// (silhouette curvature + forward-facing skin regions). Re-run with:
//   node scripts/generate-portrait-depth.mjs
let sharp
try {
  ;({ default: sharp } = await import('sharp'))
} catch {
  console.error(
    [
      'sharp is not installed — it is a dev-time tool only, never imported by the app.',
      'Install it without touching package.json, then re-run:',
      '',
      '  npm i --no-save sharp',
      '  node scripts/generate-portrait-depth.mjs',
      '',
      'Nothing in public/models/riyan was regenerated or deleted.',
    ].join('\n'),
  )
  process.exit(1)
}
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'public/riyan-portrait.png')
const OUT = join(ROOT, 'public/models/riyan')
// Solve and emit at display*2 resolution: the mask must not be upsampled,
// or the cutout arrives blocky.
const ANCHOR = 900
// --selftest: validate the distance transform on a synthetic disc before trusting it.
const selftest = process.argv.includes('--selftest') || process.env.RAVEN_PORTRAIT_SELFTEST === '1'

mkdirSync(OUT, { recursive: true })

const srcMeta = await sharp(SRC).metadata()
const scale = ANCHOR / srcMeta.width
const HW = Math.round(srcMeta.height * scale)

// ---------- 1. load at solve resolution ----------
const { data, info } = await sharp(SRC)
  .resize({ width: ANCHOR, height: HW, fit: 'inside' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const W = info.width
const H = info.height
const px = (x, y) => (y * W + x) * 4
const luma = new Float32Array(W * H)
const maxc = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) {
  const o = i * 4
  const r = data[o], g = data[o + 1], b = data[o + 2]
  luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
  maxc[i] = Math.max(r, g, b)
}

// ---------- 2. background = near-black pixels connected to the border ----------
// The studio background is pure #000000, so this stays tiny on purpose: a loose
// threshold lets the flood leak *into* the dark pinstripes of the suit.
const NEAR_BLACK = 4
const bg = new Uint8Array(W * H)
const stack = new Int32Array(W * H)
let sp = 0
const seed = (i) => {
  if (!bg[i] && maxc[i] <= NEAR_BLACK) {
    bg[i] = 1
    stack[sp++] = i
  }
}
for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
while (sp > 0) {
  const i = stack[--sp]
  const x = i % W
  const y = (i / W) | 0
  if (x > 0) seed(i - 1)
  if (x < W - 1) seed(i + 1)
  if (y > 0) seed(i - W)
  if (y < H - 1) seed(i + W)
}

const fg = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) fg[i] = bg[i] ? 0 : 1

// single 3x3 majority vote: removes speckle left by stripe-level thresholding
{
  const cleaned = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0, t = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          n += fg[yy * W + xx]; t++
        }
      }
      cleaned[y * W + x] = n / t > 0.5 ? 1 : 0
    }
  }
  fg.set(cleaned)
  for (let i = 0; i < W * H; i++) bg[i] = fg[i] ? 0 : 1
}

// fill enclosed holes (pinstripe gaps, shadow pockets) so the cutout is solid
const hole = new Uint8Array(W * H)
sp = 0
for (let x = 0; x < W; x++) if (fg[x]) { hole[x] = 1; stack[sp++] = x }
for (let x = 0; x < W; x++) if (fg[(H - 1) * W + x]) { hole[(H - 1) * W + x] = 1; stack[sp++] = (H - 1) * W + x }
for (let y = 0; y < H; y++) { if (fg[y * W]) { hole[y * W] = 1; stack[sp++] = y * W }; if (fg[y * W + W - 1]) { hole[y * W + W - 1] = 1; stack[sp++] = y * W + W - 1 } }
while (sp > 0) {
  const i = stack[--sp]
  const x = i % W, y = (i / W) | 0
  const tryPush = (j) => { if (!bg[j] && !hole[j]) { hole[j] = 1; stack[sp++] = j } }
  if (x > 0) tryPush(i - 1); if (x < W - 1) tryPush(i + 1)
  if (y > 0) tryPush(i - W); if (y < H - 1) tryPush(i + W)
}
for (let i = 0; i < W * H; i++) if (bg[i] || hole[i]) fg[i] = bg[i] ? 0 : 1

// ---------- 3. exact EDT of the foreground = distance to the silhouette edge ----------
// Two-pass Felzenszwalb & Huttenlocher distance transform: for every pixel the exact
// squared Euclidean distance to the nearest seed, via a lower envelope of parabolas.
// (Passes use separate in/out arrays and a full W*H intermediate: doing this in place
// or with a row-length scratch buffer silently corrupts the result.)
const INF = 1e20
const solveEnvelope = (f, n, v, z, out) => {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (k > 0 && s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    v[++k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const p = v[k]
    out[q] = (q - p) * (q - p) + f[p]
  }
}

const edtSquared = (seeds) => {
  const d1 = new Float32Array(W * H)
  const row = new Float32Array(W)
  const rowOut = new Float32Array(W)
  const v = new Int32Array(W + 2)
  const z = new Float32Array(W + 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) row[x] = seeds[y * W + x] ? 0 : INF
    solveEnvelope(row, W, v, z, rowOut)
    d1.set(rowOut, y * W)
  }
  const out = new Float32Array(W * H)
  const col = new Float32Array(H)
  const colOut = new Float32Array(H)
  const vc = new Int32Array(H + 2)
  const zc = new Float32Array(H + 3)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = d1[y * W + x]
    solveEnvelope(col, H, vc, zc, colOut)
    for (let y = 0; y < H; y++) out[y * W + x] = colOut[y]
  }
  return out
}

// seeds = everything that is NOT the subject (including the padded border)
const outside = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) outside[i] = fg[i] ? 0 : 1
const distSqOut = edtSquared(outside)
let maxD = 1e-6
for (let i = 0; i < W * H; i++) if (fg[i] && distSqOut[i] < INF) maxD = Math.max(maxD, distSqOut[i])
const curvature = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) {
  if (!fg[i]) continue
  const d = distSqOut[i]
  curvature[i] = d >= INF ? 0 : Math.sqrt(d / maxD)
}
if (selftest) {
  // Validate edtSquared against a brute-force nearest-seed search on a synthetic disc.
  // seeds = everything outside a disc, so the disc interior must measure ~R and be
  // exactly left/right symmetric. Both properties fail if the two passes alias buffers.
  const R = 40
  const cx = (W - 1) / 2
  const cy = (H - 1) / 2
  const disc = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      disc[y * W + x] = Math.hypot(x - cx, y - cy) <= R ? 0 : 1 // 1 == seed (outside)
  const dd = edtSquared(disc)
  // integer coordinates only: the transform is defined per pixel, so the reference
  // search has to use the same pixel centres or it disagrees by up to sqrt(0.5).
  const ix = Math.floor(cx), iy = Math.floor(cy)
  const at = (x, y) => Math.sqrt(dd[y * W + x])
  const centre = at(ix, iy)
  const samples = [[ix, iy], [ix - 30, iy + 12], [ix + 8, iy - 37], [ix - 39, iy - 6], [ix + 39, iy + 30], [ix - 4, iy + 39]]
  let worst = 0
  for (const [sx, sy] of samples) {
    let best = Infinity
    for (let y = 0; y < H; y++) {
      const dy = y - sy
      for (let x = 0; x < W; x++) {
        if (!disc[y * W + x]) continue
        const dx = x - sx
        const d = dx * dx + dy * dy
        if (d < best) best = d
      }
    }
    worst = Math.max(worst, Math.abs(Math.sqrt(best) - at(sx, sy)))
  }
  let asym = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) asym = Math.max(asym, Math.abs(at(x, y) - at(W - 1 - x, y))) // disc is centred between columns
  console.log(`selftest EDT: centre ${centre.toFixed(2)} (expect ~${R}), max error vs brute force ${worst.toFixed(4)}, L/R asymmetry ${asym.toFixed(4)}`)
  if (Math.abs(centre - R) > 2 || worst > 1e-3 || asym > 1e-3) throw new Error('distance-transform selftest FAILED')
  console.log('selftest EDT: OK')
}

// ---------- 4. forward-facing skin (face + hands) sits in front of the torso ----------
const skin = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) {
  const o = i * 4
  const r = data[o], g = data[o + 1], b = data[o + 2]
  const warm = r > 80 && r > b + 12 && g > b - 6 && r >= g && Math.abs(r - g) < 90
  skin[i] = fg[i] && warm ? 1 : 0
}

// smooth helper (separable box blur, few passes == gaussian-ish)
const blur = (src, radius, passes = 3) => {
  let cur = Float32Array.from(src)
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k
          if (xx < 0 || xx >= W) continue
          s += cur[y * W + xx]; n++
        }
        tmp[y * W + x] = s / n
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k
          if (yy < 0 || yy >= H) continue
          s += tmp[yy * W + x]; n++
        }
        cur[y * W + x] = s / n
      }
    }
  }
  return cur
}

const skinSoft = blur(skin, 6, 4)

// ---------- 5. compose depth ----------
// A standing person seen head-on: rounded cross-section (curvature), head and hands
// nearer than the torso (skin), feet slightly further away (upright).
const depth = new Float32Array(W * H)
for (let y = 0; y < H; y++) {
  const vy = 1 - y / (H - 1) // 1 at the top of the frame
  const drop = 1 - vy // 0 at the top, 1 at the feet
  for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (!fg[i]) { depth[i] = 0; continue }
    const body = 0.30 + 0.30 * curvature[i]
    const forward = 0.34 * Math.min(1, skinSoft[i] * 1.5)
    depth[i] = Math.max(0, Math.min(1, body + forward - 0.05 * drop))
  }
}
const depthSmooth = blur(depth, 2, 2)

// ---------- 5b. optional per-term dump so the shading can be eyeballed ----------
if (process.env.RAVEN_PORTRAIT_DEBUG === '1') {
  const grey = async (name, arr) => {
    const buf = new Uint8Array(W * H * 3)
    for (let i = 0; i < W * H; i++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, arr[i] || 0)))
      buf[i * 3] = buf[i * 3 + 1] = buf[i * 3 + 2] = v
    }
    await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`/tmp/dbg-term-${name}.png`)
  }
  await grey('curvature', curvature)
  await grey('skin', skinSoft)
  await grey('depth', depthSmooth)
  console.log('wrote /tmp/dbg-term-*.png')
}

// ---------- 6. feathered alpha ----------
const alpha = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) alpha[i] = fg[i] ? 1 : 0
const alphaSoft = blur(alpha, 1, 2)

// ---------- 7. write outputs ----------
const toGray = (arr) => {
  const buf = Buffer.alloc(W * H)
  for (let i = 0; i < W * H; i++) buf[i] = Math.round(Math.max(0, Math.min(1, arr[i])) * 255)
  return buf
}
await sharp(toGray(depthSmooth), { raw: { width: W, height: H, channels: 1 } })
  .png()
  .toFile(join(OUT, 'riyan-depth.png'))
console.log(`depth ${W}x${H}, alpha+colour baked at native solve size`)

const out = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) {
  const o = i * 4
  // preserve the photograph exactly; only alpha is authored
  out[o] = data[o]
  out[o + 1] = data[o + 1]
  out[o + 2] = data[o + 2]
  out[o + 3] = Math.round(Math.max(0, Math.min(1, alphaSoft[i])) * 255)
}
await sharp(out, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 90 })
  .toFile(join(OUT, 'riyan-foreground.webp'))

// debug sheets (written to /tmp, never imported by the app)
await sharp(toGray(curvature), { raw: { width: W, height: H, channels: 1 } }).png().toFile('/tmp/dbg-curvature.png')
await sharp(toGray(skinSoft), { raw: { width: W, height: H, channels: 1 } }).png().toFile('/tmp/dbg-skin.png')
await sharp(toGray(alphaSoft), { raw: { width: W, height: H, channels: 1 } }).png().toFile('/tmp/dbg-alpha.png')
await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile('/tmp/dbg-cutout.png')

console.log(`solved at ${W}x${H}; wrote riyan-foreground.webp + riyan-depth.png`)
