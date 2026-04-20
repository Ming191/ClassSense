function requiredEnv(name: 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name: 'LIVEKIT_URL_PUBLIC' | 'REDIS_URL'): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

export function getLivekitApiKey(): string {
  return requiredEnv('LIVEKIT_API_KEY')
}

export function getLivekitApiSecret(): string {
  return requiredEnv('LIVEKIT_API_SECRET')
}

export function getLivekitUrlPublic(): string | undefined {
  return optionalEnv('LIVEKIT_URL_PUBLIC')
}

export function getRedisUrl(): string | undefined {
  return optionalEnv('REDIS_URL')
}
