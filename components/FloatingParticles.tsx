'use client'

import { useEffect, useRef } from 'react'
import { currentTheme, subscribeTheme } from '@/lib/theme'

/**
 * Ambient particle field behind the page.
 *
 * Constraints this version respects, which the original did not:
 *  - `prefers-reduced-motion` draws a single still frame and never loops.
 *  - The loop stops when the tab is hidden (this canvas covers the whole viewport,
 *    so an unpaused rAF here costs battery on every page of the site).
 *  - Frame cost is capped at ~30 fps, and the connecting web is built as one
 *    Path2D and stroked once instead of one stroke call per pair.
 *  - Motion is time-normalised, so the drift speed does not depend on refresh rate.
 *  - The paper theme gets a fainter, ink-tinted field; neon dots vanish on cream.
 */

const FRAME_BUDGET_MS = 1000 / 30
const WEB_PATH = () => (typeof Path2D === 'undefined' ? null : new Path2D())

export default function FloatingParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reduceMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    type Particle = { x: number; y: number; size: number; vx: number; vy: number; alpha: number; color: string }
    let particles: Particle[] = []
    let width = 1
    let height = 1

    const paletteFor = (theme: 'dark' | 'light') =>
      theme === 'light' ? ['#0e7490', '#4d7c0f', '#6d28d9', '#0369a1'] : ['#00f0ff', '#ccff00', '#8b5cf6', '#38bdf8']

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const colors = paletteFor(currentTheme() ?? 'dark')
      // Area-scaled count, with a lower ceiling: enough to read as atmosphere,
      // few enough that the pairwise web stays cheap.
      const count = Math.min(Math.floor((width * height) / 20000), 48)
      particles = []
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: Math.random() * 1.6 + 0.4,
          vx: (Math.random() - 0.5) * 0.3 * 60,
          vy: (Math.random() - 0.5) * 0.3 * 60,
          alpha: Math.random() * 0.4 + 0.1,
          color: colors[Math.floor(Math.random() * colors.length)],
        })
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      const light = (currentTheme() ?? 'dark') === 'light'

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.alpha * (light ? 0.55 : 1)
        ctx.fill()
      }

      // Connecting web in a single path: same picture, one stroke call.
      const web = WEB_PATH()
      const reach = 110
      const reachSq = reach * reach
      if (web) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x
            const dy = particles[i].y - particles[j].y
            if (dx * dx + dy * dy > reachSq) continue
            web.moveTo(particles[i].x, particles[i].y)
            web.lineTo(particles[j].x, particles[j].y)
          }
        }
        ctx.globalAlpha = light ? 0.035 : 0.05
        ctx.strokeStyle = light ? '#0e7490' : '#00f0ff'
        ctx.lineWidth = 0.5
        ctx.stroke(web)
      } else {
        ctx.globalAlpha = light ? 0.035 : 0.05
        ctx.strokeStyle = light ? '#0e7490' : '#00f0ff'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x
            const dy = particles[i].y - particles[j].y
            if (dx * dx + dy * dy > reachSq) continue
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
          }
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    build()
    draw()

    let frameId = 0
    let last = 0
    let running = !reduceMotion
    let visible = document.visibilityState === 'visible'

    const step = (time: number) => {
      frameId = requestAnimationFrame(step)
      const dt = Math.min(0.05, (time - last) / 1000 || 0.016)
      // Throttle below the display rate; motion stays time-accurate.
      if (time - last < FRAME_BUDGET_MS - 1) return
      last = time
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.x < 0) p.x = width
        if (p.x > width) p.x = 0
        if (p.y < 0) p.y = height
        if (p.y > height) p.y = 0
      }
      draw()
    }

    const sync = () => {
      const shouldRun = running && visible
      if (shouldRun && !frameId) {
        last = performance.now()
        frameId = requestAnimationFrame(step)
      } else if (!shouldRun && frameId) {
        cancelAnimationFrame(frameId)
        frameId = 0
      }
    }
    sync()

    const handleResize = () => {
      build()
      draw()
    }
    const handleVisibility = () => {
      visible = document.visibilityState === 'visible'
      sync()
    }
    const applyThemeStyles = () => {
      canvas.style.opacity = (currentTheme() ?? 'dark') === 'light' ? '0.22' : '0.4'
      draw()
    }
    const handleTheme = () => applyThemeStyles()
    applyThemeStyles()

    window.addEventListener('resize', handleResize)
    document.addEventListener('visibilitychange', handleVisibility)
    const unsubscribeTheme = subscribeTheme(handleTheme)

    return () => {
      if (frameId) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', handleVisibility)
      unsubscribeTheme()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.4 }}
      aria-hidden="true"
    />
  )
}
