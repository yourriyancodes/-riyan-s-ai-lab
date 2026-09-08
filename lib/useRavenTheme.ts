'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_THEME, getTheme, readTheme, subscribeTheme, toggleTheme, type RavenTheme } from '@/lib/theme'

/**
 * React view of the theme. It lives in its own module because it depends on
 * `useSyncExternalStore`, which is client-only; `lib/theme.ts` has to stay
 * importable from a Server Component (app/layout.tsx needs the pre-paint script).
 */
export function useRavenTheme(): { theme: RavenTheme; toggle: () => void } {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    () => (typeof window === 'undefined' ? DEFAULT_THEME : readTheme()),
  )
  return {
    theme,
    // Toggling goes through lib/theme so <html data-theme>, localStorage and every
    // subscriber (including the two WebGL lighting rigs) move together.
    toggle: useCallback(() => {
      toggleTheme()
    }, []),
  }
}
