import { type Prisma } from '@prisma/client'
import { createClient } from 'redis'

import { getRedisUrl } from '@/lib/server/env'
import { prisma } from '@/lib/server/prisma'

type IngestorState = {
  started: boolean
  starting: Promise<void> | null
}

const globalForEventIngestor = globalThis as unknown as {
  __classSenseEventIngestor?: IngestorState
}

function getIngestorState(): IngestorState {
  if (!globalForEventIngestor.__classSenseEventIngestor) {
    globalForEventIngestor.__classSenseEventIngestor = {
      started: false,
      starting: null,
    }
  }

  return globalForEventIngestor.__classSenseEventIngestor
}

function toPayload(message: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(message) as Prisma.InputJsonValue
  } catch {
    return message
  }
}

async function persistFromChannel(channel: string, message: string): Promise<void> {
  if (channel.startsWith('scores:')) {
    const sessionId = channel.slice('scores:'.length)
    if (!sessionId) {
      return
    }

    await prisma.scoreEvent.create({
      data: {
        sessionId,
        payload: toPayload(message),
      },
    })
    return
  }

  if (channel.startsWith('hci:')) {
    const sessionId = channel.slice('hci:'.length)
    if (!sessionId) {
      return
    }

    await prisma.hciEvent.create({
      data: {
        sessionId,
        payload: toPayload(message),
      },
    })
  }
}

async function startIngestor(state: IngestorState): Promise<void> {
  const redisUrl = getRedisUrl()
  if (!redisUrl) {
    return
  }

  const subscriber = createClient({ url: redisUrl })

  subscriber.on('error', (error: unknown) => {
    console.error('Event ingestor redis subscriber error', error)
  })

  await subscriber.connect()

  const handlePatternMessage = async (message: string, channel: string) => {
    try {
      await persistFromChannel(channel, message)
    } catch (error: unknown) {
      console.error('Event ingestor persistence failed', {
        channel,
        error,
      })
    }
  }

  await subscriber.pSubscribe('scores:*', handlePatternMessage)
  await subscriber.pSubscribe('hci:*', handlePatternMessage)
  state.started = true
}

export function ensureEventIngestorStarted(): void {
  const state = getIngestorState()
  if (state.started || state.starting) {
    return
  }

  state.starting = startIngestor(state)
    .catch((error: unknown) => {
      console.error('Event ingestor startup failed', error)
    })
    .finally(() => {
      state.starting = null
    })
}
