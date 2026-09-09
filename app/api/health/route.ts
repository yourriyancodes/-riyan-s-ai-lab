/**
 * GET /api/health — what this deployment can actually do, measured rather than declared.
 *
 * The previous version of this file hard-coded `providerAdapterImplemented: false` and
 * `databaseReachable: false`. Both are now derived: the provider value comes from the
 * implementation existing, and the database value from opening it. A probe is only run
 * when a provider is configured, so an unauthenticated visitor cannot make this route
 * spend API quota.
 */
import { describeCapabilities, ravenConfig } from '@/lib/raven/config'
import { inspectDatabase } from '@/lib/raven/db'
import { probeProvider } from '@/lib/raven/providers'
import { providerBreakerState } from '@/lib/raven/brain'
import { rateLimitSnapshot } from '@/lib/raven/rateLimit'
import { corpusStats } from '@/lib/raven/knowledge/corpus'
import { RAVEN_STATES } from '@/lib/raven/states'
import { TOOL_SPECS } from '@/lib/raven/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const config = ravenConfig()
  const capabilities = describeCapabilities(config)
  // `probe=0` opts out. Otherwise a configured provider is probed for real — the probe is
  // one model-list request and the provider caches it for a minute, so polling this
  // route cannot spend generation quota.
  const shouldProbe = capabilities.providerConfigured && new URL(request.url).searchParams.get('probe') !== '0'

  const database = await inspectDatabase(config)
  const providerProbe = shouldProbe ? await probeProvider(config) : null
  const providerReachable = providerProbe ? providerProbe.reachable : false
  // Three separate facts, because collapsing them is what made a rejected key look like a
  // working model. `authorized` is null when no probe ran or the endpoint never got to
  // judge the credential — null is "unknown", and it is printed as such rather than as false.
  const providerAuthorized = providerProbe ? providerProbe.authorized : null

  const body = {
    ok: true,
    service: 'raven-brain',
    time: new Date().toISOString(),
    capabilities: {
      ...capabilities,
      // Reported as booleans and names only; a key is never echoed by this route.
      providerKeyPresent: config.provider.apiKeyPresent,
    },
    provider: {
      configured: capabilities.providerConfigured,
      id: capabilities.providerId,
      label: capabilities.providerLabel,
      model: capabilities.providerModel,
      baseUrl: config.provider.baseUrl,
      probed: providerProbe ? { reachable: providerProbe.reachable, authorized: providerProbe.authorized, detail: providerProbe.detail } : null,
      breaker: providerBreakerState(),
    },
    database: {
      driver: database.driver,
      configured: database.configured,
      reachable: database.reachable,
      detail: database.detail,
      degradedFrom: database.notes,
      tables: ['raven_conversations', 'raven_messages', 'raven_memories', 'raven_agent_runs', 'raven_tool_runs'],
    },
    // Flat compatibility block: `lib/ravenClient.ts` and the console's capability chips
    // read these keys, and every one of them is derived here rather than hard-coded.
    providerConfigured: capabilities.providerConfigured,
    providerAdapterImplemented: capabilities.providerAdapterImplemented,
    providerReachable,
    providerAuthorized,
    databaseConfigured: capabilities.databaseConfigured,
    databaseReachable: database.reachable,
    voiceConfigured: capabilities.voiceConfigured,
    // There is no owner/admin role in this build, so it is reported unset rather than
    // implied by the presence of a key.
    ownerAuthConfigured: false,
    // A key the endpoint refuses is not a live provider, so READY requires the third fact.
    // `authorized: null` (never probed) also cannot earn READY — only a probe that came back
    // "yes, this credential works" does.
    status:
      capabilities.providerConfigured && providerReachable && providerAuthorized === true && database.reachable
        ? 'READY'
        : capabilities.providerConfigured || database.reachable
          ? 'PARTIALLY_READY'
          : 'OFFLINE',
    note: !capabilities.providerConfigured
      ? 'Offline/local reasoning is active: no provider configured, so every answer comes from the deterministic knowledge and agent layers.'
      : providerReachable && providerAuthorized === false
        ? 'The provider endpoint answered but rejected the credentials (401/403). The key is present and unusable; the brain degrades to local knowledge.'
        : !providerReachable
          ? 'A provider key exists but the endpoint did not answer; the brain degrades to local knowledge.'
          : database.reachable
            ? 'Knowledge, provider and persistence are all live.'
            : 'Provider live, persistence degraded to its fallback store.',
    knowledge: corpusStats(),
    tools: TOOL_SPECS.map((entry) => ({ name: entry.spec.name, permission: entry.spec.permission, requiresApproval: Boolean(entry.spec.requiresApproval) })),
    states: RAVEN_STATES,
    rateLimit: rateLimitSnapshot(),
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
