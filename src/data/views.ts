// ============================================================================
//  TECH UNIVERSE — spatial layout + camera choreography.
//  Ten stations orbit the TECH KING core: 8 worlds + projects + contact.
// ============================================================================

import type { ViewKey } from '../store/useLab'
import { WORLD_HUES, worlds } from './portfolio'

export const RING_RADIUS = 9.6
export const CORE_POS: [number, number, number] = [0, 1.7, 0]

/** polar → cartesian on the floor (y = station base height) */
export function polar(deg: number, r = RING_RADIUS): [number, number, number] {
  const rad = (deg * Math.PI) / 180
  return [Math.sin(rad) * r, 0, Math.cos(rad) * r]
}

export interface StationDef {
  id: string
  label: string
  index: string
  sub: string
  view: ViewKey
  pos: [number, number, number]
  hue: string
}

/** 10 stations, 36° apart — worlds 01-08, then projects + contact */
function ringStations(): StationDef[] {
  const angleOf = (i: number) => -90 + i * 36
  const worldStations = worlds.map((w, i) => ({
    id: w.id,
    label: w.title.split(' ')[0] === 'ARTIFICIAL' ? 'AI' : w.title,
    index: w.index,
    sub: `WORLD ${w.index}`,
    view: w.id as ViewKey,
    pos: polar(angleOf(i)),
    hue: WORLD_HUES[w.id],
  }))
  return [
    ...worldStations,
    { id: 'projects', label: 'PROJECTS', index: '09', sub: 'GALLERY · CASE STUDIES', view: 'projects', pos: polar(angleOf(8)), hue: '#2dd391' },
    { id: 'contact', label: 'CONTACT', index: '10', sub: 'REACH OUT', view: 'contact', pos: polar(angleOf(9)), hue: '#2dd391' },
  ]
}

export const STATIONS: StationDef[] = ringStations()

export const WORLD_VIEWS = worlds.map((w) => w.id)

/** timeline pedestals — from the MOBILE sector outward */
export const MILESTONE_POS: [number, number, number][] = [
  [3.55, 0, 10.15],
  [3.65, 0, 11.05],
  [3.7, 0, 11.9],
]

export const EDUCATION_POS: [number, number, number] = [3.7, 0, 13.0]

/** experiment cluster floats above WORLD 08 (EXPERIMENTS) */
export const EXPERIMENTS_ANCHOR: [number, number, number] = [2.97, 0, -9.13]

/** project gallery + architecture diagram at the PROJECTS sector */
export const GALLERY_POS: [number, number, number] = polar(198)
export const DIAGRAM_POS: [number, number, number] = [-4.2, 2.3, -8.6]

export interface ViewConfig {
  pos: [number, number, number]
  look: [number, number, number]
  bg: string
  fogNear: number
  fogFar: number
  ambient: number
  key: number
  accent: number
  ambiance: number
}

function stationCam(pos: [number, number, number], dist = 4.6, h = 2.9): [number, number, number] {
  const len = Math.hypot(pos[0], pos[2]) || 1
  return [pos[0] + (pos[0] / len) * dist, h, pos[2] + (pos[2] / len) * dist]
}

const base = {
  bg: '#0a0e0c',
  fogNear: 20,
  fogFar: 46,
  ambient: 0.34,
  key: 1.0,
  accent: 1.0,
  ambiance: 1,
}

export const VIEWS: Record<ViewKey, ViewConfig> = {
  lab: {
    ...base,
    pos: [0, 4.9, 16.2],
    look: [0, 1.9, 0],
    ambiance: 1,
  },
  ai: { ...base, pos: stationCam(STATIONS[0].pos), look: [STATIONS[0].pos[0], 2.2, STATIONS[0].pos[2]] },
  data: { ...base, pos: stationCam(STATIONS[1].pos), look: [STATIONS[1].pos[0], 2.1, STATIONS[1].pos[2]], accent: 0.9 },
  software: { ...base, pos: stationCam(STATIONS[2].pos), look: [STATIONS[2].pos[0], 2.1, STATIONS[2].pos[2]] },
  mobile: { ...base, pos: stationCam(STATIONS[3].pos), look: [STATIONS[3].pos[0], 2.1, STATIONS[3].pos[2]] },
  web: { ...base, pos: stationCam(STATIONS[4].pos), look: [STATIONS[4].pos[0], 2.1, STATIONS[4].pos[2]] },
  cloud: { ...base, pos: stationCam(STATIONS[5].pos), look: [STATIONS[5].pos[0], 2.1, STATIONS[5].pos[2]], bg: '#0b100e' },
  automation: { ...base, pos: stationCam(STATIONS[6].pos), look: [STATIONS[6].pos[0], 2.1, STATIONS[6].pos[2]] },
  experiments: {
    ...base,
    pos: [8.6, 5.2, -11.6],
    look: [3.4, 3.2, -8.8],
    bg: '#0b100e',
    fogNear: 18,
    fogFar: 42,
  },
  projects: {
    ...base,
    pos: [-8.6, 3.7, -13.4],
    look: [-3.4, 2.2, -9.3],
    bg: '#0b100e',
  },
  project: {
    ...base,
    pos: [-8.0, 3.6, -12.9],
    look: [-4.4, 2.4, -8.9],
    bg: '#0b100e',
    fogNear: 16,
    fogFar: 38,
  },
  experience: {
    ...base,
    pos: [6.8, 3.2, 15.6],
    look: [3.65, 1.7, 11.6],
    bg: '#0b100e',
  },
  education: {
    ...base,
    pos: [7.6, 3.0, 16.6],
    look: [3.7, 2.1, 13.0],
    bg: '#0b100e',
    accent: 0.85,
  },
  contact: {
    ...base,
    pos: stationCam(STATIONS[9].pos, 6.0, 3.2),
    look: [STATIONS[9].pos[0], 2.4, STATIONS[9].pos[2]],
    bg: '#0b100e',
    ambient: 0.42,
    key: 0.85,
    accent: 0.62,
    ambiance: 0.55,
  },
}
