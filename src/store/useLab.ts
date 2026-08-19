import { create } from 'zustand'

export type ViewKey =
  | 'lab'
  | 'ai'
  | 'data'
  | 'software'
  | 'mobile'
  | 'web'
  | 'cloud'
  | 'automation'
  | 'experiments'
  | 'projects'
  | 'project'
  | 'experience'
  | 'education'
  | 'contact'

export type Quality = 'high' | 'low'

interface LabState {
  view: ViewKey
  setView: (v: ViewKey) => void
  projectId: string | null
  openProject: (id: string) => void
  closeProject: () => void
  experiment: string | null
  setExperiment: (id: string | null) => void
  hoveredSkill: string | null
  setHoveredSkill: (id: string | null) => void
  activeLayer: number
  setActiveLayer: (i: number) => void
  hoveredStation: string | null
  setHoveredStation: (id: string | null) => void
  booted: boolean
  setBooted: (b: boolean) => void
  menuOpen: boolean
  setMenuOpen: (b: boolean) => void
  quality: Quality
  reducedMotion: boolean
  webglFailed: boolean
  setWebglFailed: (b: boolean) => void
  /** UI theme — dark (default) or light */
  mode: 'dark' | 'light'
  setMode: (m: 'dark' | 'light') => void
}

const INITIAL_MODE = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('riyan-mode') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
})()

export const useLab = create<LabState>((set) => ({
  view: 'lab',
  setView: (view) => set({ view, menuOpen: false }),
  projectId: null,
  openProject: (projectId) => set({ projectId, view: 'project', menuOpen: false }),
  closeProject: () => set({ projectId: null, view: 'projects', menuOpen: false }),
  experiment: null,
  setExperiment: (experiment) => set({ experiment }),
  hoveredSkill: null,
  setHoveredSkill: (hoveredSkill) => set({ hoveredSkill }),
  activeLayer: 0,
  setActiveLayer: (activeLayer) => set({ activeLayer }),
  hoveredStation: null,
  setHoveredStation: (hoveredStation) => set({ hoveredStation }),
  booted: false,
  setBooted: (booted) => set({ booted }),
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  quality: detectQuality(),
  reducedMotion:
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  webglFailed: false,
  setWebglFailed: (webglFailed) => set({ webglFailed }),
  mode: INITIAL_MODE,
  setMode: (mode) => {
    set({ mode })
    try {
      localStorage.setItem('riyan-mode', mode)
    } catch {
      /* private mode etc. */
    }
  },
}))

function detectQuality(): Quality {
  if (typeof window === 'undefined') return 'high'
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const small = window.innerWidth < 820
    const cores = navigator.hardwareConcurrency || 8
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 8
    if (coarse || small || cores <= 4 || mem <= 4) return 'low'
  } catch {
    /* keep high */
  }
  return 'high'
}
