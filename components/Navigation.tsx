'use client'

import { useState, useEffect } from 'react'
import { Menu, Moon, Sun, X, Activity, ShieldCheck } from 'lucide-react'

type NavigationProps = {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export default function Navigation({ theme, onToggleTheme }: NavigationProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navItems = [
    { label: 'WORK', href: '#work' },
    { label: 'RAVEN', href: '#raven' },
    { label: 'SYSTEMS', href: '#systems' },
    { label: 'SKILLS', href: '#skills' },
    { label: 'ABOUT', href: '#about' },
    { label: 'CONTACT', href: '#contact' },
  ]

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'nav-surface backdrop-blur-md border-b border-white/10 py-3 shadow-2xl' : 'bg-transparent py-5'}`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Brand */}
        <a href="#top" className="flex items-center gap-3 group" onClick={() => setIsOpen(false)}>
          <span className="font-serif text-lg sm:text-xl font-bold tracking-wider text-white group-hover:text-cyan-400 transition-colors">
            RIYAN PASHA
          </span>
          <span className="text-[10px] mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hidden sm:inline-block">
            RAVEN AI
          </span>
        </a>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-xs mono tracking-wider">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-gray-300 hover:text-cyan-400 transition-colors flex items-center gap-1"
            >
              <span className="text-cyan-500/60 font-mono">//</span> {item.label}
            </a>
          ))}
        </nav>

        {/* Status Indicator & Theme */}
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/40 border border-cyan-500/20 text-xs mono text-cyan-300">
            <Activity size={13} className="text-lime-400 animate-pulse" />
            <span>COMPANION ACTIVE</span>
          </div>

          <button
            onClick={onToggleTheme}
            className="p-2 rounded-lg border border-gray-800 bg-black/40 text-gray-300 hover:border-cyan-500/40 hover:text-white transition-all text-xs flex items-center gap-1.5"
            aria-label="Toggle Theme"
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            <span className="hidden sm:inline mono text-[11px]">{theme === 'light' ? 'DARK' : 'LIGHT'}</span>
          </button>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 rounded-lg border border-gray-800 bg-black/50 text-white"
            aria-label="Toggle Navigation Menu"
          >
            {isOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {isOpen && (
        <div className="md:hidden nav-surface nav-surface--solid backdrop-blur-xl border-b border-cyan-500/20 p-6 space-y-4">
          <nav className="flex flex-col space-y-3 font-mono text-sm">
            {navItems.map((item, index) => (
              <a
                key={item.label}
                href={item.href}
                className="text-gray-300 hover:text-cyan-400 py-1 transition-colors flex items-center gap-2"
                onClick={() => setIsOpen(false)}
              >
                <span className="text-lime-400 text-xs">0{index + 1}</span>
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}
