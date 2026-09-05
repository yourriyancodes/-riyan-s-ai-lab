import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const STATES = [
  'IDLE', 'LISTENING', 'UNDERSTANDING', 'RESEARCHING', 'REASONING',
  'PLANNING', 'WAITING', 'EXECUTING', 'VERIFYING', 'SPEAKING',
  'SUCCESS', 'WARNING', 'ERROR', 'OFFLINE',
] as const

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

  const input =
    typeof body === 'object' &&
    body !== null &&
    'input' in body &&
    typeof body.input === 'string'
      ? body.input.trim()
      : ''

  if (!input) {
    return NextResponse.json(
      { state: 'ERROR', code: 'INPUT_REQUIRED', message: 'RAVEN needs an input.' },
      { status: 400 },
    )
  }

  if (input.length > 4000) {
    return NextResponse.json(
      { state: 'ERROR', code: 'INPUT_TOO_LONG', message: 'Input is limited to 4000 characters.' },
      { status: 413 },
    )
  }

  const providerConfigured = Boolean(process.env.RAVEN_API_KEY && process.env.RAVEN_MODEL)

  if (!providerConfigured) {
    return NextResponse.json(
      {
        state: 'OFFLINE',
        code: 'RAVEN_OFFLINE',
        message: 'RAVEN is not connected to an AI provider yet.',
        availableStates: STATES,
      },
      { status: 503 },
    )
  }

  return NextResponse.json(
    {
      state: 'WARNING',
      code: 'PROVIDER_ADAPTER_NOT_IMPLEMENTED',
      message: 'The provider is configured, but its adapter still needs to be connected.',
    },
    { status: 501 },
  )
}
