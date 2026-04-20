'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConnectionState,
  type LocalTrackPublication,
  type Participant,
  Room,
  RoomEvent,
  Track,
  type TrackPublication,
} from 'livekit-client'

import { ApiError, createToken } from '@/lib/client/api'

type JoinPageProps = {
  params: Promise<{ sessionId: string }>
}

type VideoTile = {
  id: string
  participantIdentity: string
  participantName: string
  kind: 'local' | 'remote'
  track: Track
}

function VideoTrackView({ tile }: { tile: VideoTile }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current || tile.track.kind !== Track.Kind.Video) {
      return
    }

    const element = tile.track.attach()
    element.className = 'h-full w-full object-cover'
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(element)

    return () => {
      tile.track.detach(element)
      element.remove()
    }
  }, [tile.track])

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-900 shadow-sm">
      <div ref={containerRef} className="aspect-video w-full bg-zinc-950" />
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-200">
        <p className="truncate font-medium">{tile.participantName}</p>
        <span
          className={`rounded px-2 py-0.5 uppercase tracking-wide ${
            tile.kind === 'local' ? 'bg-emerald-500/30 text-emerald-200' : 'bg-sky-500/30 text-sky-200'
          }`}
        >
          {tile.kind}
        </span>
      </div>
    </article>
  )
}

export default function JoinSessionPage({ params }: JoinPageProps) {
  const resolvedParams = use(params)
  const sessionId = resolvedParams.sessionId

  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'teacher' | 'student'>('student')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([])

  const roomRef = useRef<Room | null>(null)

  const resetRoom = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      return
    }

    room.removeAllListeners()

    setVideoTiles((current) => {
      current.forEach((tile) => {
        tile.track.detach().forEach((el) => el.remove())
      })
      return []
    })

    void room.disconnect()
    roomRef.current = null
  }, [])

  const upsertTile = useCallback(
    (participant: Participant, publication: TrackPublication, source: 'local' | 'remote') => {
      const track = publication.track
      if (!track || track.kind !== Track.Kind.Video) {
        return
      }

      const tileId = `${participant.identity}:${publication.trackSid}`
      setVideoTiles((current) => {
        const next: VideoTile = {
          id: tileId,
          participantIdentity: participant.identity,
          participantName: participant.name || participant.identity,
          kind: source,
          track,
        }

        const existingIndex = current.findIndex((item) => item.id === tileId)
        if (existingIndex === -1) {
          return [...current, next]
        }

        const updated = [...current]
        updated[existingIndex] = next
        return updated
      })
    },
    [],
  )

  const removeTile = useCallback((participant: Participant, publication: TrackPublication) => {
    const tileId = `${participant.identity}:${publication.trackSid}`
    setVideoTiles((current) => {
      const target = current.find((item) => item.id === tileId)
      if (target) {
        target.track.detach().forEach((el) => el.remove())
      }
      return current.filter((item) => item.id !== tileId)
    })
  }, [])

  const connect = useCallback(async () => {
    if (!displayName.trim()) {
      setError('Display name is required.')
      return
    }

    setError(null)
    setConnecting(true)

    try {
      resetRoom()

      const tokenData = await createToken(sessionId, {
        displayName: displayName.trim(),
        role,
      })

      if (!tokenData.livekitUrl) {
        throw new Error('LiveKit URL is missing from token response.')
      }

      const room = new Room()
      roomRef.current = room

      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        setConnectionState(state)
      })

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        upsertTile(participant, publication, 'remote')
        if (track.kind === Track.Kind.Audio) {
          track.attach()
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        track.detach().forEach((el) => el.remove())
        removeTile(participant, publication)
      })

      room.on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication, participant: Participant) => {
        upsertTile(participant, publication, 'local')
      })

      room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication, participant: Participant) => {
        removeTile(participant, publication)
      })

      room.on(RoomEvent.Disconnected, () => {
        setConnectionState(ConnectionState.Disconnected)
      })

      await room.connect(tokenData.livekitUrl, tokenData.token)
      await room.localParticipant.enableCameraAndMicrophone()

      room.localParticipant.videoTrackPublications.forEach((publication) => {
        upsertTile(room.localParticipant, publication, 'local')
      })
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.message} (HTTP ${err.status})`
          : err instanceof Error
            ? err.message
            : 'Unable to join room.'
      setError(message)
      resetRoom()
    } finally {
      setConnecting(false)
    }
  }, [displayName, resetRoom, role, sessionId, upsertTile, removeTile])

  useEffect(() => {
    return () => {
      resetRoom()
    }
  }, [resetRoom])

  const joinDisabled = connecting || !displayName.trim()
  const stateLabel = useMemo(() => connectionState.toString(), [connectionState])

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-zinc-900">Join Session</h1>
          <Link href="/" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
            Back to launcher
          </Link>
        </div>

        <p className="mb-4 text-sm text-zinc-600">Session ID: {sessionId}</p>

        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Display Name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="rounded-md border border-zinc-300 px-3 py-2 outline-none ring-zinc-300 transition focus:ring"
              placeholder="Jane Doe"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as 'teacher' | 'student')}
              className="rounded-md border border-zinc-300 px-3 py-2 outline-none ring-zinc-300 transition focus:ring"
            >
              <option value="student">student</option>
              <option value="teacher">teacher</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void connect()}
            disabled={joinDisabled}
            className="h-fit self-end rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? 'Joining…' : 'Join'}
          </button>
        </div>

        <div className="mt-4 text-sm">
          <span className="font-medium text-zinc-700">Connection:</span>{' '}
          <span className="text-zinc-900">{stateLabel}</span>
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-zinc-900">Video Grid</h2>
        {videoTiles.length === 0 ? (
          <p className="text-sm text-zinc-500">No video tracks yet. Join the room and publish camera.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videoTiles.map((tile) => (
              <VideoTrackView key={tile.id} tile={tile} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
