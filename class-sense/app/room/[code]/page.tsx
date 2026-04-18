"use client";

import {
  ControlBar,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackLoop,
  TrackRefContext,
  VideoTrack,
  useCreateLayoutContext,
  useTracks,
} from "@livekit/components-react";
import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import "@livekit/components-styles";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Track } from "livekit-client";

type RoomTokenPayload = {
  token: string;
  serverUrl: string;
  room: {
    code: string;
    title: string;
    livekitRoomName: string;
  };
  participant: {
    id: string;
    displayName: string | null;
    role: string;
  };
};

function FilmstripCameraTile({
  trackRef,
}: {
  trackRef: TrackReferenceOrPlaceholder;
}): ReactElement {
  const displayName =
    trackRef.participant.name?.trim() || trackRef.participant.identity || "Guest";
  const avatarLetter = displayName.charAt(0).toUpperCase() || "G";
  const cameraTrackRef = isTrackReference(trackRef) ? trackRef : null;
  const isCameraOn = cameraTrackRef?.publication
    ? !cameraTrackRef.publication.isMuted
    : false;

  return (
    <div className="classsense-filmstrip-tile relative aspect-video overflow-hidden rounded-xl border border-slate-700/70 bg-black/70">
      {cameraTrackRef && isCameraOn ? (
        <VideoTrack
          trackRef={cameraTrackRef}
          className="classsense-filmstrip-video h-full w-full bg-black"
        />
      ) : (
        <div className="classsense-filmstrip-placeholder">
          <div className="classsense-filmstrip-avatar">{avatarLetter}</div>
        </div>
      )}

      <p className="classsense-filmstrip-name">{displayName}</p>
    </div>
  );
}

function RoomStage(): ReactElement {
  const cameraTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ]);
  const screenShareCandidate = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ])[0];
  const primaryTrack =
    screenShareCandidate && isTrackReference(screenShareCandidate)
      ? screenShareCandidate
      : null;

  const stageRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function toggleShareFullscreen(): Promise<void> {
    const stageElement = stageRef.current;

    if (!stageElement) {
      return;
    }

    try {
      if (document.fullscreenElement === stageElement) {
        await document.exitFullscreen();
      } else {
        await stageElement.requestFullscreen();
      }
    } catch (error) {
      console.error("Failed to toggle fullscreen for share stage", error);
    }
  }

  if (primaryTrack) {
    return (
      <div className="flex h-full min-h-0 gap-3">
        <section
          ref={stageRef}
          className="classsense-share-stage relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-700 bg-black"
        >
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <VideoTrack
              trackRef={primaryTrack}
              className="classsense-share-video h-full w-full bg-black"
            />
          </div>

          <button
            type="button"
            onClick={toggleShareFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen share"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen share"}
            className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-500/80 bg-black/55 text-white transition hover:bg-black/80"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              {isFullscreen ? (
                <>
                  <path d="M9 15H5v4" />
                  <path d="M15 9h4V5" />
                  <path d="M5 19l5-5" />
                  <path d="M19 5l-5 5" />
                </>
              ) : (
                <>
                  <path d="M15 3h6v6" />
                  <path d="M9 21H3v-6" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 21l7-7" />
                </>
              )}
            </svg>
          </button>
        </section>

        <aside className="hidden w-72 shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-slate-700/70 bg-slate-900/50 p-2 lg:flex">
          <TrackLoop tracks={cameraTracks}>
            <TrackRefContext.Consumer>
              {(trackRef) => trackRef && <FilmstripCameraTile trackRef={trackRef} />}
            </TrackRefContext.Consumer>
          </TrackLoop>
        </aside>
      </div>
    );
  }

  return (
    <section className="h-full overflow-hidden rounded-2xl border border-slate-800 bg-black/30">
      <GridLayout tracks={cameraTracks} className="h-full p-2">
        <TrackRefContext.Consumer>
          {(trackRef) => <ParticipantTile trackRef={trackRef} />}
        </TrackRefContext.Consumer>
      </GridLayout>
    </section>
  );
}

