import { AccessToken } from 'livekit-server-sdk'

import { getLivekitApiKey, getLivekitApiSecret, getLivekitUrlPublic } from '@/lib/server/env'
import { getSession, type ParticipantRole } from '@/lib/server/session-store'

export const runtime = 'nodejs'

type Params = Promise<{ id: string }>

type TokenBody = {
  identity?: string
  displayName?: string
  role?: ParticipantRole
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

async function parseJsonBody(request: Request): Promise<TokenBody | null> {
  try {
    return (await request.json()) as TokenBody
  } catch {
    return null
  }
}

function resolveIdentity(input?: string): string {
  if (input?.trim()) {
    return input.trim()
  }

  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // noop
  }

  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function roleGrants(role: ParticipantRole) {
  if (role === 'teacher') {
    return {
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: true,
    }
  }

  if (role === 'service') {
    return {
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      roomAdmin: false,
    }
  }

  return {
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    roomAdmin: false,
  }
}

export async function POST(request: Request, context: { params: Params }) {
  const { id } = await context.params
  const session = await getSession(id)
  if (!session) {
    return jsonError('Session not found', 404)
  }

  const body = await parseJsonBody(request)
  if (body === null) {
    return jsonError('Malformed JSON body', 400)
  }

  const role: ParticipantRole = body.role ?? 'student'
  if (!['teacher', 'student', 'service'].includes(role)) {
    return jsonError('Invalid role', 400)
  }

  const identity = resolveIdentity(body.identity)

  try {
    const token = new AccessToken(getLivekitApiKey(), getLivekitApiSecret(), {
      identity,
      name: body.displayName?.trim() || identity,
    })

    token.addGrant({
      room: session.roomName,
      ...roleGrants(role),
    })

    const jwt = await token.toJwt()

    return Response.json({
      token: jwt,
      livekitUrl: getLivekitUrlPublic() ?? null,
      roomName: session.roomName,
      sessionId: session.id,
      identity,
      role,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to issue token'
    return jsonError(message, 500)
  }
}
