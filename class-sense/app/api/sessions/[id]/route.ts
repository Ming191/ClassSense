import { getSession, markSessionCompleted } from '@/lib/server/session-store'
import { publishSessionLifecycleEvent } from '@/lib/server/lifecycle-publisher'
import { ensureEventIngestorStarted } from '@/lib/server/event-ingestor'

type Params = Promise<{ id: string }>

type PatchBody = {
  status?: 'completed'
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

async function parseJsonBody(request: Request): Promise<PatchBody | null> {
  try {
    return (await request.json()) as PatchBody
  } catch {
    return null
  }
}

export async function GET(_request: Request, context: { params: Params }) {
  ensureEventIngestorStarted()

  const { id } = await context.params
  const session = await getSession(id)

  if (!session) {
    return jsonError('Session not found', 404)
  }

  return Response.json({ session })
}

export async function PATCH(request: Request, context: { params: Params }) {
  ensureEventIngestorStarted()

  const { id } = await context.params
  const session = await getSession(id)
  if (!session) {
    return jsonError('Session not found', 404)
  }

  const body = await parseJsonBody(request)
  if (body === null) {
    return jsonError('Malformed JSON body', 400)
  }

  if (body.status !== 'completed') {
    return jsonError("Only status: 'completed' is supported", 400)
  }

  const updated = await markSessionCompleted(id)
  if (!updated) {
    return jsonError('Session not found', 404)
  }

  await publishSessionLifecycleEvent({
    type: 'session.completed',
    sessionId: updated.id,
    roomName: updated.roomName,
    timestamp: new Date().toISOString(),
  })

  return Response.json({ session: updated })
}
