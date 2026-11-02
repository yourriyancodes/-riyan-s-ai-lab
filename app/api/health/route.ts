import { NextResponse } from 'next/server'
import { describeProvider } from '@/lib/raven/provider'
import { FREE_TIER_MODELS, GEMINI_DEFAULT_MODEL } from '@/lib/raven/gemini'

export const runtime = 'nodejs'

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL)
  const provider = describeProvider()
  const sessionConfigured = Boolean(process.env.SESSION_SECRET)

  return NextResponse.json({
    service: 'raven-web',
    databaseConfigured,
    databaseReachable: false,
    // Kept for older clients that read `apiKeyConfigured`.
    apiKeyConfigured: provider.configured,
    providerConfigured: provider.configured,
    providerReachable: false,
    provider,
    providerCatalog: {
      id: 'gemini',
      defaultModel: GEMINI_DEFAULT_MODEL,
      freeTierModels: FREE_TIER_MODELS,
    },
    ownerAuthConfigured: sessionConfigured,
    voiceConfigured: Boolean(process.env.VOICE_PROVIDER_KEY),
    status: provider.configured ? 'PROVIDER_CONFIGURED' : 'OFFLINE',
    note: 'Infrastructure is reported honestly. No unavailable service is simulated.',
  })
}
