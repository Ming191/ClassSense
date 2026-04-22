import Link from 'next/link'

import { createSession, listSessions, type Session } from '@/lib/server/session-store'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type HomePageProps = {
  searchParams: SearchParams
}

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return value ?? ''
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

async function createSessionAction(formData: FormData) {
  'use server'

  const rawName = formData.get('sessionName')
  const name = typeof rawName === 'string' ? rawName.trim() : ''

  const id = generateSessionId()
  const roomName = `classsense-${id}`
  const session = await createSession({
    id,
    name,
    roomName,
  })

  const { redirect } = await import('next/navigation')
  redirect(`/?created=${encodeURIComponent(session.id)}`)
}

function SessionActions({ sessionId }: { sessionId: string }) {
  return (
    <div className="flex gap-2">
      <Link
        href={`/join/${sessionId}`}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
      >
        Join
      </Link>
      <Link
        href={`/dashboard/${sessionId}`}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
      >
        Dashboard
      </Link>
    </div>
  )
}

function CreatedSessionCard({ session }: { session: Session }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold text-emerald-800">Created Session</h2>
      <p className="mb-3 text-sm text-emerald-900">
        <span className="font-medium">ID:</span> <span className="font-mono">{session.id}</span>
      </p>
      <SessionActions sessionId={session.id} />
    </section>
  )
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams
  const createdId = asText(params.created)

  const sessions = await listSessions()
  const createdSession = sessions.find((session) => session.id === createdId)

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900">ClassSense Demo Launcher</h1>
        <p className="mb-4 text-sm text-zinc-600">Create a session and quickly open join/dashboard views.</p>

        <form action={createSessionAction} className="flex flex-col gap-3 sm:flex-row">
          <input
            name="sessionName"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-300 transition focus:ring"
            placeholder="Session name (optional)"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            Create Session
          </button>
        </form>
      </section>

      {createdSession ? <CreatedSessionCard session={createdSession} /> : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Latest Sessions</h2>
          <Link href="/" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
            Refresh
          </Link>
        </div>

        {sessions.length === 0 ? (
          <p className="text-sm text-zinc-500">No sessions created yet.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900">{session.name}</p>
                  <p className="text-xs text-zinc-600">
                    <span className="font-mono">{session.id}</span> · {session.status}
                  </p>
                </div>
                <SessionActions sessionId={session.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
