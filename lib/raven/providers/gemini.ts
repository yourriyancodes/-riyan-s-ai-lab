/**
 * Google Gemini (Developer API) provider, over plain REST.
 *
 * Why REST and not the SDK: the brief is a zero-dependency backend, `fetch` is in the
 * Node version Next 16 already requires, and the response shape is one object. The
 * key travels in the `x-goog-api-key` header rather than the query string so it cannot
 * end up in an access log or an error message that quotes the URL.
 */
import { requestJson, type HttpFailure } from './http'
import { cleanReply } from './prompt'
import type { ModelProvider, ProviderRequest, ProviderResult } from '../types'

type GeminiPart = { text?: string }
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { message?: string; status?: string }
}

/** Keep the probe result briefly: /api/health is polled, the quota is not free. */
const PROBE_TTL_MS = 60_000
let probeCache: { at: number; value: { reachable: boolean; detail: string } } | null = null

export type GeminiOptions = {
  apiKey: string
  model: string
  baseUrl?: string
  apiVersion?: string
  timeoutMs: number
  maxRetries?: number
  temperature?: number
  maxOutputTokens?: number
  sleep?: (ms: number) => Promise<void>
}

const API_VERSION = 'v1beta'

export function createGeminiProvider(options: GeminiOptions): ModelProvider {
  const base = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')
  const url = (path: string) => `${base}/${options.apiVersion ?? API_VERSION}${path}`
  const headers = { 'x-goog-api-key': options.apiKey }
  const failure = (error: HttpFailure): ProviderResult => ({
    ok: false,
    provider: 'gemini',
    code: error.code === 'auth' ? 'unavailable' : error.code === 'bad_response' ? 'bad_response' : error.code,
    message: error.message,
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    ms: error.ms,
  })

  return {
    id: 'gemini',
    label: 'Google Gemini (Developer API)',
    async probe() {
      if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.value
      const response = await requestJson({ url: url('/models'), method: 'GET', headers, timeoutMs: Math.min(options.timeoutMs, 8000), sleep: options.sleep })
      const value = response.ok
        ? (() => {
            const models = ((response.json as { models?: { name?: string }[] })?.models ?? []).map((entry) => entry.name ?? '')
            const wanted = `models/${options.model}`
            const found = models.some((name) => name === wanted || name.endsWith(`/${options.model}`))
            return {
              reachable: true,
              detail: models.length
                ? found
                  ? `${models.length} model(s) listed; "${options.model}" available`
                  : `${models.length} model(s) listed but "${options.model}" was not among them`
                : 'reachable, but the model list came back empty',
            }
          })()
        : { reachable: false, detail: `${response.code}: ${response.message}` }
      probeCache = { at: Date.now(), value }
      return value
    },
    async generate(request: ProviderRequest): Promise<ProviderResult> {
      const started = Date.now()
      const system = request.messages.find((message) => message.role === 'system')?.content
      const contents = request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }))

      const body = {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature: request.temperature ?? options.temperature ?? 0.35,
          maxOutputTokens: request.maxOutputTokens ?? options.maxOutputTokens ?? 1024,
          ...(request.json ? { responseMimeType: 'application/json' } : {}),
        },
      }

      const response = await requestJson({
        url: url(`/models/${encodeURIComponent(options.model)}:generateContent`),
        method: 'POST',
        headers,
        body,
        timeoutMs: options.timeoutMs,
        retries: request.signal ? 0 : (options.maxRetries ?? 0),
        sleep: options.sleep,
      })

      if (!response.ok) return failure(response)

      const payload = response.json as GeminiResponse
      const blockReason = payload?.promptFeedback?.blockReason
      if (blockReason) {
        return { ok: false, provider: 'gemini', code: 'refused', message: `The provider blocked the prompt (${blockReason}).`, ms: Date.now() - started }
      }
      const candidate = payload?.candidates?.[0]
      const text = cleanReply((candidate?.content?.parts ?? []).map((part) => part.text ?? '').join(''))
      if (!text) {
        const reason = candidate?.finishReason
        return {
          ok: false,
          provider: 'gemini',
          code: reason && reason !== 'STOP' ? 'refused' : 'bad_response',
          message: reason && reason !== 'STOP' ? `Provider returned no text (finishReason ${reason}).` : 'Provider returned an empty completion.',
          ms: Date.now() - started,
        }
      }
      const inputChars = request.messages.reduce((total, message) => total + message.content.length, 0)
      return {
        ok: true,
        text,
        model: options.model,
        provider: 'gemini',
        usage: {
          inputChars,
          outputChars: text.length,
          ...(payload?.usageMetadata?.promptTokenCount === undefined ? {} : { inputTokens: payload.usageMetadata.promptTokenCount }),
          ...(payload?.usageMetadata?.candidatesTokenCount === undefined ? {} : { outputTokens: payload.usageMetadata.candidatesTokenCount }),
        },
        ms: Date.now() - started,
      }
    },
  }
}

export function clearGeminiProbeCache(): void {
  probeCache = null
}
