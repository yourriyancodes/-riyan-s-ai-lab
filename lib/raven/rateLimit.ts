/**
 * In-process sliding-window rate limiter.
 *
 * It is per-instance on purpose: on a serverless deploy there is no shared store to
 * coordinate against, and pretending otherwise (a Redis-shaped solution to a
 * three-line problem) would be theatre. What it does buy is real protection for the
 * common case — one browser tab in a loop, or a script against a single dev server —
 * and it reports `retryAfterMs` so the client can back off instead of retrying blindly.
 */
export type RateLimitOptions = { windowMs: number; maxRequests: number }

type Bucket = { hits: number[] }

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 500

export type RateLimitResult = { allowed: boolean; used: number; limit: number; retryAfterMs: number }

export function checkRateLimit(key: string, options: RateLimitOptions, now = Date.now()): RateLimitResult {
  const windowStart = now - options.windowMs
  const bucket = buckets.get(key) ?? { hits: [] }
  bucket.hits = bucket.hits.filter((hit) => hit > windowStart)
  if (bucket.hits.length >= options.maxRequests) {
    buckets.set(key, bucket)
    const earliest = bucket.hits[0] ?? now
    return { allowed: false, used: bucket.hits.length, limit: options.maxRequests, retryAfterMs: Math.max(250, earliest + options.windowMs - now) }
  }
  bucket.hits.push(now)
  buckets.set(key, bucket)
  if (buckets.size > MAX_KEYS) {
    // Drop stale visitors so a busy process cannot leak memory.
    for (const [candidate, entry] of buckets) {
      if (!entry.hits.length || entry.hits[entry.hits.length - 1] < windowStart) buckets.delete(candidate)
      if (buckets.size <= MAX_KEYS / 2) break
    }
  }
  return { allowed: true, used: bucket.hits.length, limit: options.maxRequests, retryAfterMs: 0 }
}

export function rateLimitSnapshot(): { keys: number; requestsInWindow: number } {
  let total = 0
  for (const bucket of buckets.values()) total += bucket.hits.length
  return { keys: buckets.size, requestsInWindow: total }
}

export function resetRateLimiter(): void {
  buckets.clear()
}
