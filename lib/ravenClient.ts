import type { RavenResponse, RavenTurn } from './raven/types'

export type {
  RavenResponse,
  RavenState,
  RavenTurn,
  RavenSuccess,
  RavenFailure,
  RavenSource,
  RavenUsage,
} from './raven/types'

export type RavenHealth = {
  status: string
  providerConfigured: boolean
  /** Present for older deployments that only exposed this flag. */
  apiKeyConfigured?: boolean
  provider?: {
    id: string
    model: string
    configured: boolean
    keySource?: string
    reason?: string
  }
  providerCatalog?: {
    id: string
    defaultModel: string
    freeTierModels: readonly string[]
  }
  ownerAuthConfigured?: boolean
  voiceConfigured?: boolean
  databaseConfigured?: boolean
}

/**
 * Browser client for the RAVEN endpoint.
 *
 * Sends the canonical `{ input, history }` body the API expects and returns the
 * typed response. Never references a credential — the key lives on the server.
 */
export async function askRaven(input: string, history: RavenTurn[] = []): Promise<RavenResponse> {
  const response = await fetch('/api/raven', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, history }),
  })

  const data = (await response.json().catch(() => null)) as RavenResponse | null

  if (!data || typeof data !== 'object' || !('state' in data)) {
    return {
      state: 'ERROR',
      code: 'INVALID_RESPONSE',
      message: 'RAVEN returned an unreadable response.',
    }
  }

  return data
}

export async function getRavenHealth(): Promise<RavenHealth | null> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' })
    if (!response.ok) return null
    return (await response.json()) as RavenHealth
  } catch {
    return null
  }
}
