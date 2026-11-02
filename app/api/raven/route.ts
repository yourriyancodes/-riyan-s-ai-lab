import { NextResponse } from 'next/server'
import { runRaven } from '@/lib/raven/pipeline'
import { resolveProviderConfig } from '@/lib/raven/provider'
import { parseRavenRequest } from '@/lib/raven/types'

export const runtime = 'nodejs'

function statusFor(response: { state: string }): number {
  switch (response.state) {
    case 'SUCCESS':
      return 200
    case 'WAITING':
      return 429
    case 'OFFLINE':
      return 503
    case 'WARNING':
      return 200
    default:
      // Provider failure or a rejected answer: the upstream call did not produce
      // a usable, verified response.
      return 502
  }
}

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { state: 'ERROR', code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
      { status: 400 },
    )
  }

  const parsed = parseRavenRequest(body)
  if (!parsed.ok) {
    return NextResponse.json(
      { state: 'ERROR', code: parsed.code, message: parsed.message },
      { status: parsed.status },
    )
  }

  // Credentials stay on the server: only this route resolves them.
  const resolution = resolveProviderConfig()

  if (!resolution.configured) {
    return NextResponse.json(
      {
        state: 'OFFLINE',
        code: resolution.reason === 'UNSUPPORTED_PROVIDER' ? 'PROVIDER_UNSUPPORTED' : 'RAVEN_OFFLINE',
        message:
          resolution.reason === 'UNSUPPORTED_PROVIDER'
            ? `Provider "${resolution.providerId}" is not supported by this build. Use "gemini".`
            : 'RAVEN is not connected to an AI provider yet. Set RAVEN_API_KEY (or GEMINI_API_KEY) and RAVEN_MODEL on the server.',
      },
      { status: 503 },
    )
  }

  const response = await runRaven(parsed.input, parsed.history, {
    provider: resolution.provider,
  })

  return NextResponse.json(response, { status: statusFor(response) })
}
