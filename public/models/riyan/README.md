# Riyan portrait — 3D layer

Two derived files, both produced locally from `public/riyan-portrait.png`:

```
riyan-foreground.webp   88,916 bytes   900x1350 RGBA  the photograph, background segmented out
riyan-depth.png         98,556 bytes   900x1350 gray  depth *proxy* used for displacement
```

## How they are generated

```bash
npm i --no-save sharp          # MIT, dev-time only, never imported by the app
node scripts/generate-portrait-depth.mjs
```

The generator is deterministic and contains no AI model. It does four things:

1. **Segmentation.** The source is a studio shot on pure `#000000`. It flood-fills
   from the border over near-black pixels (`max(r,g,b) <= 4`) to mark background,
   applies a 3×3 majority vote, then fills enclosed holes. The strict threshold is
   deliberate: a looser one leaks along the pinstripes of the suit and eats the
   trousers.
2. **Silhouette distance.** A two-pass Felzenszwalb/Huttenlocher exact Euclidean
   distance transform of the mask. `--selftest` validates it against a brute-force
   nearest-seed search on a synthetic disc (max error `0.0000` px, symmetric to
   `0.0000`) before any output is written.
3. **Forward-facing regions.** A warm-skin heuristic (r>b, r>=g, bounded r-g) that
   finds the face and hands — the parts of a standing person that are nearer to
   the camera than the torso.
4. **Composition.** `depth = rounded cross-section (distance) + face/hands forward
   term + slight vertical drop`, then a feathered alpha. The result is a relief, so
   the displacement it drives is small (0.075 units on a 1.0-unit plane).

## What this is *not*

Not a 3D scan, not photogrammetry, not a generated face: the original photograph is
`public/riyan-portrait.png`, untouched, and it is what visitors see. `components/RiyanPortrait3D.tsx`
crops that image (never stretches it) and displaces it with the depth proxy. When
WebGL or the assets are unavailable, the component shows the original photo in the
same frame and says so — it never fakes depth.

Both files are derived works of the owner's own photograph, so no third-party
licence applies and the cost is $0.
