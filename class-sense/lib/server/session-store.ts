import { SessionStatus as PrismaSessionStatus } from '@prisma/client'

import { prisma } from '@/lib/server/prisma'

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

export async function createSession(input: { id: string; name?: string; roomName: string }): Promise<Session> {
  const created = await prisma.session.create({
    data: {
      id: input.id,
      name: input.name?.trim() || `Session ${input.id}`,
      roomName: input.roomName,
      status: PrismaSessionStatus.ACTIVE,
    },
  })

  return toSessionDto(created)
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
