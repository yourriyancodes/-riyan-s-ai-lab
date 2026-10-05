/**
 * Provider resolution. The brain asks for "a provider" and gets one, or gets null and
 * routes around it; nothing above this layer knows or cares which vendor answered.
 */
import { ravenApiKey, ravenConfig, type RavenConfig } from '../config'
import { createGeminiProvider, clearGeminiProbeCache } from './gemini'
import { createOpenAiCompatibleProvider, clearOpenAiProbeCache } from './openai'
import type { ModelProvider } from '../types'
import { requestJson } from './http'

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

export type ProviderProbe = { reachable: boolean; authorized: boolean | null; detail: string; provider: string | null }

export async function probeProvider(config: RavenConfig = ravenConfig()): Promise<ProviderProbe> {
  const provider = resolveProvider(config)
  if (!provider) {
    return { reachable: false, authorized: null, detail: config.provider.id ? `provider "${config.provider.id}" selected but incomplete (model or key missing)` : 'no provider configured', provider: null }
  }
  try {
    const result = await provider.probe()
    // `authorized` stays null when the provider could not tell us anything — an unreadable
    // endpoint has not been given the chance to accept or refuse the key.
    return { ...result, authorized: result.authorized ?? null, provider: provider.id }
  } catch (error) {
    return { reachable: false, authorized: null, detail: `probe threw: ${(error as Error)?.message ?? 'unknown'}`, provider: provider.id }
  }
}

export type LocalModelReport = {
  /** Whether the question was asked at all (`probe=0` on /api/health skips it). */
  probed: boolean
  /** Something answered HTTP on that address. */
  reachable: boolean
  /** It answered *and* served a model list. `null` when unreachable, so nobody reads "false" as a refusal. */
  authorized: boolean | null
  detail: string
  baseUrl: string
  /** Whether the brain would use this right now — true only when it is also the configured provider. */
  selected: boolean
  /** What to do about a reachable, unselected endpoint. An instruction, not a switch. */
  hint?: string
}

const LOCAL_CACHE_MS = 60_000
let localCache: { at: number; value: LocalModelReport } | null = null

/**
 * "Is there a model on this machine?" answered by asking.
 *
 * The zero-cost requirement makes a local OpenAI-compatible server (Ollama, LM Studio) the normal
 * development answer, and `RAVEN_PROVIDER=openai` already points at one by default. What must not
 * happen is a status page reporting a model as available because a port *might* be open, so this
 * probes `/models` under a short budget and caches the measurement. `selected` is the honest part:
 * detection never changes routing, because quietly sending a user's questions to whatever is
 * listening on localhost is a bigger mistake than not detecting anything.
 */
export async function detectLocalProvider(config: RavenConfig = ravenConfig(), options: { probe?: boolean } = {}): Promise<LocalModelReport> {
  const baseUrl = config.provider.localProbeUrl.replace(/\/$/, '')
  const selected = Boolean(config.provider.id) && config.provider.baseUrl.replace(/\/$/, '') === baseUrl
  if (options.probe === false) {
    return { probed: false, reachable: false, authorized: null, detail: 'not probed (probe=0)', baseUrl, selected }
  }
  if (localCache && Date.now() - localCache.at < LOCAL_CACHE_MS) return { ...localCache.value, selected }

  const response = await requestJson({ url: `${baseUrl}/models`, method: 'GET', timeoutMs: config.provider.localProbeTimeoutMs, retries: 0 })
  let value: LocalModelReport
  if (response.ok) {
    const models = (response.json as { data?: { id?: string }[] } | undefined)?.data ?? []
    const served = models.length
      ? `${models.length} model(s) served${models[0]?.id ? `: "${models[0].id}"` : ''}`
      : 'answered, but returned no model list'
    value = { probed: true, reachable: true, authorized: models.length > 0 ? true : null, detail: served, baseUrl, selected, ...(selected ? {} : { hint: `set RAVEN_PROVIDER=openai, RAVEN_BASE_URL=${baseUrl} (no key needed) to use it` }) }
  } else {
    const answered = response.code !== 'network' && response.code !== 'timeout'
    value = {
      probed: true,
      reachable: answered,
      authorized: response.code === 'auth' ? false : null,
      detail: answered ? `${response.code}: ${response.message}` : `nothing is listening on ${baseUrl} (${response.code})`,
      baseUrl,
      selected,
    }
  }
  localCache = { at: Date.now(), value: { ...value, selected } }
  return value
}

/** Test seam: probe caching must not leak between cases. */
export function clearProviderProbeCaches(): void {
  clearGeminiProbeCache()
  clearOpenAiProbeCache()
  localCache = null
}
