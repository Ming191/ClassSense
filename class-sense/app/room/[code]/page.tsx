"use client";

import {
  ControlBar,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  PreJoin,
  RoomAudioRenderer,
  TrackLoop,
  TrackRefContext,
  VideoTrack,
  useCreateLayoutContext,
  useTracks,
} from "@livekit/components-react";
import {
  isTrackReference,
  type LocalUserChoices,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import "@livekit/components-styles";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getFirebaseClientFirestore } from "@/lib/firebase/client";
import {
  normalizeSessionDashboardDocId,
  SESSION_DASHBOARDS_COLLECTION,
  SESSION_HCI_EVENTS_SUBCOLLECTION,
} from "@/lib/firebase/realtime";
import { SessionHciEvent } from "@/lib/types/hci";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { RoomEvent, Track } from "livekit-client";

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

type JoinStage = "prejoin" | "joining" | "connected";

function getJoinErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera or microphone access was denied. You can still join with both media options turned off.";
    }

    if (error.name === "NotFoundError") {
      return "The selected camera or microphone could not be found. Pick a different device or join with media off.";
    }

    if (error.name === "NotReadableError") {
      return "A camera or microphone is already in use by another app. Close the other app or join with media off.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to complete room setup.";
}

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
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    {
      updateOnlyOn: [RoomEvent.ActiveSpeakersChanged],
      onlySubscribed: false,
    }
  );

  const cameraTracks = useMemo(
    () => tracks.filter((trackRef) => trackRef.source === Track.Source.Camera),
    [tracks]
  );

  const primaryTrack = useMemo(() => {
    const screenShareCandidate = tracks.find(
      (trackRef) => trackRef.source === Track.Source.ScreenShare
    );
    return screenShareCandidate && isTrackReference(screenShareCandidate)
      ? screenShareCandidate
      : null;
  }, [tracks]);

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
          className="classsense-share-stage relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-black/95 shadow-xl shadow-black/20"
        >
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <VideoTrack
              trackRef={primaryTrack}
              className="classsense-share-video h-full w-full bg-black"
            />
          </div>

          <Button
            type="button"
            onClick={toggleShareFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen share"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen share"}
            variant="outline"
            size="icon"
            className="absolute right-3 top-3 z-20 h-10 w-10 rounded-full border-white/30 bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:border-white/60 focus-visible:ring-white/40"
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
          </Button>
        </section>

        <aside className="hidden w-72 shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-border/70 bg-card/40 p-2 shadow-xl shadow-black/15 lg:flex">
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
    <section className="h-full overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-xl shadow-black/15">
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomCode = useMemo(() => params.code.toUpperCase(), [params.code]);
  const participantName = searchParams.get("name")?.trim() || "Guest";
  const participantEmail = searchParams.get("email")?.trim() || "";

  const [session, setSession] = useState<RoomTokenPayload | null>(null);
  const [joinStage, setJoinStage] = useState<JoinStage>("prejoin");
  const [joinChoices, setJoinChoices] = useState<LocalUserChoices | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [studentPrompt, setStudentPrompt] = useState<SessionHciEvent | null>(null);
  const [breakSuggestion, setBreakSuggestion] = useState<SessionHciEvent | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const layoutContext = useCreateLayoutContext();

  const isHost = session?.participant.role === "HOST";

  const preJoinDefaults = useMemo<Partial<LocalUserChoices>>(
    () => ({
      username: participantName,
      audioEnabled: true,
      videoEnabled: true,
      audioDeviceId: "",
      videoDeviceId: "",
      ...joinChoices,
    }),
    [joinChoices, participantName]
  );

  const audioCapture = useMemo(() => {
    if (!joinChoices?.audioEnabled) {
      return false;
    }

    return joinChoices.audioDeviceId
      ? { deviceId: joinChoices.audioDeviceId }
      : true;
  }, [joinChoices]);

  const videoCapture = useMemo(() => {
    if (!joinChoices?.videoEnabled) {
      return false;
    }

    return joinChoices.videoDeviceId
      ? { deviceId: joinChoices.videoDeviceId }
      : true;
  }, [joinChoices]);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!session?.room.code || !session?.participant.id) {
      return;
    }

    const firestore = getFirebaseClientFirestore();
    const dashboardDocRef = doc(
      firestore,
      SESSION_DASHBOARDS_COLLECTION,
      normalizeSessionDashboardDocId(session.room.code)
    );
    const hciQuery = query(
      collection(dashboardDocRef, SESSION_HCI_EVENTS_SUBCOLLECTION),
      orderBy("createdAt", "desc"),
      limit(25)
    );

    const unsubscribe = onSnapshot(
      hciQuery,
      (snapshot) => {
        const events = snapshot.docs
          .map((docSnapshot) => docSnapshot.data() as SessionHciEvent)
          .filter((event) => Boolean(event?.id && event?.type && event?.createdAt));

        const latestPrompt = events.find(
          (event) =>
            event.type === "CONFUSION_PROMPT" &&
            event.targetStudentId === session.participant.id
        );
        const latestBreak = events.find((event) => event.type === "BREAK_SUGGESTION");

        setStudentPrompt(latestPrompt ?? null);
        setBreakSuggestion(latestBreak ?? null);
      },
      () => {
        // Ignore listener errors to keep room media resilient.
      }
    );

    return () => {
      unsubscribe();
    };
  }, [session?.participant.id, session?.room.code]);

  async function handleRaiseHandFromPrompt(): Promise<void> {
    setStudentPrompt(null);
    // TODO: Wire real raise-hand action.
  }

  async function handlePreJoinSubmit(values: LocalUserChoices): Promise<void> {
    requestControllerRef.current?.abort();

    const abortController = new AbortController();
    requestControllerRef.current = abortController;

    setJoinChoices(values);
    setSession(null);
    setJoinError(null);
    setJoinStage("joining");

    const resolvedParticipantName = values.username.trim() || participantName || "Guest";

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(roomCode)}/token`, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          participantName: resolvedParticipantName,
          participantEmail,
        }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        throw new Error(errorPayload.error ?? "Unable to join room.");
      }

      const payload = (await response.json()) as RoomTokenPayload;

      if (abortController.signal.aborted) {
        return;
      }

      setSession(payload);
      setJoinStage("connected");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        return;
      }

      setJoinError(getJoinErrorMessage(requestError));
      setJoinStage("prejoin");
    } finally {
      if (requestControllerRef.current === abortController) {
        requestControllerRef.current = null;
      }
    }
  }

  if (joinStage === "prejoin") {
    return (
      <div className="dark classsense-prejoin-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 text-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.18),transparent_40%),radial-gradient(ellipse_at_bottom,rgba(99,102,241,0.14),transparent_45%)]"
        />

        <Card className="relative w-full max-w-5xl border-border/70 bg-card/85 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <CardHeader className="gap-3 border-b border-border/70 pb-5">
            <div className="space-y-2">
              <Badge variant="secondary" className="h-6 px-3 text-[0.68rem] tracking-[0.16em]">
                Pre-join setup
              </Badge>
              <CardTitle className="text-2xl text-foreground sm:text-3xl">Ready to join room</CardTitle>
              <CardDescription className="max-w-2xl text-sm text-muted-foreground">
                Review your camera and microphone setup before joining. You can still continue
                with both media options turned off.
              </CardDescription>
            </div>
            <CardAction className="mt-1">
              <Badge
                variant="outline"
                className="h-7 border-border bg-background/70 px-3 text-[0.7rem] tracking-[0.2em] text-foreground"
              >
                {roomCode}
              </Badge>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-6 pb-6">
            <div className="mx-auto w-full max-w-3xl">
              <div className="rounded-2xl border border-border/70 bg-background/40 p-4 shadow-xl shadow-black/10 sm:p-5">
                {joinError ? (
                  <Alert
                    variant="destructive"
                    className="mb-4 border-destructive/35 bg-destructive/10 text-destructive"
                  >
                    <AlertTitle>Unable to join room</AlertTitle>
                    <AlertDescription className="text-destructive/90">{joinError}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="classsense-prejoin-panel rounded-xl border border-border/70 bg-card/50 p-3 sm:p-4">
                  <PreJoin
                    defaults={preJoinDefaults}
                    onSubmit={handlePreJoinSubmit}
                    onError={(error) => {
                      setJoinError(getJoinErrorMessage(error));
                    }}
                    joinLabel="Join room"
                  />
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                router.push("/");
              }}
              className="h-10 min-w-32 border-border bg-background/80"
            >
              Back to lobby
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinStage === "joining" || !session) {
    return (
      <div className="dark classsense-prejoin-shell flex min-h-screen items-center justify-center px-4 text-foreground">
        <Card className="w-full max-w-md border-border/70 bg-card/85 shadow-2xl shadow-black/20 backdrop-blur-lg">
          <CardHeader className="gap-2 pb-2">
            <Badge variant="secondary" className="h-6 w-fit px-3 text-[0.68rem] tracking-[0.14em]">
              Connecting
            </Badge>
            <CardTitle className="text-xl text-foreground">Joining room {roomCode}</CardTitle>
            <CardDescription>Confirming your setup and securing your seat.</CardDescription>
          </CardHeader>
          <CardContent className="pb-5 pt-1">
            <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/80 border-t-transparent" />
              <p className="text-sm text-muted-foreground">Establishing encrypted connection…</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="dark classsense-room flex h-dvh flex-col overflow-hidden bg-slate-950 text-foreground">
      <LiveKitRoom
        serverUrl={session.serverUrl}
        token={session.token}
        connect={joinStage === "connected"}
        audio={audioCapture}
        video={videoCapture}
        onError={(error) => {
          setJoinError(getJoinErrorMessage(error));
        }}
        onMediaDeviceFailure={(failure, kind) => {
          const readableFailure = failure ? `${failure}` : "Unknown device error";
          const readableKind = kind === "audioinput" ? "microphone" : "camera";
          setJoinError(
            `LiveKit could not access your ${readableKind} (${readableFailure}). You can continue in-room and adjust devices from settings.`
          );
        }}
        className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4"
      >
        <LayoutContextProvider value={layoutContext}>
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
            <Card
              size="sm"
              className="shrink-0 border-border/70 bg-card/75 shadow-xl shadow-black/15 backdrop-blur-md"
            >
              <CardHeader className="gap-2">
                <div>
                  <Badge variant="secondary" className="mb-1.5 h-5 px-2.5 text-[0.64rem] tracking-[0.16em]">
                    Live room
                  </Badge>
                  <CardTitle className="text-base text-foreground sm:text-lg">{session.room.title}</CardTitle>
                </div>
                <CardAction>
                  <div className="flex items-center gap-2">
                    {isHost ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => {
                          window.open(`/dashboard/${encodeURIComponent(session.room.code)}`, "_blank");
                        }}
                      >
                        Open dashboard
                      </Button>
                    ) : null}
                    <Badge
                      variant="outline"
                      className="h-7 border-border bg-background/70 px-3 text-[0.7rem] tracking-[0.2em] text-foreground"
                    >
                      {session.room.code}
                    </Badge>
                  </div>
                </CardAction>
              </CardHeader>
            </Card>

            <div className="shrink-0 min-h-14">
              {joinError ? (
                <Alert
                  variant="destructive"
                  className="border-destructive/35 bg-destructive/10 text-destructive"
                >
                  <AlertTitle>Device access issue</AlertTitle>
                  <AlertDescription className="text-destructive/90">{joinError}</AlertDescription>
                </Alert>
              ) : (
                <div aria-hidden className="h-full rounded-lg border border-transparent" />
              )}
            </div>

            {breakSuggestion ? (
              <Alert className="border-emerald-500/35 bg-emerald-500/10 text-emerald-100">
                <AlertTitle>Break suggestion</AlertTitle>
                <AlertDescription>
                  {breakSuggestion.message || "Teacher suggests a short break."}
                </AlertDescription>
              </Alert>
            ) : null}

            {studentPrompt ? (
              <Alert className="border-amber-500/35 bg-amber-500/10 text-amber-100">
                <AlertTitle>Need help?</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{studentPrompt.message}</p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void handleRaiseHandFromPrompt();
                      }}
                    >
                      Raise hand
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setStudentPrompt(null);
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <Card className="min-h-0 flex-1 border-border/70 bg-card/45 shadow-xl shadow-black/20">
              <CardContent className="min-h-0 flex-1 p-3">
                <RoomStage />
              </CardContent>
            </Card>

            <Card
              size="sm"
              className="shrink-0 overflow-visible border-border/70 bg-card/55 shadow-lg shadow-black/20"
            >
              <CardContent className="px-2 py-2 sm:px-3">
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
              </CardContent>
            </Card>
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
