'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowDownRight, Bot, ShieldCheck, Sparkles, Terminal } from 'lucide-react'
import Navigation from '@/components/Navigation'
import FloatingParticles from '@/components/FloatingParticles'
import Raven3D from '@/components/Raven3D'
import RavenHUD from '@/components/RavenHUD'
import RavenVision from '@/components/RavenVision'
import RavenConsole from '@/components/RavenConsole'
import RiyanPortrait3D from '@/components/RiyanPortrait3D'
import CinematicIntro from '@/components/CinematicIntro'
import ProjectCard, { type ProjectItem } from '@/components/ProjectCard'
import ProjectDetailModal from '@/components/ProjectDetailModal'
import NeuralGraph from '@/components/NeuralGraph'
import InViewMount from '@/components/InViewMount'
import { siteConfig } from '@/data/siteConfig'
import { useRavenTheme } from '@/lib/useRavenTheme'
import { useRavenStore, type RavenState } from '@/lib/ravenStore'

export default function Page() {
  // The theme lives in lib/theme (localStorage + OS preference + <html data-theme>)
  // so the CSS palette and the three.js lighting rigs read exactly one value.
  const { theme, toggle: toggleTheme } = useRavenTheme()
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null)
  // Measured by the 3D stage itself; the HUD repeats it so the claim is visible next
  // to the bust rather than buried in devtools. It reports what the stage assembled,
  // not a download: there is no character file to fetch any more.
  const [ravenModel, setRavenModel] = useState<{ status: string; detail?: string }>({ status: 'loading' })
  const handleRavenModelStatus = useCallback((status: string, detail?: string) => setRavenModel({ status, detail }), [])
  const [introFinished, setIntroFinished] = useState(false)
  // The handoff has three moments, and the landing needs to know which one it is in:
  // the intro is playing (landing is simply behind a veil), the intro is *exiting*
  // (landing animates in underneath, one continuous scene), or it is over (no classes,
  // no lingering compositor layers). See the WELCOME → LANDING HANDOFF block in globals.css.
  const [introPhase, setIntroPhase] = useState<'playing' | 'exiting' | 'done'>('playing')

  const {
    state: ravenState,
    isSpeaking: speaking,
    isVisionEnabled: visionEnabled,
    visionStatus,
    visionMessage,
    facePresent,
    depth,
    isOnline,
    lastMode: ravenLastMode,
    setState: setRavenState,
    toggleVision,
    disableVision,
    setVisionStatus,
    setFacePresent,
    setDepth,
  } = useRavenStore()

  /* Only ONE RavenVision instance may exist: a second getUserMedia + TFLite
     context on the same page is what crashes the vision runtime. Vision lives
     in the hero stage and both HUDs read its status from the store. */
  const handleVisionStatus = useCallback(
    (status: Parameters<typeof setVisionStatus>[0], message?: string) => setVisionStatus(status, message),
    [setVisionStatus],
  )

  const cycleRavenState = () => {
    const states: readonly RavenState[] = siteConfig.ravenStates
    const currIndex = states.indexOf(ravenState)
    const nextState = states[(currIndex + 1 + states.length) % states.length] ?? 'IDLE'
    setRavenState(nextState)
  }

  const lastDepthRef = useRef({ x: 0, y: 0 })

  const handleStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (visionStatus === 'LOCKED') return // camera tracking owns the gaze while locked
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const strength = e.pointerType === 'touch' ? 10 : 16
    const x = Number((((e.clientX - rect.left) / rect.width - 0.5) * strength).toFixed(2))
    const y = Number((((e.clientY - rect.top) / rect.height - 0.5) * 12).toFixed(2))

    if (x === lastDepthRef.current.x && y === lastDepthRef.current.y) return
    lastDepthRef.current = { x, y }
    setDepth({ x, y })
  }

  const resetStageDepth = () => {
    if (lastDepthRef.current.x === 0 && lastDepthRef.current.y === 0) return
    lastDepthRef.current = { x: 0, y: 0 }
    setDepth({ x: 0, y: 0 })
  }

  const handleIntroComplete = useCallback(() => {
    setIntroFinished(true)
    setIntroPhase('done')
  }, [])
  const handleIntroExitStart = useCallback(() => setIntroPhase((phase) => (phase === 'playing' ? 'exiting' : phase)), [])

  const social = useMemo(
    () => Object.entries(siteConfig.socialLinks).filter(([, url]) => typeof url === 'string'),
    [],
  )

  return (
    <div className="site" data-theme={theme} data-intro-phase={introFinished ? 'done' : introPhase}>
      {/* 8-Shot Cinematic Intro Sequence with Automatic Transition */}
      {!introFinished && <CinematicIntro onComplete={handleIntroComplete} onExitStart={handleIntroExitStart} />}

      {/* Ambient Particle Web */}
      <FloatingParticles />

      {/* Floating Header Navigation */}
      <Navigation theme={theme} onToggleTheme={toggleTheme} />

      <main id="top" className="pt-24 sm:pt-28 space-y-16">
        {/* ===================================================
            EDITORIAL CINEMATIC HERO SECTION
        ==================================================== */}
        <section className="max-w-7xl mx-auto px-6 py-8 sm:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Column: Riyan Identity & 3D Portrait */}
            <div className="intro-reveal lg:col-span-7 space-y-6">
              <div className="intro-reveal intro-reveal--2 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 border border-cyan-500/20 text-xs mono text-cyan-300 backdrop-blur-md">
                <ShieldCheck size={14} className="text-cyan-400" />
                <span>TECHNOLOGIST · DEVELOPER · PROBLEM SOLVER · BUILDER</span>
              </div>

              <div className="space-y-2">
                <h1 className="font-serif text-5xl sm:text-7xl font-bold tracking-tight text-white leading-none">
                  RIYAN <br />
                  <span className="italic text-cyan-400">PASHA</span>
                </h1>
                <div className="flex flex-wrap gap-2 pt-2">
                  {siteConfig.roles.map((role) => (
                    <span
                      key={role}
                      className="text-xs mono px-3 py-1 rounded-md bg-white/5 border border-white/10 text-gray-300"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>

              <p className="text-sm sm:text-base text-gray-300 font-sans leading-relaxed max-w-xl">
                &ldquo;{siteConfig.intro}&rdquo;
              </p>

              {/* Riyan 3D Glass Portrait */}
              <div className="pt-2">
                <RiyanPortrait3D />
              </div>

              <div className="flex flex-wrap gap-4 pt-2">
                <a
                  href="#work"
                  className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs tracking-wider uppercase flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(0,229,255,0.3)]"
                >
                  <span>EXPLORE SYSTEMS</span>
                  <ArrowDownRight size={16} />
                </a>

                <a
                  href="#raven"
                  className="px-6 py-3 rounded-xl border border-cyan-500/30 bg-black/40 text-cyan-300 hover:border-cyan-400 font-semibold text-xs tracking-wider uppercase flex items-center gap-2 transition-all backdrop-blur-md"
                >
                  <Bot size={16} />
                  <span>TALK TO RAVEN</span>
                </a>
              </div>
            </div>

            {/* Right Column: RAVEN 3D Character Companion */}
            <div className="lg:col-span-5">
              <div
                className="raven-stage group relative w-full h-[460px] sm:h-[520px] rounded-2xl overflow-hidden backdrop-blur-xl cursor-crosshair shadow-2xl"
                onPointerMove={handleStagePointerMove}
                onPointerLeave={resetStageDepth}
                onClick={cycleRavenState}
                onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    cycleRavenState()
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="RAVEN — autonomous engineering intelligence (machine bust stage)"
              >
                <RavenHUD
                  state={ravenState}
                  modelDetail={ravenModel.detail}
                  visionEnabled={visionEnabled}
                  visionStatus={visionStatus}
                  visionMessage={visionMessage}
                  facePresent={facePresent}
                  isOnline={isOnline}
                  onToggleVision={toggleVision}
                  onCycleState={cycleRavenState}
                />

                <RavenVision
                  enabled={visionEnabled}
                  onDepthChange={setDepth}
                  onPresenceChange={setFacePresent}
                  onStatusChange={handleVisionStatus}
                  onDisable={disableVision}
                />

                <Raven3D
                  depth={depth}
                  state={ravenState}
                  speaking={speaking}
                  blinking={false}
                  variant="hero"
                  onStatusChange={handleRavenModelStatus}
                  /* The bust itself is what arrives: settling the canvas inside a still
                     frame reads as a camera move, and it keeps the animation off the
                     blurred stage surface (animating a backdrop-filter jitters). */
                  className="intro-reveal--raven intro-stage-anchor"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================
            SELECTED WORK (3D PERSPECTIVE CARDS)
        ==================================================== */}
        <section id="work" className="max-w-7xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-2">
            <span className="mono text-xs text-cyan-400 tracking-widest uppercase">// SELECTED WORK</span>
            <h2 className="font-serif text-3xl sm:text-4xl text-white">
              SYSTEMS &amp; <span className="italic text-lime-400">ENGINEERING EXPERIMENTS</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {siteConfig.projects.map((project, idx) => (
              <ProjectCard
                key={project.number}
                project={project}
                index={idx}
                onSelect={(proj) => setSelectedProject(proj)}
              />
            ))}
          </div>
        </section>

        {/* ===================================================
            RAVEN CENTERPIECE & FLOATING CONSOLE
        ==================================================== */}
        <section id="raven" className="max-w-7xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-2">
            <span className="mono text-xs text-cyan-400 tracking-widest uppercase">// DIGITAL COMPANION</span>
            <h2 className="font-serif text-3xl sm:text-4xl text-white">
              MEET <span className="italic text-cyan-400">RAVEN</span>
            </h2>
            <p className="text-sm text-gray-300 font-sans max-w-2xl">
              Riyan Pasha&apos;s Autonomous Virtual Engineering Nexus — a digital AI companion embedded inside the portfolio representing his agentic architecture, data engineering, and technological vision.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* 3D Character Stage */}
            <div
              className="raven-stage group lg:col-span-6 relative w-full h-[420px] sm:h-[480px] rounded-2xl overflow-hidden backdrop-blur-xl cursor-pointer"
              onPointerMove={handleStagePointerMove}
              onPointerLeave={resetStageDepth}
              onClick={cycleRavenState}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  cycleRavenState()
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="RAVEN Centerpiece Stage"
            >
              <RavenHUD
                state={ravenState}
                modelDetail={ravenModel.detail}
                visionEnabled={visionEnabled}
                visionStatus={visionStatus}
                visionMessage={visionMessage}
                facePresent={facePresent}
                isOnline={isOnline}
                onToggleVision={toggleVision}
                onCycleState={cycleRavenState}
              />

              {/* Waist-up framing here: the hero already owns the close-up. The
                  scene is only built once this card is within 300px of the
                  viewport, so the first paint pays for one stage, not two. */}
              <InViewMount>
                <Raven3D
                  depth={depth}
                  state={ravenState}
                  speaking={speaking}
                  blinking={false}
                  variant="stage"
                />
              </InViewMount>
            </div>

            {/* Floating Glass Console */}
            <div className="lg:col-span-6">
              <RavenConsole />
            </div>
          </div>
        </section>

        {/* ===================================================
            SPATIAL CAPABILITY NETWORK
        ==================================================== */}
        <section id="skills" className="max-w-7xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-2">
            <span className="mono text-xs text-cyan-400 tracking-widest uppercase">// SPATIAL CAPABILITY NETWORK</span>
            <h2 className="font-serif text-3xl sm:text-4xl text-white">
              INTELLIGENT <span className="italic text-lime-400">NODE MATRIX</span>
            </h2>
          </div>

          <NeuralGraph />
        </section>

        {/* ===================================================
            ABOUT & IDENTITY CONSTELLATION
        ==================================================== */}
        <section id="about" className="max-w-7xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-2">
            <span className="mono text-xs text-cyan-400 tracking-widest uppercase">// IDENTITY &amp; PHILOSOPHY</span>
            <h2 className="font-serif text-3xl sm:text-4xl text-white">
              WHO <span className="italic text-cyan-400">I AM</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="glass-panel p-6 sm:p-8 rounded-2xl space-y-4">
              <p className="font-serif text-lg sm:text-xl text-gray-200 leading-relaxed italic">
                &ldquo;{siteConfig.about}&rdquo;
              </p>
              <div className="mono text-xs text-lime-400 border-t border-white/10 pt-4">
                RIYAN PASHA — TECHNOLOGIST · DEVELOPER · PROBLEM SOLVER · BUILDER
              </div>
            </div>

            <div className="glass-panel p-6 sm:p-8 rounded-2xl space-y-4">
              <span className="mono text-xs text-cyan-400">// FOCUS CONSTELLATION</span>
              <div className="flex flex-wrap gap-2 pt-2">
                {[
                  'AI',
                  'Agentic AI',
                  'Machine Learning',
                  'Deep Learning',
                  'Data Science',
                  'RAG',
                  'LLMs',
                  'Android',
                  'Software Engineering',
                  'Data',
                  'Automation',
                  'Intelligent Systems',
                ].map((item) => (
                  <span key={item} className="text-xs mono px-3 py-1.5 rounded-lg bg-black/40 border border-cyan-500/20 text-cyan-300">
                    ● {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================
            CONTACT SECTION
        ==================================================== */}
        <section id="contact" className="max-w-7xl mx-auto px-6 py-12">
          <div className="glass-panel-glow p-8 sm:p-12 rounded-2xl space-y-8">
            <div className="space-y-2">
              <span className="mono text-xs text-cyan-400 tracking-widest uppercase">// INITIATE CONNECTION</span>
              <h2 className="font-serif text-3xl sm:text-5xl text-white">
                LET&apos;S BUILD SOMETHING <span className="italic text-cyan-400">INTELLIGENT.</span>
              </h2>
              <p className="text-sm text-gray-300 font-sans max-w-xl">
                Have a problem worth solving or a system worth building? I&apos;m always open to the first conversation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {social.map(([name, url]) => (
                <a
                  key={name}
                  href={url || undefined}
                  target={url ? '_blank' : undefined}
                  rel={url ? 'noopener noreferrer' : undefined}
                  className={`p-4 rounded-xl glass-panel text-xs mono text-gray-300 flex items-center justify-between transition-all ${
                    url ? 'hover:border-lime-400 hover:text-lime-300' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <span>{name}</span>
                  <ArrowDownRight size={15} />
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between text-xs mono text-gray-500 gap-4">
        <span>RIYAN PASHA</span>
        <span>TECHNOLOGIST · DEVELOPER · PROBLEM SOLVER · BUILDER</span>
        <span>© 2026 / RAVEN OPERATING SYSTEM</span>
      </footer>

      {/* Project Detail Modal */}
      <ProjectDetailModal
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
      />
    </div>
  )
}