export default function RoomPage(): ReactElement {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const roomCode = useMemo(() => params.code.toUpperCase(), [params.code]);
  const participantName = searchParams.get("name")?.trim() || "Guest";
  const participantEmail = searchParams.get("email")?.trim() || "";

  const [session, setSession] = useState<RoomTokenPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const layoutContext = useCreateLayoutContext();

  useEffect(() => {
    let isCancelled = false;
    const abortController = new AbortController();

    async function fetchToken() {
      setError(null);

      try {
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roomCode,
            participantName,
            participantEmail,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Unable to join room.");
        }

        const payload = (await response.json()) as RoomTokenPayload;

        if (!isCancelled) {
          setSession(payload);
        }
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        const message =
          requestError instanceof Error
            ? requestError.message
            : "Unable to join this room.";

        if (!isCancelled) {
          setError(message);
        }
      }
    }

    fetchToken();

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [participantEmail, participantName, roomCode]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-rose-400/40 bg-slate-900/80 p-6">
          <p className="text-sm uppercase tracking-[0.18em] text-rose-300">Join failed</p>
          <h1 className="mt-3 text-2xl font-semibold">Unable to enter room {roomCode}</h1>
          <p className="mt-3 text-sm text-slate-300">{error}</p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900"
          >
            Back to lobby
          </Link>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-4 text-slate-100">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
        <p className="text-sm text-slate-300">Joining room {roomCode}...</p>
      </div>
    );
  }

  return (
    <div className="classsense-room flex h-dvh flex-col overflow-hidden bg-slate-950 text-white">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-sky-300">Live room</p>
          <h1 className="text-sm font-semibold sm:text-base">{session.room.title}</h1>
        </div>
        <p className="rounded-full border border-slate-700 px-3 py-1 text-xs tracking-[0.16em] text-slate-200">
          {session.room.code}
        </p>
      </div>

      <LiveKitRoom
        serverUrl={session.serverUrl}
        token={session.token}
        connect
        audio
        video
        className="min-h-0 flex-1 overflow-hidden"
      >
        <LayoutContextProvider value={layoutContext}>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              <RoomStage />
            </div>
            <ControlBar
              variation="verbose"
              controls={{
                microphone: true,
                camera: true,
                screenShare: true,
                chat: false,
                settings: true,
                leave: true,
              }}
            />
          </div>
        </LayoutContextProvider>
        <RoomAudioRenderer />
      </LiveKitRoom>

      <style jsx global>{`
        .classsense-room [data-lk-source="camera"] .lk-focus-toggle-button,
        .classsense-room [data-lk-source="screen_share"] .lk-focus-toggle-button {
          display: none !important;
        }

        .classsense-room .classsense-share-stage .lk-participant-media-video[data-lk-source="screen_share"] {
          object-fit: contain !important;
          background-color: #000 !important;
        }

        .classsense-room .classsense-share-stage .classsense-share-video {
          width: auto !important;
          height: auto !important;
          max-width: 100% !important;
          max-height: 100% !important;
          display: block !important;
          object-fit: contain !important;
          object-position: center center !important;
          background-color: #000 !important;
        }

        .classsense-room .classsense-share-stage .lk-participant-placeholder {
          display: none;
        }

        .classsense-room .classsense-filmstrip-tile .lk-participant-media-video[data-lk-source="camera"] {
          object-fit: cover;
        }

        .classsense-room .classsense-filmstrip-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          display: block;
        }

        .classsense-room .classsense-filmstrip-placeholder {
          display: flex;
          height: 100%;
          width: 100%;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 30% 25%, #0f1e49 0%, #020617 70%);
        }

        .classsense-room .classsense-filmstrip-avatar {
          display: grid;
          height: clamp(56px, 32%, 96px);
          width: clamp(56px, 32%, 96px);
          place-items: center;
          border-radius: 9999px;
          background: #475569;
          color: #e2e8f0;
          font-size: clamp(1rem, 1.5vw, 1.6rem);
          font-weight: 700;
          line-height: 1;
          text-transform: uppercase;
        }

        .classsense-room .classsense-filmstrip-name {
          pointer-events: none;
          position: absolute;
          left: 0.5rem;
          bottom: 0.5rem;
          max-width: calc(100% - 1rem);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border-radius: 9999px;
          background: rgba(2, 6, 23, 0.66);
          padding: 0.22rem 0.5rem;
          font-size: 0.72rem;
          font-weight: 500;
          color: #e2e8f0;
        }
      `}</style>
    </div>
  );
}
