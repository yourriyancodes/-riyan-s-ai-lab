import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'

// Self-hosted open-source fonts (SIL OFL 1.1, $0). next/font/google downloads
// at build time, which makes the build fail on any machine without egress to
// fonts.googleapis.com. These resolve from node_modules instead.
import { themeInitScript } from '@/lib/theme'

import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/cormorant-garamond'
import './globals.css'

export const metadata: Metadata = {
  title: 'Riyan Pasha — Technologist, Developer, Builder',
  description: 'A personal technology portfolio by Riyan Pasha.',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" data-theme="dark" style={{ colorScheme: 'dark' }}>
      <head>
        {/* Applies the saved (or OS) theme before first paint: a light-theme
            visitor must never see a dark flash, and the WebGL stages read the
            same attribute, so 2D and 3D can never disagree on load. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
