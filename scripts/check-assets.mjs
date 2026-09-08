/**
 * RAVEN asset + architecture audit. No browser, no GPU, no network — this is a read of
 * the repository itself, and it exists because the most likely way this design decays is
 * someone re-adding an avatar file or a second renderer "just to try it".
 *
 *   npm run check:assets
 *
 * What it defends:
 *   • the retired human-avatar pipeline stays retired (no `raven.glb`, no
 *     `lib/ravenModel`, no morph-target machinery anywhere in shipped code);
 *   • RAVEN has exactly one geometry source and one drive function, so the hero stage,
 *     the lab stage and the welcome silhouette cannot drift into three different
 *     characters;
 *   • no third-party model marketplace, paid asset service, or named IP appears in
 *     shipped code or UI copy;
 *   • the dependency list is the one the project already had — the machine is
 *     procedural precisely so that no new asset pipeline is required.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import sharp from 'sharp'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

let passed = 0
const failures = []

const check = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL  ${name}\n          ${(error?.message ?? String(error)).split('\n').slice(0, 8).join('\n          ')}`)
  }
}

const group = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`)

/** Non-transparent fraction per vertical decile, top row first. */
async function profileOf(relativePath) {
  const path = join(ROOT, relativePath)
  if (!existsSync(path)) throw new Error(`missing ${relativePath}`)
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const out = []
  for (let decile = 0; decile < 10; decile++) {
    const y0 = Math.floor((decile * height) / 10)
    const y1 = Math.floor(((decile + 1) * height) / 10)
    let opaque = 0
    let samples = 0
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x += 4) {
        if (data[(y * width + x) * channels + 3] > 40) opaque++
        samples++
      }
    }
    out.push(samples ? opaque / samples : 0)
  }
  return out
}

const WALKED = ['app', 'components', 'lib', 'data', 'scripts']
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|css)$/

const walk = (directory, accumulator = []) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, accumulator)
    else if (SOURCE_EXTENSIONS.test(entry)) accumulator.push(path)
  }
  return accumulator
}

const files = WALKED.flatMap((directory) => walk(join(ROOT, directory))).filter(
  (path) => !path.includes(`${ROOT}/scripts/lib/`) && !path.endsWith('check-assets.mjs'),
)
const read = (path) => readFileSync(path, 'utf8')
const relativePath = (path) => relative(ROOT, path)
/**
 * Prose about the retired avatar is *documentation of the decision*, so the comments are
 * stripped before matching: `lib/ravenMachine.ts` opens by explaining that it replaced a
 * CC0 MPFB export with 66 ARKit morphs, and a check that failed the file for saying so
 * would only teach everyone to delete the explanation.
 */
const code = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const grep = (pattern) => files.filter((path) => pattern.test(code(path))).map(relativePath)

/* ------------------------------------------------------------------ */
group('1 · the human avatar era stays closed')

await check('no shipped source references the retired character asset', () => {
  const forbidden = [
    /raven\.glb/,
    /models\/raven/,
    /lib\/ravenModel/,
    /cloneRavenModel|retainRavenModel|releaseRavenModel/,
    /morphTarget(Influences|Dictionary)/,
    /SkeletonUtils/,
    /EXT_meshopt_compression/,
    // Deliberately *not* on this list: `lib/speechSync.ts`'s viseme table. Grapheme to
    // mouth-openness timing is a measurement of the utterance being spoken, and the
    // machine's jaw is driven by it. The avatar is gone; the speech clock is not.
  ]
  const hits = forbidden.flatMap((pattern) => grep(pattern))
  assert.deepEqual([...new Set(hits)], [], `still referenced by: ${[...new Set(hits)].join(', ')}`)
})

await check('nothing serves a character asset', () => {
  assert.equal(existsSync(join(ROOT, 'public/models/raven')), false, 'public/models/raven still exists')
  assert.ok(
    !readdirSync(join(ROOT, 'public/models')).some((entry) => /raven/i.test(entry)),
    'public/models must not contain a RAVEN asset directory',
  )
})

await check('no ARKit/Oculus blendshape contract is asserted any more', () => {
  // Those channel names only ever meant one thing: a rigged face. Their return would mean
  // the avatar pipeline crept back in behind a rename. `jawOpen` is deliberately *not*
  // on this list — on the machine it is the readout field for a real jaw aperture, and
  // renaming a measurement to dodge a name collision would make the code worse.
  const hits = grep(/\b(eyeBlinkLeft|eyeBlinkRight|browInnerUp|mouthPucker|mouthSmileLeft|jawForward|ARKit|OculusViseme)/)
  assert.deepEqual(hits, [], `blendshape channels found in: ${hits.join(', ')}`)
})

await check('Riyan stays upright in the asset, so orientation can only be a render bug', async () => {
  // The portrait once rendered upside down and the temptation was to re-generate the
  // cutout flipped. That would have been the wrong fix, and it would have broken the
  // depth map's row convention. So the asset is guarded instead: the cutout's vertical
  // ink profile has to match the source photograph decile for decile, which means a
  // future flip of the file fails here rather than on screen. The runtime contract
  // ("three ignores Texture.flipY for ImageBitmap sources") is documented in
  // components/RiyanPortrait3D.tsx, where the fix belongs.
  const cutout = await profileOf('public/models/riyan/riyan-foreground.webp')
  const photo = await profileOf('public/riyan-portrait.png')
  assert.equal(cutout.length, photo.length, 'decile count drifted')
  const worst = Math.max(...cutout.map((value, index) => Math.abs(value - photo[index])))
  assert.ok(worst <= 0.08, `ink profile diverges from the source by ${worst.toFixed(3)} at a decile — head/shoulders order changed`)
  assert.ok(cutout[0] < cutout[2], 'the top decile is denser than the head band: this asset is stored upside down')
})

