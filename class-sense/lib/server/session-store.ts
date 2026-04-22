import { SessionStatus as PrismaSessionStatus } from '@prisma/client'

import { prisma } from '@/lib/server/prisma'
import { publishSessionLifecycleEvent } from '@/lib/server/lifecycle-publisher'

export type ParticipantRole = 'teacher' | 'student' | 'service'

export type SessionStatus = 'active' | 'completed'

export type Session = {
  id: string
  name: string
  createdAt: string
  status: SessionStatus
  roomName: string
}

function toSessionStatus(status: SessionStatus): PrismaSessionStatus {
  return status === 'completed' ? PrismaSessionStatus.COMPLETED : PrismaSessionStatus.ACTIVE
}

function fromSessionStatus(status: PrismaSessionStatus): SessionStatus {
  return status === PrismaSessionStatus.COMPLETED ? 'completed' : 'active'
}

function toSessionDto(session: {
  id: string
  name: string
  createdAt: Date
  status: PrismaSessionStatus
  roomName: string
}): Session {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt.toISOString(),
    status: fromSessionStatus(session.status),
    roomName: session.roomName,
  }
}

export function generateSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // noop
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function createSession(input: { id?: string; name?: string; roomName?: string }): Promise<Session> {
  const id = input.id || generateSessionId()
  const roomName = input.roomName || `classsense-${id}`
  const created = await prisma.session.create({
    data: {
      id,
      name: input.name?.trim() || `Session ${id}`,
      roomName,
      status: PrismaSessionStatus.ACTIVE,
    },
  })

  const session = toSessionDto(created)

  await publishSessionLifecycleEvent({
    type: 'session.created',
    sessionId: session.id,
    roomName: session.roomName,
    timestamp: new Date().toISOString(),
  })

  return session
}

export async function getSession(id: string): Promise<Session | undefined> {
  const session = await prisma.session.findUnique({
    where: { id },
  })

  return session ? toSessionDto(session) : undefined
}

export async function listSessions(filter?: { status?: SessionStatus }): Promise<Session[]> {
  const sessions = await prisma.session.findMany({
    where: filter?.status
      ? {
          status: toSessionStatus(filter.status),
        }
      : undefined,
    orderBy: {
      createdAt: 'desc',
    },
  })

  return sessions.map(toSessionDto)
}

export async function markSessionCompleted(id: string): Promise<Session | undefined> {
  try {
    const updated = await prisma.session.update({
      where: { id },
      data: {
        status: PrismaSessionStatus.COMPLETED,
        completedAt: new Date(),
      },
    })

    return toSessionDto(updated)
  } catch {
    return undefined
  }
}
