import { createClient } from 'redis'

import { getRedisUrl } from '@/lib/server/env'

const SESSION_LIFECYCLE_CHANNEL = 'session:lifecycle'

export type SessionLifecycleEvent = {
  type: 'session.created' | 'session.completed'
  sessionId: string
  roomName: string
  timestamp: string
}

export async function publishSessionLifecycleEvent(event: SessionLifecycleEvent): Promise<void> {
  const redisUrl = getRedisUrl()
  if (!redisUrl) {
    return
  }

  try {
    const client = createClient({ url: redisUrl })
    await client.connect()
    await client.publish(SESSION_LIFECYCLE_CHANNEL, JSON.stringify(event))
    await client.quit()
  } catch {
    // Fail-safe by design: do not fail request path.
  }
}