/* ------------------------------------------------------------------ */
group('2 · one architecture')

await check('RAVEN geometry comes from exactly one builder', () => {
  const builders = grep(/buildRavenMachine/).filter((path) => !path.endsWith('lib/ravenMachine.ts') && !path.endsWith('ravenStudio.ts'))
  assert.deepEqual(
    builders.sort(),
    ['components/CinematicIntro.tsx', 'components/Raven3D.tsx', 'scripts/check-machine-render.mjs', 'scripts/render-machine-preview.mjs'],
    `unexpected RAVEN geometry consumers: ${builders.join(', ')}`,
  )
  for (const path of builders) {
    if (path.endsWith('.mjs')) continue
    assert.ok(/from '@\/lib\/ravenMachine'/.test(read(join(ROOT, path))), `${path} must import the shared builder`)
  }
})

await check('every RAVEN visual is driven by driveRavenMachine, not by its own animation', () => {
  for (const path of ['components/Raven3D.tsx', 'components/CinematicIntro.tsx']) {
    const source = read(join(ROOT, path))
    assert.ok(/driveRavenMachine\(/.test(source), `${path} animates the bust without the shared drive`)
  }
})

await check('no React-Three-Fiber render path was added alongside the manual renderer', () => {
  const hits = grep(/@react-three/).filter((path) => path.startsWith('components/') || path.startsWith('app/') || path.startsWith('lib/'))
  assert.deepEqual(hits, [], `R3F appears in RAVEN's own modules: ${hits.join(', ')}`)
  const canvases = grep(/<Canvas/).filter((path) => path.startsWith('components/') || path.startsWith('app/'))
  assert.deepEqual(canvases, [], `a second <Canvas> render loop exists in: ${canvases.join(', ')}`)
})

await check('WebGL contexts are only created where a stage is mounted', () => {
  const hits = grep(/new THREE\.WebGLRenderer/).sort()
  assert.deepEqual(
    hits,
    ['components/CinematicIntro.tsx', 'components/Raven3D.tsx', 'components/RiyanPortrait3D.tsx'].sort(),
    `unexpected renderer owners: ${hits.join(', ')}`,
  )
})

await check('the bust disposes what it builds', () => {
  const machine = read(join(ROOT, 'lib/ravenMachine.ts'))
  assert.ok(/export function disposeRavenMachine/.test(machine), 'no dispose entry point')
  const stage = read(join(ROOT, 'components/Raven3D.tsx'))
  assert.ok(/disposeRavenMachine\(machine\)/.test(stage), 'the stage never releases the bust')
  assert.ok(/forceContextLoss/.test(stage), 'the stage leaks its WebGL context on unmount')
})

/* ------------------------------------------------------------------ */
group('3 · provenance and dependencies')

await check('no paid or third-party 3D asset service is referenced', () => {
  const hits = grep(/sketchfab|td\.files|3dexport|thingiverse|poly\.pizza|quaternius|marketplace\.unity|hdrlabs?\.com|actorcore|reallusion|ikestar/i)
  assert.deepEqual(hits, [], `asset-service references found in: ${hits.join(', ')}`)
})

await check('no named IP from the reference is used in code or UI copy', () => {
  // The brief asked for an Ultron-*class* presence without copying it. The way to keep
  // that promise is to make sure the borrowed name never enters shipped code, UI strings,
  // class names or asset paths — a rationale in a markdown file is a different thing.
  const hits = grep(/\b(ultron|iron man|avengers|marvel)\b/i).filter((path) => !path.endsWith('.md'))
  assert.deepEqual(hits, [], `trademarked character named in: ${hits.join(', ')}`)
})

await check('the 3D stack is the one the project already had', () => {
  const manifest = JSON.parse(read(join(ROOT, 'package.json')))
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  assert.ok(dependencies.three, 'three is missing from the manifest')
  const added = Object.keys(dependencies).filter((name) => /gltf|draco|fbx|assimp|asset|hero/i.test(name))
  assert.deepEqual(added, [], `asset-pipeline dependencies appeared: ${added.join(', ')}`)
  // Word-boundary on purpose: an earlier draft of this line matched `@mediapipe`
  // because "api" is inside it, which is exactly the kind of check that gets ignored
  // after it cries wolf once.
  const paid = Object.keys(dependencies).filter((name) => /\b(stripe|billing|licen[cs]e|paid|checkout)\b/i.test(name))
  assert.deepEqual(paid, [], `billing-shaped dependency: ${paid.join(', ')}`)
})

await check('no binary model, texture pack or HDR is committed for RAVEN', () => {
  const suspicious = []
  const scan = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        scan(path)
        continue
      }
      if (/\.(glb|gltf|fbx|zip|hdr|exr|blend|usdz|zip)$/i.test(entry)) suspicious.push(relativePath(path))
    }
  }
  scan(join(ROOT, 'public'))
  assert.deepEqual(suspicious, [], `binary 3D payloads served from public/: ${suspicious.join(', ')}`)
})

/* ------------------------------------------------------------------ */
const total = passed + failures.length
console.log(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${passed}/${total} checks passed\u001b[0m`)
if (failures.length) {
  for (const failure of failures) console.error(`\n\u001b[31m✗ ${failure.name}\u001b[0m\n${failure.error?.stack ?? failure.error}`)
  process.exit(1)
}
