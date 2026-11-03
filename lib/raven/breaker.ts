/**
 * The provider circuit breaker, in one place.
 *
 * It used to be four lines inside `brain.ts`, incremented by hand at each call site. Two
 * consecutive failures stop this process from calling the endpoint for a minute, because a
 * provider that returned 401 or 500 twice will not befriend you on the third try, and every
 * attempt costs the user latency they are watching in the console.
 *
 * Living in its own module is what lets `system_status` report it. The brain could be
 * imported, but `brain → tools → brain` is a cycle held together by ESM's tolerance, and a
 * status read is not worth that. Nothing here touches the network.
 */
/**
 * Two consecutive failures, then a minute of silence. Both numbers are configurable because they are
 * a cost policy, not a law of physics: a deployment on a free tier with 30 requests a minute wants the
 * breaker to trip early and stay shut, while a paid endpoint behind a flaky network wants a shorter
 * window. The defaults are what this repository measured against (`RAVEN_TIMEOUT_MS=25s`,
 * `RAVEN_MAX_RETRIES=2`): at threshold 2 a hung endpoint cost one user ~76 seconds before the third
 * turn was skipped outright.
 */
const FAILURE_THRESHOLD = Math.max(1, Number(process.env.RAVEN_BREAKER_THRESHOLD ?? 2) || 2)
const OPEN_MS = Math.max(1000, Number(process.env.RAVEN_BREAKER_COOLDOWN_MS ?? 60_000) || 60_000)

const state = { failures: 0, openUntil: 0 }

export type ProviderBreakerState = { failures: number; open: boolean; openForMs: number; threshold: number }

export function providerBreakerState(): ProviderBreakerState {
  return {
    failures: state.failures,
    open: Date.now() < state.openUntil,
    openForMs: Math.max(0, state.openUntil - Date.now()),
    threshold: FAILURE_THRESHOLD,
  }
}

export function recordProviderFailure(): void {
  state.failures++
  if (state.failures >= FAILURE_THRESHOLD) state.openUntil = Date.now() + OPEN_MS
}

export function recordProviderSuccess(): void {
  state.failures = 0
  state.openUntil = 0
}

export function resetProviderBreaker(): void {
  state.failures = 0
  state.openUntil = 0
}
