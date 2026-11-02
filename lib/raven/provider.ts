import {
  createGeminiProvider,
  DEFAULT_TIMEOUT_MS,
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  type RavenProvider,
} from './gemini'

/**
 * Provider resolution from environment variables (server-side only).
 *
 * Supported keys, in order of precedence:
 *   RAVEN_API_KEY   — canonical name used by this project
 *   GEMINI_API_KEY  — accepted so an existing Google AI Studio setup works
 *
 * Nothing here is exported to the browser; only `/api/raven` may call it.
 */

export type ProviderEnv = Record<string, string | undefined>

export type ProviderResolution =
  | {
      configured: true
      provider: RavenProvider
      providerId: string
      model: string
      keySource: 'RAVEN_API_KEY' | 'GEMINI_API_KEY'
    }
  | {
      configured: false
      reason: 'MISSING_API_KEY' | 'UNSUPPORTED_PROVIDER'
      providerId: string
      model: string
    }

export type ResolveProviderOptions = {
  fetchImpl?: typeof fetch
}

export function resolveProviderConfig(
  env: ProviderEnv = process.env,
  options: ResolveProviderOptions = {},
): ProviderResolution {
  const providerId = (env.RAVEN_PROVIDER ?? 'gemini').trim().toLowerCase() || 'gemini'
  const model = (env.RAVEN_MODEL ?? '').trim() || GEMINI_DEFAULT_MODEL
  const baseUrl = (env.RAVEN_API_BASE_URL ?? '').trim() || GEMINI_DEFAULT_BASE_URL
  const timeoutMs = Number(env.RAVEN_TIMEOUT_MS ?? '') || DEFAULT_TIMEOUT_MS

  if (providerId !== 'gemini') {
    // Fail closed: an unknown provider must never silently fall back to a stub.
    return { configured: false, reason: 'UNSUPPORTED_PROVIDER', providerId, model }
  }

  const ravenKey = (env.RAVEN_API_KEY ?? '').trim()
  const geminiKey = (env.GEMINI_API_KEY ?? '').trim()
  const apiKey = ravenKey || geminiKey

  if (!apiKey) {
    return { configured: false, reason: 'MISSING_API_KEY', providerId, model }
  }

  return {
    configured: true,
    providerId,
    model,
    keySource: ravenKey ? 'RAVEN_API_KEY' : 'GEMINI_API_KEY',
    provider: createGeminiProvider({
      apiKey,
      model,
      baseUrl,
      timeoutMs,
      fetchImpl: options.fetchImpl,
    }),
  }
}

/** Safe, key-free description for /api/health and logs. */
export function describeProvider(env: ProviderEnv = process.env) {
  const resolution = resolveProviderConfig(env, {})
  return {
    id: resolution.providerId,
    model: resolution.model,
    configured: resolution.configured,
    ...(resolution.configured ? { keySource: resolution.keySource } : { reason: resolution.reason }),
  }
}
