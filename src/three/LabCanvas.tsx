import { Suspense, lazy } from 'react'
import { useLab } from '../store/useLab'

// The heavy WebGL scene is code-split and lazy-loaded.
const LabScene = lazy(() => import('./LabScene'))

export default function LabCanvas() {
  const quality = useLab((s) => s.quality)
  const webglFailed = useLab((s) => s.webglFailed)

  if (webglFailed) return null

  return (
    <Suspense fallback={null}>
      <LabScene quality={quality} />
    </Suspense>
  )
}
