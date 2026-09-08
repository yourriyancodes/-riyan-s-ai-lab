'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Mounts its children only once the slot is close to the viewport.
 *
 * Used for the second WebGL stage: the character asset itself is parsed once and
 * cached, but building a second scene (cloned skeleton, material set, render
 * context, per-frame morph simulation) is still worth deferring until the visitor
 * can actually see it. Unmounting never happens — scrolling away again should not
 * cost a rebuild.
 */
export default function InViewMount({
  children,
  rootMargin = '300px',
  className,
}: {
  children: ReactNode
  /** How early to build the scene, so it is ready before it is visible. */
  rootMargin?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || active) return
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, rootMargin])

  return (
    <div ref={ref} className={className ?? 'absolute inset-0'} aria-hidden={!active}>
      {active ? children : null}
    </div>
  )
}
