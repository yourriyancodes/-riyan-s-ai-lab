# RAVEN 3D upgrade

This version replaces the flat SVG face with a Three.js WebGL face using the Face Cap morph-target model used by the three.js facial morph-target example.

## Install

```bash
npm install
npm run dev
```

## Important

The 3D model is loaded from the three.js example host at runtime:

`https://threejs.org/examples/models/gltf/facecap.glb`

The model provides facial morph targets that are used for blinking and jaw/mouth animation. The implementation also adds orbital rings, particles, cinematic lighting, pointer/touch gaze, breathing motion, and speech animation.

For a truly custom RAVEN woman matching the supplied visual reference, replace `MODEL_URL` in `components/Raven3D.tsx` with a custom GLB that has ARKit/FACS morph targets. The animation system is already structured for that swap.
