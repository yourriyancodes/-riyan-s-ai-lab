/**
 * Provider resolution. The brain asks for "a provider" and gets one, or gets null and
 * routes around it; nothing above this layer knows or cares which vendor answered.
 */
import { ravenApiKey, ravenConfig, type RavenConfig } from '../config'
import { createGeminiProvider, clearGeminiProbeCache } from './gemini'
import { createOpenAiCompatibleProvider, clearOpenAiProbeCache } from './openai'
import type { ModelProvider } from '../types'

export { RAVEN_PERSONA, buildMessages, cleanReply, extractJsonObject } from './prompt'
export type { GroundingInput } from './prompt'
export { createGeminiProvider } from './gemini'
export { createOpenAiCompatibleProvider } from './openai'

/**
 * Returns the configured provider, or `null` when there is nothing to call.
 * `null` is the normal case for a fresh clone with no credentials — not an error.
 */
export function resolveProvider(config: RavenConfig = ravenConfig()): ModelProvider | null {
  const { provider } = config
  if (!provider.id || !provider.model) return null
  const apiKey = ravenApiKey()
  if (provider.id === 'gemini') {
    // Gemini requires a key; without one there is nothing to resolve.
    if (!apiKey) return null
    return createGeminiProvider({
      apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl,
      timeoutMs: provider.timeoutMs,
      maxRetries: provider.maxRetries,
      temperature: provider.temperature,
      maxOutputTokens: provider.maxOutputTokens,
    })
  }
  // An OpenAI-compatible server on localhost is usable with no key at all.
  return createOpenAiCompatibleProvider({
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey,
    timeoutMs: provider.timeoutMs,
    maxRetries: provider.maxRetries,
    temperature: provider.temperature,
    maxOutputTokens: provider.maxOutputTokens,
    supportJsonMode: process.env.RAVEN_PROVIDER_JSON !== '0',
  })
}

export type ProviderProbe = { reachable: boolean; detail: string; provider: string | null }

export async function probeProvider(config: RavenConfig = ravenConfig()): Promise<ProviderProbe> {
  const provider = resolveProvider(config)
  if (!provider) {
    return { reachable: false, detail: config.provider.id ? `provider "${config.provider.id}" selected but incomplete (model or key missing)` : 'no provider configured', provider: null }
  }
  try {
    const result = await provider.probe()
    return { ...result, provider: provider.id }
  } catch (error) {
    return { reachable: false, detail: `probe threw: ${(error as Error)?.message ?? 'unknown'}`, provider: provider.id }
  }
}

/** Test seam: probe caching must not leak between cases. */
export function clearProviderProbeCaches(): void {
  clearGeminiProbeCache()
  clearOpenAiProbeCache()
}
