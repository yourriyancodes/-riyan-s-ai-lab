import { useState, type FormEvent } from 'react'
import PanelShell from './PanelShell'
import { profile } from '../data/portfolio'

/**
 * CONTACT — the calmest sector. Heading, direct links and a message form
 * that composes a mailto draft (no backend required).
 */
export default function ContactPanel() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const subject = encodeURIComponent(`Portfolio message from ${name || 'a visitor'}`)
    const body = encodeURIComponent(`${message}\n\n— ${name}\n${email}`)
    window.location.href = `mailto:${profile.contact.email}?subject=${subject}&body=${body}`
    setSent(true)
  }

  const inputCls =
    'w-full rounded-md border border-line/70 bg-ink/50 px-3 py-2 font-mono text-[11px] text-snow placeholder:text-fog/35 focus:border-accent/60 focus:outline-none transition-colors'

  return (
    <PanelShell label="CONTACT" align="right" wide>
      <div className="anim-fade-up text-right">
        <h2 className="font-display text-xl font-semibold leading-snug tracking-[0.08em] text-snow md:text-[22px]">
          LET'S BUILD SOMETHING
          <span className="block text-accent">INTELLIGENT.</span>
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-fog">
          AI products, intelligent systems, data-driven ideas — Riyan is
          always open to problems worth solving.
        </p>

        {/* direct links */}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <a
            href={`mailto:${profile.contact.email}`}
            className="tech-chip cursor-pointer transition-all hover:border-accent hover:text-accent"
          >
            EMAIL ↗
          </a>
          <a
            href={profile.contact.linkedin}
            target="_blank"
            rel="noreferrer"
            className="tech-chip cursor-pointer transition-all hover:border-accent hover:text-accent"
          >
            LINKEDIN ↗
          </a>
          <a
            href={profile.contact.github}
            target="_blank"
            rel="noreferrer"
            className="tech-chip cursor-pointer transition-all hover:border-accent hover:text-accent"
          >
            GITHUB ↗
          </a>
        </div>

        {/* form */}
        <form onSubmit={submit} className="mt-5 space-y-3 text-left">
          <div>
            <label className="tech-label" htmlFor="c-name">NAME</label>
            <input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Your name"
              className={`${inputCls} mt-1.5`}
            />
          </div>
          <div>
            <label className="tech-label" htmlFor="c-email">EMAIL</label>
            <input
              id="c-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className={`${inputCls} mt-1.5`}
            />
          </div>
          <div>
            <label className="tech-label" htmlFor="c-msg">MESSAGE</label>
            <textarea
              id="c-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={3}
              placeholder="What are you building?"
              className={`${inputCls} mt-1.5 resize-none`}
            />
          </div>
          <button
            type="submit"
            className="w-full cursor-pointer rounded-full bg-accent py-2.5 font-mono text-[10px] tracking-[0.28em] text-ink transition-all hover:bg-snow hover:shadow-[0_0_30px_rgba(69,224,255,0.35)]"
          >
            SEND MESSAGE
          </button>
          {sent && (
            <p className="anim-fade-in text-center font-mono text-[9px] tracking-[0.2em] text-accent">
              ✓ YOUR MAIL CLIENT IS OPENING WITH THE DRAFT
            </p>
          )}
        </form>

        <p className="mt-4 border-t border-line/60 pt-3 font-mono text-[8.5px] leading-relaxed tracking-[0.14em] text-fog/55">
          * EMAIL & SOCIAL LINKS ARE PLACEHOLDERS — UPDATE src/data/portfolio.ts
        </p>
      </div>
    </PanelShell>
  )
}
