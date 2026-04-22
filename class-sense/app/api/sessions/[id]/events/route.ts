import { prisma } from '@/lib/server/prisma'
import { getSession } from '@/lib/server/session-store'

type Params = Promise<{ id: string }>
type EventTypeFilter = 'score' | 'hci' | 'all'

const DEFAULT_LIMIT = 100
const MIN_LIMIT = 1
const MAX_LIMIT = 200

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

function parseTypeFilter(value: string | null): EventTypeFilter {
  if (value === 'score' || value === 'hci' || value === 'all') {
    return value
  }
  return 'all'
}

function parseLimit(value: string | null): number {
  if (!value) {
    return DEFAULT_LIMIT
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed))
}

export async function GET(request: Request, context: { params: Params }) {
  const { id } = await context.params
  const session = await getSession(id)
  if (!session) {
    return jsonError('Session not found', 404)
  }

  const { searchParams } = new URL(request.url)
  const type = parseTypeFilter(searchParams.get('type'))
  const limit = parseLimit(searchParams.get('limit'))

  const [scoreEvents, hciEvents] = await Promise.all([
    type === 'hci'
      ? Promise.resolve([])
      : prisma.scoreEvent.findMany({
          where: { sessionId: id },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
    type === 'score'
      ? Promise.resolve([])
      : prisma.hciEvent.findMany({
          where: { sessionId: id },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
  ])

  return Response.json({
    scoreEvents,
    hciEvents,
  })
}
