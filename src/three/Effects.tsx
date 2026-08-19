import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'

/** Limited post-processing: soft warm bloom + gentle vignette (high-tier only). */
export default function Effects() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        intensity={0.42}
        luminanceThreshold={0.5}
        luminanceSmoothing={0.28}
        radius={0.72}
      />
      <Vignette eskil={false} offset={0.22} darkness={0.6} />
    </EffectComposer>
  )
}
