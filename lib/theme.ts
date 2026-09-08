/**
 * Theme system shared by the DOM and the WebGL stages.
 *
 * It is a semantic switch, not a colour inversion: `dark` is the cinematic
 * night environment, `light` is a paper/ink environment with its own accent
 * tuning, its own contrast curve and its own lighting rig for the 3D stages.
 * CSS custom properties, three.js lights and particle colours all read the one
 * value stored here, which is what keeps `RAVEN` in sync with the page instead
 * of drifting into a dark box on a light site.
 *
 * Resolution order on first paint (before any React code runs):
 *   1. the choice saved in localStorage   (the visitor asked for it)
 *   2. the OS `prefers-color-scheme`      (what the device is set to)
 *   3. dark                               (the design's default)
 * `themeInitScript` is injected in <head> so this happens before first paint —
 * no dark flash for light-mode visitors.
 */
export type RavenTheme = 'dark' | 'light'

export const THEME_KEY = 'riyan-theme'
export const DEFAULT_THEME: RavenTheme = 'dark'

const THEME_EVENT = 'riyan:theme'

export function normalizeTheme(value: unknown): RavenTheme | null {
  return value === 'light' || value === 'dark' ? value : null
}

/** Only ever called from the browser. */
function storedTheme(): RavenTheme | null {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_KEY))
  } catch {
    // Storage can be blocked (private mode, cookies disabled) — not an error.
    return null
  }
}

function systemTheme(): RavenTheme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** What the visitor has chosen (or what the OS says if they never chose). */
export function readTheme(): RavenTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  return currentTheme() ?? storedTheme() ?? systemTheme()
}

/** What is currently applied to the document, or null before the first apply. */
export function currentTheme(): RavenTheme | null {
  if (typeof document === 'undefined') return null
  return normalizeTheme(document.documentElement.getAttribute('data-theme'))
}

/** Applies the theme to the document, persists an explicit choice, notifies listeners. */
export function applyTheme(theme: RavenTheme, options: { persist?: boolean } = {}): void {
  if (typeof document === 'undefined') return
  const { persist = true } = options
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
  if (persist) {
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* blocked storage: the theme still applies for this page view */
    }
  }
  window.dispatchEvent(new CustomEvent<RavenTheme>(THEME_EVENT, { detail: theme }))
}

export function toggleTheme(): RavenTheme {
  const next = currentTheme() === 'light' ? 'dark' : 'light'
  applyTheme(next)
  return next
}

/** Runs in <head> before paint. Must stay side-effect free and ES5-safe. */
export const themeInitScript = `(function(){try{var t=null;try{t=localStorage.getItem('${THEME_KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark'}var r=document.documentElement;r.setAttribute('data-theme',t);r.style.colorScheme=t}catch(e){var d=document.documentElement;d.setAttribute('data-theme','dark');d.style.colorScheme='dark'}})();`

/** Subscribe to theme changes (toggle, other tab, or OS preference). */
export function subscribeTheme(onChange: () => void): () => void {
  return subscribe(onChange)
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => onChange()
  window.addEventListener(THEME_EVENT, handler)
  // Other tabs writing localStorage must not leave this one stale.
  const storageHandler = (event: StorageEvent) => {
    if (event.key === THEME_KEY) onChange()
  }
  window.addEventListener('storage', storageHandler)
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null
  media?.addEventListener?.('change', handler)
  return () => {
    window.removeEventListener(THEME_EVENT, handler)
    window.removeEventListener('storage', storageHandler)
    media?.removeEventListener?.('change', handler)
  }
}

/** The applied theme, for code that must read it without React. */
export function getTheme(): RavenTheme {
  return currentTheme() ?? readTheme()
}

/* ------------------------------------------------------------------ *
 * Colour rigs used by the three.js stages. Kept here so the WebGL
 * scenes and the CSS palette can never diverge silently.
 * ------------------------------------------------------------------ */
export type StageRig = {
  /** Scene background alpha — the canvas stays transparent in both themes. */
  clearAlpha: number
  ambient: { color: number; intensity: number }
  key: { color: number; intensity: number; position: [number, number, number] }
  fill: { color: number; intensity: number; position: [number, number, number] }
  rim: { color: number; intensity: number; position: [number, number, number] }
  faceLight: { color: number; intensity: number; distance: number }
  /** Image-based lighting strength (RoomEnvironment). */
  envIntensity: number
  exposure: number
  particles: { color: number; opacity: number; size: number }
  /** Multiply on skin/clothing materials. */
  materialTint: number
}

export const STAGE_RIGS: Record<RavenTheme, StageRig> = {
  dark: {
    clearAlpha: 0,
    ambient: { color: 0x1a2430, intensity: 0.55 },
    key: { color: 0xdff4ff, intensity: 3.1, position: [2.6, 2.4, 3.4] },
    fill: { color: 0x2f6f88, intensity: 1.15, position: [-3.0, -0.4, 2.4] },
    rim: { color: 0x63d8ff, intensity: 3.4, position: [-1.4, 2.2, -3.2] },
    faceLight: { color: 0xffe8d8, intensity: 1.0, distance: 3.2 },
    envIntensity: 0.42,
    exposure: 1.02,
    particles: { color: 0x59d8ff, opacity: 0.32, size: 0.0125 },
    materialTint: 1,
  },
  light: {
    clearAlpha: 0,
    ambient: { color: 0xfdf8ef, intensity: 1.35 },
    key: { color: 0xffffff, intensity: 2.35, position: [2.2, 3.0, 3.6] },
    fill: { color: 0xdce8f2, intensity: 1.1, position: [-3.0, 0.2, 2.6] },
    rim: { color: 0xbfd8e6, intensity: 1.25, position: [-1.2, 1.8, -3.4] },
    faceLight: { color: 0xfff3e6, intensity: 0.45, distance: 3.4 },
    envIntensity: 0.85,
    exposure: 1.0,
    particles: { color: 0x0f7d92, opacity: 0.16, size: 0.01 },
    materialTint: 1.04,
  },
}
