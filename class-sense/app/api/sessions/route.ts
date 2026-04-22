import { createSession, listSessions } from '@/lib/server/session-store'
import { ensureEventIngestorStarted } from '@/lib/server/event-ingestor'

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


function resolveStatusFilter(value: string | null): 'active' | 'completed' | undefined {
  if (value === 'active' || value === 'completed') {
    return value
  }
  return undefined
}

export async function GET(request: Request) {
  ensureEventIngestorStarted()

  const url = new URL(request.url)
  const status = resolveStatusFilter(url.searchParams.get('status'))
  const sessions = await listSessions(status ? { status } : undefined)
  return Response.json({ sessions })
}

export async function POST(request: Request) {
  ensureEventIngestorStarted()

  const body = await parseJsonBody(request)
  if (body === null) {
    return jsonError('Malformed JSON body', 400)
  }

  const session = await createSession({ name: body.name })

  return Response.json({ session }, { status: 201 })
}
