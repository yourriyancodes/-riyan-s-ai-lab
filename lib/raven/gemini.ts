import type { GeminiContent } from './prompt'
import type { RavenUsage } from './types'

/**
 * Genuine Gemini provider adapter.
 *
 * Uses the public REST endpoint `POST /v1beta/models/{model}:generateContent`
 * documented at https://ai.google.dev/api/generate-content with the API key in
 * the `x-goog-api-key` header, so the credential never appears in a URL or in
 * client code. This module is server-only; it must never be imported by a
 * component that ships to the browser.
 */

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
export const DEFAULT_TIMEOUT_MS = 20_000

/** Free-tier eligible models verified against the current Gemini pricing page. */
export const FREE_TIER_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
] as const

export type ProviderErrorCode =
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTH_ERROR'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_BAD_REQUEST'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_BAD_RESPONSE'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly httpStatus: number
  readonly retryAfterSeconds?: number

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { httpStatus?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.httpStatus = options.httpStatus ?? 0
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export type GenerateRequest = {
  systemInstruction: string
  contents: GeminiContent[]
  temperature?: number
  maxOutputTokens?: number
}

export type GenerateResult = {
  text: string
  usage?: RavenUsage
  finishReason?: string
  modelVersion?: string
}

/**
 * Minimal provider surface. Any future zero-cost provider implements this so
 * the pipeline stays provider-agnostic.
 */
export type RavenProvider = {
  id: string
  model: string
  generate(request: GenerateRequest): Promise<GenerateResult>
}

export type GeminiProviderOptions = {
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

type GeminiApiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  modelVersion?: string
  error?: { code?: number; message?: string; status?: string }
}

export function createGeminiProvider(options: GeminiProviderOptions): RavenProvider {
  const model = options.model?.trim() || GEMINI_DEFAULT_MODEL
  const baseUrl = (options.baseUrl?.trim() || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    id: 'gemini',
    model,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`

      const payload: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: request.contents,
        generationConfig: {
          temperature: request.temperature ?? 0.6,
          maxOutputTokens: request.maxOutputTokens ?? 1024,
        },
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let response: Response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': options.apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          cache: 'no-store',
        })
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        throw new ProviderError(
          aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
          aborted
            ? `Gemini did not respond within ${timeoutMs} ms.`
            : 'Could not reach the Gemini API from this server.',
        )
      } finally {
        clearTimeout(timer)
      }

      const body = (await response.json().catch(() => null)) as GeminiApiResponse | null

      if (!response.ok) {
        throw mapHttpError(response, body)
      }

      const blockReason = body?.promptFeedback?.blockReason
      if (blockReason) {
        throw new ProviderError('PROVIDER_BLOCKED', `Gemini blocked the prompt (${blockReason}).`)
      }

      const candidate = body?.candidates?.[0]
      const text = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim()

      if (!text) {
        const finish = candidate?.finishReason ?? 'UNKNOWN'
        throw new ProviderError(
          'PROVIDER_BAD_RESPONSE',
          finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT'
            ? `Gemini stopped the response for safety reasons (${finish}).`
            : `Gemini returned no text (finish reason: ${finish}).`,
        )
      }

      const usage = body?.usageMetadata
      return {
        text,
        finishReason: candidate?.finishReason,
        modelVersion: body?.modelVersion,
        usage:
          usage?.totalTokenCount || usage?.promptTokenCount || usage?.candidatesTokenCount
            ? {
                promptTokens: usage?.promptTokenCount,
                candidateTokens: usage?.candidatesTokenCount,
                totalTokens: usage?.totalTokenCount,
              }
            : undefined,
      }
    },
  }
}

function mapHttpError(response: Response, body: GeminiApiResponse | null): ProviderError {
  const status = response.status
  const detail = body?.error?.message ?? response.statusText ?? 'Unknown Gemini error'
  const retryAfter = Number(response.headers.get('retry-after') ?? '')

  const options = {
    httpStatus: status,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  }

  if (status === 400) return new ProviderError('PROVIDER_BAD_REQUEST', detail, options)
  if (status === 401 || status === 403) {
    return new ProviderError(
      'PROVIDER_AUTH_ERROR',
      'Gemini rejected the API key. Check RAVEN_API_KEY (or GEMINI_API_KEY).',
      options,
    )
  }
  if (status === 404) {
    return new ProviderError(
      'PROVIDER_MODEL_NOT_FOUND',
      'The configured Gemini model was not found for this API key.',
      options,
    )
  }
  if (status === 429) {
    return new ProviderError(
      'PROVIDER_RATE_LIMITED',
      'Gemini free-tier rate limit reached. Retry later or choose a lighter model.',
      options,
    )
  }
  if (status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', detail, options)

  return new ProviderError('PROVIDER_BAD_RESPONSE', detail, options)
}
