import type { ReactNode } from 'react'
import { useLab } from '../store/useLab'

interface Props {
  children: ReactNode
  /** panel chrome */
  label?: string
  /** side: left-aligned panels vs center (hero) */
  align?: 'left' | 'center' | 'right'
  wide?: boolean
  onClose?: () => void
  showClose?: boolean
}

/**
 * Shared glass panel wrapper.
 *  - starts BELOW the HUD top bar (never overlaps identity / MENU / readout)
 *  - never reaches the bottom nav
 *  - narrow enough to leave the 3D object visible
 *  - near-opaque so 3D labels can't bleed through the text
 *  - scrolls internally when content is long
 */
export default function PanelShell({
  children,
  label,
  align = 'left',
  wide = false,
  onClose,
  showClose = true,
}: Props) {
  const setView = useLab((s) => s.setView)
  const close = onClose ?? (() => setView('lab'))

  const alignCls =
    align === 'center'
      ? 'left-1/2 -translate-x-1/2 items-center justify-center'
      : align === 'right'
        ? 'right-3 md:right-8 items-end justify-center'
        : 'left-3 md:left-8 items-start'

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 flex pt-16 pb-24 md:pt-20 md:pb-28 ${alignCls}`}
    >
      <div
        className={`glass panel-hairline anim-panel-in pointer-events-auto relative flex max-h-full w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl md:max-h-[58vh] md:w-auto ${
          wide ? 'md:w-[380px]' : 'md:w-[330px]'
        }`}
        role="region"
        aria-label={label}
      >
        {label && (
          <div className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-3">
            <span className="tech-label truncate">{label}</span>
            {showClose && (
              <button
                onClick={close}
                className="shrink-0 cursor-pointer font-mono text-[9px] tracking-[0.25em] text-fog transition-colors hover:text-accent"
                aria-label="Return to the core"
              >
                × CORE
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
