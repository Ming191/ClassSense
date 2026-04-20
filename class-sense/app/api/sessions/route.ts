import { createSession, listSessions } from '@/lib/server/session-store'

type CreateSessionBody = {
  name?: string
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

async function parseJsonBody(request: Request): Promise<CreateSessionBody | null> {
  try {
    return (await request.json()) as CreateSessionBody
  } catch {
    return null
  }
}

function generateSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // noop
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function GET() {
  return Response.json({ sessions: listSessions() })
}

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) {
    return jsonError('Malformed JSON body', 400)
  }

  const id = generateSessionId()
  const roomName = `classsense-${id}`
  const session = createSession({ id, name: body.name, roomName })

  return Response.json({ session }, { status: 201 })
}
