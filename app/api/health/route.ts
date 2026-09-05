import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL)
  const providerConfigured = Boolean(process.env.RAVEN_API_KEY && process.env.RAVEN_MODEL)
  const sessionConfigured = Boolean(process.env.SESSION_SECRET)

  return NextResponse.json({
    service: 'raven-web',
    databaseConfigured,
    databaseReachable: false,
    providerConfigured,
    providerReachable: false,
    ownerAuthConfigured: sessionConfigured,
    voiceConfigured: Boolean(process.env.VOICE_PROVIDER_KEY),
    status: providerConfigured && databaseConfigured ? 'PARTIALLY_READY' : 'OFFLINE',
    note: 'Infrastructure is reported honestly. No unavailable service is simulated.',
  })
}
