/**
 * Server-side configuration for the RAVEN backend.
 *
 * Rules this file exists to enforce:
 *  - Secrets are read here and nowhere else, and are **never** returned to a
 *    caller that could serialize them: `describeCapabilities()` reports booleans.
 *  - Every value is resolved per call, not at module load, so tests can set an
 *    environment variable and observe the change. It also means a redeploy with a
 *    new key does not need a process restart to take effect in a dev server.
 *  - Nothing here is required. With no key and no database the brain still runs —
 *    that is the whole point of the offline mode.
 */
import type { DatabaseDriver } from './types'

export type RavenProviderId = 'gemini' | 'openai'

export type RavenConfig = {
  provider: {
    id: RavenProviderId | null
    label: string
    /** Presence only. The key itself is never part of this object — see ravenApiKey(). */
    apiKeyPresent: boolean
    model: string | null
    baseUrl: string
    timeoutMs: number
    maxRetries: number
    /** Only used by `openai` (local servers accept 0..2); clamped before use. */
    temperature: number
    maxOutputTokens: number
  }
  limits: {
    /** Matches the input cap the console and the previous route already honoured. */
    maxMessageChars: number
    maxBodyBytes: number
    maxHistoryMessages: number
    /** Recent messages are trimmed to this many characters, newest-first. */
    contextCharBudget: number
    maxMemoriesInContext: number
    /** Agentic turns are budgeted, not allowed to wander. */
    agentMaxSteps: number
    agentStepTimeoutMs: number
    agentTurnTimeoutMs: number
    rateLimit: { windowMs: number; maxRequests: number }
    /** Tool inputs are validated against these. */
    maxQueryChars: number
    maxEnumOptions: number
  }
  database: {
    url: string | null
    /** Forced driver wins; otherwise postgres → (sqlite if a path is set) → file → memory. */
    forced: DatabaseDriver | null
    dataDir: string
    /** Set RAVEN_SQLITE_PATH to a file to prefer the SQLite adapter over the JSON store. */
    sqlitePath: string | null
    timeoutMs: number
    /** Supabase REST (PostgREST) transport — the dependency-free managed option. */
    restUrl: string | null
    restKey: string | null
  }
  session: { secret: string | null; cookieName: string; maxAgeSeconds: number }
  voiceConfigured: boolean
  /** Set when RAVEN may write its dev fallback store to disk at all. */
  allowFileStore: boolean
}

const env = (key: string): string | undefined => {
  if (typeof process === 'undefined' || !process.env) return undefined
  const value = process.env[key]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  // An empty `KEY=` in .env.local means "not set", not "empty credential".
  return trimmed.length ? trimmed : undefined
}

