/**
 * One place where provider transport problems become structured results.
 *
 * Every failure mode the brief lists — rate limit, timeout, malformed body,
 * unavailable model, network failure — lands here and comes out as a typed
 * `{ ok: false, code }`, because "RAVEN silently returned nothing" is the worst
 * possible outcome and "RAVEN said the provider is rate limited and answered from
 * local knowledge instead" is the correct one.
 */

export type HttpFailure = {
  ok: false
  code: 'rate_limited' | 'timeout' | 'network' | 'bad_response' | 'unavailable' | 'auth'
  message: string
  status?: number
  retryAfterMs?: number
  ms: number
}

export type HttpSuccess = {
  ok: true
  status: number
  json: unknown
  raw: string
  ms: number
}

export type HttpRequest = {
  url: string
  method?: 'POST' | 'GET'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs: number
  /** Attempts beyond the first. Backoff is exponential, `Retry-After` wins when present. */
  retries?: number
  retryBaseMs?: number
  /** Overridable so tests never actually sleep. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 30_000)))

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) return undefined
  const seconds = Number.parseInt(header, 10)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

/** Only transient statuses are worth a second attempt; a 400 will fail identically. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

export async function requestJson(request: HttpRequest): Promise<HttpSuccess | HttpFailure> {
  const started = Date.now()
  const sleep = request.sleep ?? defaultSleep
  const attempts = Math.max(1, 1 + (request.retries ?? 0))
  let last: HttpFailure | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), request.timeoutMs)
    let response: Response | null = null
    let raw = ''
    try {
      response = await fetch(request.url, {
        method: request.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(request.headers ?? {}) },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: controller.signal,
      })
      raw = await response.text().catch(() => '')
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError' || controller.signal.aborted
      last = aborted
        ? { ok: false, code: 'timeout', message: `No response within ${request.timeoutMs} ms.`, ms: Date.now() - started }
        : { ok: false, code: 'network', message: `Transport failure: ${(error as Error)?.message ?? 'unknown'}`, ms: Date.now() - started }
    } finally {
      clearTimeout(timer)
    }

    if (response) {
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
        const detail = summarizeErrorBody(raw)
        last = {
          ok: false,
          code: response.status === 429 ? 'rate_limited' : response.status === 401 || response.status === 403 ? 'auth' : RETRYABLE.has(response.status) ? 'unavailable' : 'bad_response',
          message: `${response.status} ${response.statusText || ''}${detail ? ` — ${detail}` : ''}`.trim(),
          status: response.status,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          ms: Date.now() - started,
        }
        if (RETRYABLE.has(response.status) && attempt + 1 < attempts) {
          await sleep(retryAfterMs ?? (request.retryBaseMs ?? 500) * 2 ** attempt)
          continue
        }
        return last
      }

      try {
        return { ok: true, status: response.status, json: raw ? JSON.parse(raw) : {}, raw, ms: Date.now() - started }
      } catch {
        return {
          ok: false,
          code: 'bad_response',
          message: `Body was not JSON (${raw.length} bytes: ${JSON.stringify(raw.slice(0, 120))})`,
          status: response.status,
          ms: Date.now() - started,
        }
      }
    }

    // Network/timeout: one bounded retry, because these are the transient ones.
    if (attempt + 1 < attempts) {
      await sleep((request.retryBaseMs ?? 400) * 2 ** attempt)
      continue
    }
  }

  return last ?? { ok: false, code: 'network', message: 'Request never completed.', ms: Date.now() - started }
}

/** Providers wrap their real message in a `error.message`; surface that if present. */
function summarizeErrorBody(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string; status?: string } }
    const message = parsed?.error?.message || parsed?.error?.status
    if (message) return String(message).slice(0, 220)
  } catch {
    /* not JSON; quote the head of it instead */
  }
  return trimmed.slice(0, 180)
}
