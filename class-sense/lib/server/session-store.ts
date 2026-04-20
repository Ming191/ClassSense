export type ParticipantRole = 'teacher' | 'student' | 'service'

export type SessionStatus = 'active' | 'completed'

export type Session = {
  id: string
  name: string
  createdAt: string
  status: SessionStatus
  roomName: string
}

const sessions = new Map<string, Session>()

export function createSession(input: { id: string; name?: string; roomName: string }): Session {
  const session: Session = {
    id: input.id,
    name: input.name?.trim() || `Session ${input.id}`,
    createdAt: new Date().toISOString(),
    status: 'active',
    roomName: input.roomName,
  }

  sessions.set(session.id, session)
  return session
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function listSessions(): Session[] {
  return [...sessions.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function markSessionCompleted(id: string): Session | undefined {
  const existing = sessions.get(id)
  if (!existing) {
    return undefined
  }

  const updated: Session = {
    ...existing,
    status: 'completed',
  }

  sessions.set(id, updated)
  return updated
}
