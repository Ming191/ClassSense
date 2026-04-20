export type ParticipantRole = 'teacher' | 'student' | 'service'

export type SessionStatus = 'active' | 'completed'

export type Session = {
  id: string
  name: string
  createdAt: string
  status: SessionStatus
  roomName: string
}

export type CreateTokenInput = {
  identity?: string
  displayName: string
  role: Extract<ParticipantRole, 'teacher' | 'student'>
}

export type TokenResponse = {
  token: string
  livekitUrl: string | null
  roomName: string
  sessionId: string
  identity: string
  role: ParticipantRole
}

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return undefined
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const details = await readErrorBody(response)
    const message =
      typeof details === 'object' && details !== null && 'error' in details
        ? String((details as { error?: unknown }).error ?? `Request failed (${response.status})`)
        : `Request failed (${response.status})`
    throw new ApiError(message, response.status, details)
  }

  return (await response.json()) as T
}

export async function createSession(name?: string): Promise<Session> {
  const payload = name?.trim() ? { name: name.trim() } : {}
  const data = await requestJson<{ session: Session }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.session
}

export async function listSessions(): Promise<Session[]> {
  const data = await requestJson<{ sessions: Session[] }>('/api/sessions', {
    method: 'GET',
  })
  return data.sessions
}

export async function createToken(sessionId: string, input: CreateTokenInput): Promise<TokenResponse> {
  return requestJson<TokenResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/token`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function endSession(sessionId: string): Promise<Session> {
  const data = await requestJson<{ session: Session }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  })
  return data.session
}
