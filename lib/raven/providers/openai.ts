/**
 * OpenAI-compatible chat-completions provider.
 *
 * This exists for two reasons. First, the brain must not be built around one vendor,
 * so a second implementation proves the abstraction is real rather than decorative.
 * Second, it is the ₹0 path that matters most here: Ollama and LM Studio both serve
 * this wire format on localhost with no key and no bill, so "GenAI enabled" can mean
 * "a local model" instead of "a paid account".
 */
import { requestJson, type HttpFailure } from './http'
import { cleanReply } from './prompt'
import type { ModelProvider, ProviderRequest, ProviderResult } from '../types'

type ChatCompletion = {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; type?: string }
}

const PROBE_TTL_MS = 60_000
let probeCache: { at: number; value: { reachable: boolean; detail: string } } | null = null

export type OpenAiCompatibleOptions = {
  baseUrl: string
  model: string
  apiKey?: string | null
  timeoutMs: number
  maxRetries?: number
  temperature?: number
  maxOutputTokens?: number
  /** Some local servers reject `response_format`; set RAVEN_PROVIDER_JSON=0 to opt out. */
  supportJsonMode?: boolean
  sleep?: (ms: number) => Promise<void>
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): ModelProvider {
  const base = options.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
  const failure = (error: HttpFailure): ProviderResult => ({
    ok: false,
    provider: 'openai-compatible',
    code: error.code === 'auth' ? 'unavailable' : error.code,
    message: error.message,
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    ms: error.ms,
  })

  return {
    id: 'openai',
    label: `OpenAI-compatible endpoint (${base})`,
    async probe() {
      if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.value
      const response = await requestJson({ url: `${base}/models`, method: 'GET', headers, timeoutMs: Math.min(options.timeoutMs, 8000), sleep: options.sleep })
      const value = response.ok
        ? (() => {
            const data = (response.json as { data?: { id?: string }[] })?.data ?? []
            const ids = data.map((entry) => entry.id ?? '')
            const found = ids.some((id) => id === options.model || id.startsWith(`${options.model}:`))
            return {
              reachable: true,
              detail: ids.length
                ? found
                  ? `${ids.length} model(s) served; "${options.model}" available`
                  : `${ids.length} model(s) served but "${options.model}" was not among them`
                : 'endpoint answered, but listed no models',
            }
          })()
        : { reachable: false, detail: `${response.code}: ${response.message}` }
      probeCache = { at: Date.now(), value }
      return value
    },
    async generate(request: ProviderRequest): Promise<ProviderResult> {
      const started = Date.now()
      const body = {
        model: options.model,
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
        temperature: request.temperature ?? options.temperature ?? 0.35,
        max_tokens: request.maxOutputTokens ?? options.maxOutputTokens ?? 1024,
        ...(request.json && options.supportJsonMode !== false ? { response_format: { type: 'json_object' } } : {}),
      }
      const response = await requestJson({
        url: `${base}/chat/completions`,
        method: 'POST',
        headers,
        body,
        timeoutMs: options.timeoutMs,
        retries: options.maxRetries ?? 0,
        sleep: options.sleep,
      })
      if (!response.ok) return failure(response)

      const payload = response.json as ChatCompletion
      const choice = payload?.choices?.[0]
      const text = cleanReply(choice?.message?.content ?? '')
      if (!text) {
        return {
          ok: false,
          provider: 'openai-compatible',
          code: choice?.finish_reason && choice.finish_reason !== 'stop' ? 'refused' : 'bad_response',
          message: payload?.error?.message ?? (choice?.finish_reason ? `No text (finish_reason ${choice.finish_reason}).` : 'Endpoint returned no message content.'),
          ms: Date.now() - started,
        }
      }
      return {
        ok: true,
        text,
        model: options.model,
        provider: 'openai-compatible',
        usage: {
          inputChars: request.messages.reduce((total, message) => total + message.content.length, 0),
          outputChars: text.length,
          ...(payload?.usage?.prompt_tokens === undefined ? {} : { inputTokens: payload.usage.prompt_tokens }),
          ...(payload?.usage?.completion_tokens === undefined ? {} : { outputTokens: payload.usage.completion_tokens }),
        },
        ms: Date.now() - started,
      }
    },
  }
}

export function clearOpenAiProbeCache(): void {
  probeCache = null
}
