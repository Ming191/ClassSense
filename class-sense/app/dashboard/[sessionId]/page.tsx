'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, endSession, getSessionEvents } from '@/lib/client/api'

type DashboardPageProps = {
  params: Promise<{ sessionId: string }>
}

type StreamEventType = 'ready' | 'score' | 'hci' | 'heatmap' | 'error'

type StreamLogItem = {
  id: string
  type: StreamEventType
  timestamp: string
  payload: unknown
}

const LOG_LIMIT = 100

function parseEventData(rawData: string): unknown {
  try {
    return JSON.parse(rawData) as unknown
  } catch {
    return rawData
  }
}

function eventBadgeClass(type: StreamEventType): string {
  switch (type) {
    case 'score':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'hci':
      return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'heatmap':
      return 'bg-orange-100 text-orange-700 border-orange-200'
    case 'ready':
      return 'bg-violet-100 text-violet-700 border-violet-200'
    default:
      return 'bg-red-100 text-red-700 border-red-200'
  }
}

function prettyData(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

export default function SessionDashboardPage({ params }: DashboardPageProps) {
  const { sessionId } = use(params)

  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<'active' | 'completed'>('active')
  const [scoreEvents, setScoreEvents] = useState<StreamLogItem[]>([])
  const [hciEvents, setHciEvents] = useState<StreamLogItem[]>([])
  const [heatmapEvents, setHeatmapEvents] = useState<StreamLogItem[]>([])
  const [logs, setLogs] = useState<StreamLogItem[]>([])

  const sourceRef = useRef<EventSource | null>(null)

  const pushLog = useCallback((item: StreamLogItem) => {
    setLogs((current) => [item, ...current].slice(0, LOG_LIMIT))
  }, [])

  const stopListening = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
    setListening(false)
  }, [])

  const handleIncomingEvent = useCallback(
    (type: Exclude<StreamEventType, 'error'>, event: MessageEvent<string>) => {
      const item: StreamLogItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        timestamp: new Date().toISOString(),
        payload: parseEventData(event.data),
      }

      pushLog(item)

      if (type === 'score') {
        setScoreEvents((current) => [item, ...current].slice(0, 30))
      } else if (type === 'hci') {
        setHciEvents((current) => [item, ...current].slice(0, 30))
      } else if (type === 'heatmap') {
        setHeatmapEvents((current) => [item, ...current].slice(0, 30))
      }
    },
    [pushLog],
  )

  const startListening = useCallback(() => {
    if (sourceRef.current) {
      return
    }

    setError(null)
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`)
    sourceRef.current = source

    source.addEventListener('ready', (event) => {
      handleIncomingEvent('ready', event as MessageEvent<string>)
      setListening(true)
    })
    source.addEventListener('score', (event) => {
      handleIncomingEvent('score', event as MessageEvent<string>)
    })
    source.addEventListener('hci', (event) => {
      handleIncomingEvent('hci', event as MessageEvent<string>)
    })
    source.addEventListener('heatmap', (event) => {
      handleIncomingEvent('heatmap', event as MessageEvent<string>)
    })

    source.onerror = () => {
      const item: StreamLogItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'error',
        timestamp: new Date().toISOString(),
        payload: 'SSE connection error. Stream closed.',
      }
      pushLog(item)
      setError('SSE connection failed or closed.')
      stopListening()
    }
  }, [handleIncomingEvent, pushLog, sessionId, stopListening])

  const handleEndSession = useCallback(async () => {
    setEnding(true)
    setError(null)
    try {
      const session = await endSession(sessionId)
      setSessionStatus(session.status)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.message} (HTTP ${err.status})`
          : err instanceof Error
            ? err.message
            : 'Failed to end session.'
      setError(message)
    } finally {
      setEnding(false)
    }
  }, [sessionId])

  useEffect(() => {
    let cancelled = false

    void getSessionEvents(sessionId, { type: 'all', limit: LOG_LIMIT })
      .then((response) => {
        if (cancelled) {
          return
        }

        setError(null)
        setHeatmapEvents([])

        const scoreHistory: StreamLogItem[] = response.scoreEvents.map((event) => ({
          id: event.id,
          type: 'score',
          timestamp: event.createdAt,
          payload: event.payload,
        }))

        const hciHistory: StreamLogItem[] = response.hciEvents.map((event) => ({
          id: event.id,
          type: 'hci',
          timestamp: event.createdAt,
          payload: event.payload,
        }))

        setScoreEvents(scoreHistory.slice(0, 30))
        setHciEvents(hciHistory.slice(0, 30))

        const mergedLogs = [...scoreHistory, ...hciHistory]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, LOG_LIMIT)
        setLogs(mergedLogs)
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return
        }

        const message =
          err instanceof ApiError
            ? `Failed to load event history: ${err.message} (HTTP ${err.status})`
            : err instanceof Error
              ? `Failed to load event history: ${err.message}`
              : 'Failed to load event history.'
        setError(message)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      stopListening()
    }
  }, [stopListening])

  const canStart = !listening
  const canStop = listening
  const statusBadge = useMemo(
    () =>
      sessionStatus === 'completed'
        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
        : 'border-zinc-300 bg-zinc-50 text-zinc-700',
    [sessionStatus],
  )

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-900">Session Dashboard</h1>
          <Link href="/" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
            Back to launcher
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-zinc-700">{sessionId}</span>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium uppercase tracking-wide ${statusBadge}`}>
            {sessionStatus}
          </span>
          <span className="text-zinc-600">SSE: {listening ? 'listening' : 'stopped'}</span>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startListening}
            disabled={!canStart}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start Listening SSE
          </button>
          <button
            type="button"
            onClick={stopListening}
            disabled={!canStop}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop Listening
          </button>
          <button
            type="button"
            onClick={() => void handleEndSession()}
            disabled={ending}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ending ? 'Ending…' : 'End Session'}
          </button>
        </div>

        {error ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <EventPanel title="Score Events" events={scoreEvents} />
        <EventPanel title="HCI Events" events={hciEvents} />
        <EventPanel title="Heatmap Events" events={heatmapEvents} />
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-zinc-900">Raw Event Log</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-zinc-500">No events yet.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((item) => (
              <li key={item.id} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={`rounded border px-2 py-0.5 text-xs font-medium uppercase ${eventBadgeClass(item.type)}`}>
                    {item.type}
                  </span>
                  <span className="text-xs text-zinc-500">{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
                <pre className="overflow-x-auto text-xs text-zinc-700">{prettyData(item.payload)}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function EventPanel({ title, events }: { title: string; events: StreamLogItem[] }) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-zinc-900">{title}</h3>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">No events yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.slice(0, 6).map((item) => (
            <li key={item.id} className="rounded-md border border-zinc-100 bg-zinc-50 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className={`rounded border px-2 py-0.5 text-[10px] font-medium uppercase ${eventBadgeClass(item.type)}`}>
                  {item.type}
                </span>
                <span className="text-[10px] text-zinc-500">{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
              <pre className="line-clamp-4 overflow-x-auto text-[11px] text-zinc-700">{prettyData(item.payload)}</pre>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