const int = (key: string, fallback: number): number => {
  const raw = env(key)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const PROVIDER_LABELS: Record<RavenProviderId, string> = {
  gemini: 'Google Gemini (Developer API)',
  openai: 'OpenAI-compatible endpoint (also serves local Ollama / LM Studio)',
}

/** Which provider the key implies, unless `RAVEN_PROVIDER` says otherwise. */
function resolveProviderId(apiKey: string | undefined): RavenProviderId | null {
  const forced = env('RAVEN_PROVIDER')?.toLowerCase()
  if (forced === 'none' || forced === 'off' || forced === 'local') return null
  if (forced === 'gemini' || forced === 'openai') return forced
  if (!apiKey) return null
  // A base URL pointing at a local model server is an OpenAI-compatible surface.
  const baseUrl = env('RAVEN_BASE_URL')
  if (baseUrl && !/generativelanguage\.googleapis\.com/.test(baseUrl)) return 'openai'
  return 'gemini'
}

/**
 * The credential itself, for the one caller that needs it. Kept out of `RavenConfig`
 * deliberately: config objects get logged, serialized into health payloads and stuck in
 * debug output, and a key inside one of those is a leak with a five-minute fuse.
 */
export function ravenApiKey(): string | null {
  return env('RAVEN_API_KEY') ?? null
}

export function ravenConfig(): RavenConfig {
  const apiKey = env('RAVEN_API_KEY') ?? null
  const model = env('RAVEN_MODEL') ?? null
  const baseUrl = env('RAVEN_BASE_URL') ?? null
  const id = apiKey || baseUrl ? resolveProviderId(apiKey ?? undefined) : null
  const dataDir = env('RAVEN_DATA_DIR') ?? '.raven-data'
  // Every real driver name is accepted here. `postgres-rest` was missing from this list
  // until the sqlite work, which meant `RAVEN_DB_DRIVER=postgres-rest` was silently ignored
  // and the auto order ran instead — the config said one driver, the process used another.
  const forcedRaw = env('RAVEN_DB_DRIVER')?.toLowerCase()
  const forced: DatabaseDriver | null =
    forcedRaw === 'postgres' || forcedRaw === 'postgres-rest' || forcedRaw === 'sqlite' || forcedRaw === 'file' || forcedRaw === 'memory'
      ? (forcedRaw as DatabaseDriver)
      : null
  const sqlitePath = env('RAVEN_SQLITE_PATH') ?? null
  const url = env('DATABASE_URL') ?? env('SUPABASE_DB_URL') ?? null

  return {
    provider: {
      id,
      label: id ? PROVIDER_LABELS[id] : 'none (deterministic local engine only)',
      apiKeyPresent: Boolean(apiKey),
      model: model ?? (id === 'gemini' ? 'gemini-2.5-flash' : id === 'openai' ? 'llama3.1' : null),
      baseUrl:
        baseUrl ??
        (id === 'openai' ? 'http://127.0.0.1:11434/v1' : 'https://generativelanguage.googleapis.com'),
      timeoutMs: int('RAVEN_TIMEOUT_MS', 25_000),
      maxRetries: Math.min(3, int('RAVEN_MAX_RETRIES', 2)),
      temperature: Math.max(0, Math.min(2, Number(env('RAVEN_TEMPERATURE') ?? 0.35))),
      maxOutputTokens: int('RAVEN_MAX_OUTPUT_TOKENS', 1024),
    },
    limits: {
      maxMessageChars: int('RAVEN_MAX_MESSAGE_CHARS', 4000),
      maxBodyBytes: int('RAVEN_MAX_BODY_BYTES', 64 * 1024),
      maxHistoryMessages: int('RAVEN_MAX_HISTORY', 40),
      contextCharBudget: int('RAVEN_CONTEXT_CHAR_BUDGET', 6000),
      maxMemoriesInContext: int('RAVEN_MAX_MEMORIES', 8),
      agentMaxSteps: int('RAVEN_AGENT_MAX_STEPS', 6),
      agentStepTimeoutMs: int('RAVEN_AGENT_STEP_TIMEOUT_MS', 8000),
      agentTurnTimeoutMs: int('RAVEN_AGENT_TURN_TIMEOUT_MS', 30_000),
      rateLimit: { windowMs: int('RAVEN_RATE_WINDOW_MS', 60_000), maxRequests: int('RAVEN_RATE_MAX', 30) },
      maxQueryChars: int('RAVEN_MAX_QUERY_CHARS', 400),
      maxEnumOptions: int('RAVEN_MAX_ENUM_OPTIONS', 64),
    },
    database: {
      url,
      forced,
      dataDir,
      // Explicit path means "use SQLite for this". Unset means SQLite is only reached when
      // RAVEN_DB_DRIVER asks for it, so a fresh clone keeps the dependency-free file store
      // instead of silently taking on an experimental runtime API.
      sqlitePath,
      timeoutMs: int('RAVEN_DB_TIMEOUT_MS', 5000),
      restUrl: env('SUPABASE_URL') ?? null,
      // Anon key is acceptable only if RLS allows the service writes; a service-role key
      // bypasses RLS and therefore stays server-side. Neither is ever returned to a client.
      restKey: env('SUPABASE_DB_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_ANON_KEY') ?? null,
    },
    session: {
      secret: env('SESSION_SECRET') ?? null,
      cookieName: 'raven_session',
      maxAgeSeconds: int('RAVEN_SESSION_MAX_AGE', 60 * 60 * 24 * 30),
    },
    voiceConfigured: Boolean(env('VOICE_PROVIDER_KEY')),
    allowFileStore: env('RAVEN_ALLOW_FILE_STORE') !== '0' && !env('NEXTJS_RUNTIME')?.includes('edge'),
  }
}

/**
 * Everything `/api/health` may say about infrastructure. Note the shape: keys are
 * reported as *present or absent*, never as values, and `providerReachable` comes
 * from an actual probe rather than from the existence of a string.
 */
export type RavenCapabilities = {
  providerConfigured: boolean
  providerId: RavenProviderId | null
  providerLabel: string
  providerModel: string | null
  /** True when the brain can talk to a provider at all (implementation exists). */
  providerAdapterImplemented: boolean
  databaseConfigured: boolean
  databaseRestConfigured: boolean
  databaseDriver: DatabaseDriver
  fileStoreAllowed: boolean
  sessionSecretConfigured: boolean
  voiceConfigured: boolean
  limits: RavenConfig['limits']
  /** Non-secret env names the deployment can set, for the console's hints. */
  envVars: string[]
}

export function describeCapabilities(config = ravenConfig()): RavenCapabilities {
  return {
    providerConfigured: Boolean(config.provider.id && config.provider.apiKeyPresent),
    providerId: config.provider.id,
    providerLabel: config.provider.label,
    providerModel: config.provider.model,
    providerAdapterImplemented: true,
    databaseConfigured: Boolean(config.database.url || (config.database.restUrl && config.database.restKey)),
    databaseRestConfigured: Boolean(config.database.restUrl && config.database.restKey),
    databaseDriver:
      config.database.forced ??
      (config.database.url
        ? 'postgres'
        : config.database.restUrl && config.database.restKey
          ? 'postgres-rest'
          : config.allowFileStore
            ? 'file'
            : 'memory'),
    fileStoreAllowed: config.allowFileStore,
    sessionSecretConfigured: Boolean(config.session.secret),
    voiceConfigured: config.voiceConfigured,
    limits: config.limits,
    envVars: [
      'RAVEN_API_KEY',
      'RAVEN_MODEL',
      'RAVEN_PROVIDER',
      'RAVEN_BASE_URL',
      'RAVEN_TEMPERATURE',
      'RAVEN_TIMEOUT_MS',
      'RAVEN_MAX_RETRIES',
      'RAVEN_MAX_OUTPUT_TOKENS',
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_DB_KEY',
      'RAVEN_DATA_DIR',
      'RAVEN_DB_DRIVER',
      'RAVEN_ALLOW_FILE_STORE',
      'RAVEN_AGENT_MAX_STEPS',
      'RAVEN_CONTEXT_CHAR_BUDGET',
      'SESSION_SECRET',
      'VOICE_PROVIDER_KEY',
    ],
  }
}
