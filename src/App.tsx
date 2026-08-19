import { lazy, Suspense, useEffect } from 'react'
import { useLab } from './store/useLab'
import LoadingScreen from './components/LoadingScreen'
import HUD from './components/HUD'
import MenuOverlay from './components/MenuOverlay'
import WebGLFallback from './components/WebGLFallback'
import Panels from './sections/Panels'

const LabCanvas = lazy(() => import('./three/LabCanvas'))

/** number keys 1-9,0 jump straight to a world/sector */
const KEY_VIEWS: Record<string, string> = {
  '1': 'ai',
  '2': 'data',
  '3': 'software',
  '4': 'mobile',
  '5': 'web',
  '6': 'cloud',
  '7': 'automation',
  '8': 'experiments',
  '9': 'projects',
  '0': 'contact',
}

export default function App() {
  const booted = useLab((s) => s.booted)
  const setBooted = useLab((s) => s.setBooted)
  const setWebglFailed = useLab((s) => s.setWebglFailed)
  const setView = useLab((s) => s.setView)
  const mode = useLab((s) => s.mode)

  // keep the browser chrome color in sync with the theme
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', mode === 'light' ? '#eef2ef' : '#0a0e0c')
  }, [mode])

  // WebGL capability probe (graceful fallback for unsupported devices)
  useEffect(() => {
    let ok = true
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      ok = !!gl
    } catch {
      ok = false
    }
    if (!ok) setWebglFailed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ESC returns to the core; 1-0 jump between worlds
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') {
        setView('lab')
        useLab.setState({ menuOpen: false })
        return
      }
      const v = KEY_VIEWS[e.key]
      if (v) setView(v as never)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink text-snow" data-mode={mode}>
      {/* 3D universe */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={null}>
          <LabCanvas />
        </Suspense>
      </div>

      {/* film grain + CRT scanlines — the terminal finish */}
      <div className="grain pointer-events-none absolute inset-0 z-[35]" aria-hidden />
      <div className="crt pointer-events-none absolute inset-0 z-[34]" aria-hidden />

      {/* DOM fallback environment for devices without WebGL */}
      {!booted ? null : <WebGLFallback />}

      {/* content panels */}
      <Panels />

      {/* HUD + navigation */}
      <HUD />
      <MenuOverlay />

      {/* loading sequence */}
      {!booted && <LoadingScreen onDone={() => setBooted(true)} />}
    </div>
  )
}
