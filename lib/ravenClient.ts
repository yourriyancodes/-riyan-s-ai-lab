export type RavenState =
  | 'IDLE' | 'LISTENING' | 'UNDERSTANDING' | 'RESEARCHING' | 'REASONING'
  | 'PLANNING' | 'WAITING' | 'EXECUTING' | 'VERIFYING' | 'SPEAKING'
  | 'SUCCESS' | 'WARNING' | 'ERROR' | 'OFFLINE'

export type RavenResponse = {
  state: RavenState
  output?: string
  code?: string
  message?: string
}

export async function askRaven(input: string): Promise<RavenResponse> {
  const response = await fetch('/api/raven', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  })

  const data = (await response.json().catch(() => ({}))) as RavenResponse

  if (!response.ok) {
    return {
      state: data.state ?? 'ERROR',
      code: data.code ?? 'REQUEST_FAILED',
      message: data.message ?? 'RAVEN could not process the request.',
    }
  }

  return data
}

export async function getRavenHealth() {
  const response = await fetch('/api/health', { cache: 'no-store' })
  return response.json()
}
