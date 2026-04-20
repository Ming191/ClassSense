import { createClient, type RedisClientType } from 'redis'

import { getRedisUrl } from '@/lib/server/env'
import { getSession } from '@/lib/server/session-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

function channelToEvent(channel: string, id: string): 'score' | 'hci' | 'heatmap' | null {
  if (channel === `scores:${id}`) {
    return 'score'
  }
  if (channel === `hci:${id}`) {
    return 'hci'
  }
  if (channel === `heatmap:${id}`) {
    return 'heatmap'
  }
  return null
}

export async function GET(request: Request, context: { params: Params }) {
  const { id } = await context.params
  const session = getSession(id)
  if (!session) {
    return jsonError('Session not found', 404)
  }

  const redisUrl = getRedisUrl()
  if (!redisUrl) {
    return jsonError('Redis unavailable', 503)
  }

  let subscriber: RedisClientType
  try {
    subscriber = createClient({ url: redisUrl })
    await subscriber.connect()
  } catch {
    return jsonError('Redis unavailable', 503)
  }

  const encoder = new TextEncoder()
  const channels = [`scores:${id}`, `hci:${id}`, `heatmap:${id}`]

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      writeEvent('ready', { sessionId: id, roomName: session.roomName })

      try {
        await subscriber.subscribe(channels, (message, channel) => {
          const event = channelToEvent(channel, id)
          if (!event) {
            return
          }

          let payload: unknown = message
          try {
            payload = JSON.parse(message)
          } catch {
            // keep raw string
          }

          writeEvent(event, payload)
        })
      } catch {
        controller.error(new Error('Redis subscription failed'))
      }

      request.signal.addEventListener('abort', async () => {
        try {
          await subscriber.unsubscribe(channels)
          await subscriber.quit()
        } catch {
          // noop
        }
        controller.close()
      })
    },
    async cancel() {
      try {
        await subscriber.unsubscribe(channels)
        await subscriber.quit()
      } catch {
        // noop
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
