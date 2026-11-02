import { ProviderError, type RavenProvider } from './gemini'
import { retrieveKnowledge, type KnowledgeResult } from './knowledge'
import { authorizeTool } from './policy'
import { buildContents, buildSystemInstruction } from './prompt'
import type { RavenResponse, RavenState, RavenTurn } from './types'
import { verifyOutput } from './verify'

/**
 * RAVEN runtime.
 *
 * Stages, in order, and each one is recorded in the response `trace`:
 *   UNDERSTANDING → RESEARCHING → PLANNING → EXECUTING → VERIFYING → SPEAKING
 *
 * Local knowledge is always retrieved first, so answers stay grounded even if
 * the provider is unavailable. Verification always runs before an answer is
 * returned, and no state-changing tool can run without approval.
 */

export type RavenDeps = {
  provider: RavenProvider | null
  retrieve?: (query: string) => KnowledgeResult
}

const TRACE_BASE: RavenState[] = ['UNDERSTANDING', 'RESEARCHING', 'PLANNING']

export async function runRaven(
  input: string,
  history: RavenTurn[],
  deps: RavenDeps,
): Promise<RavenResponse> {
  const retrieve = deps.retrieve ?? retrieveKnowledge
  const trace: RavenState[] = [...TRACE_BASE]

  // RESEARCHING — always ground in local knowledge first.
  const knowledge = retrieve(input)

  // PLANNING — the only tool this runtime may use is read-only lookup.
  const authorization = authorizeTool('knowledge.lookup')
  if (!authorization.allowed) {
    return { state: 'WARNING', code: authorization.code, message: authorization.message }
  }

  // EXECUTING — no provider means fail closed, never fabricate an answer.
  if (!deps.provider) {
    return {
      state: 'OFFLINE',
      code: 'RAVEN_OFFLINE',
      message:
        'RAVEN is not connected to an AI provider yet. Set RAVEN_API_KEY (or GEMINI_API_KEY) and RAVEN_MODEL on the server.',
    }
  }

  trace.push('EXECUTING')

  let generated: Awaited<ReturnType<RavenProvider['generate']>>
  try {
    generated = await deps.provider.generate({
      systemInstruction: buildSystemInstruction({ context: knowledge.context, history }),
      contents: buildContents(history, input),
      temperature: 0.6,
      maxOutputTokens: 1024,
    })
  } catch (error) {
    return failureFromProviderError(error)
  }

  // VERIFYING — reject empty, oversized, leaking or credential-shaped output.
  trace.push('VERIFYING')
  const verification = verifyOutput(generated.text)
  if (!verification.ok) {
    return {
      state: 'ERROR',
      code: `OUTPUT_REJECTED_${verification.issue}`,
      message: verification.message,
    }
  }

  trace.push('SPEAKING', 'SUCCESS')

  return {
    state: 'SUCCESS',
    output: verification.output,
    provider: deps.provider.id,
    model: generated.modelVersion ?? deps.provider.model,
    grounded: knowledge.sources.length > 0,
    sources: knowledge.sources,
    toolUsed: knowledge.toolUsed,
    usage: generated.usage,
    trace,
  }
}

function failureFromProviderError(error: unknown): RavenResponse {
  if (!(error instanceof ProviderError)) {
    return {
      state: 'ERROR',
      code: 'PROVIDER_FAILURE',
      message: 'The provider call failed before RAVEN could answer.',
    }
  }

  switch (error.code) {
    case 'PROVIDER_RATE_LIMITED':
      return {
        state: 'WAITING',
        code: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      }
    case 'PROVIDER_AUTH_ERROR':
    case 'PROVIDER_MODEL_NOT_FOUND':
    case 'PROVIDER_BAD_REQUEST':
      return { state: 'ERROR', code: error.code, message: error.message }
    case 'PROVIDER_BLOCKED':
      return { state: 'WARNING', code: error.code, message: error.message }
    default:
      return { state: 'OFFLINE', code: error.code, message: error.message }
  }
}

/** Exposed for the route to report which stages are even reachable. */
export function reachableStages(providerConfigured: boolean): RavenState[] {
  return providerConfigured ? [...TRACE_BASE, 'EXECUTING', 'VERIFYING', 'SPEAKING'] : [...TRACE_BASE]
}
