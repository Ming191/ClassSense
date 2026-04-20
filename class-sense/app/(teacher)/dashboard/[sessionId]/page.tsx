"use client";

import { RoomStatus } from "@/app/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFirebaseClientFirestore } from "@/lib/firebase/client";
import {
  SESSION_HCI_EVENTS_SUBCOLLECTION,
  normalizeSessionDashboardDocId,
  SESSION_DASHBOARDS_COLLECTION,
} from "@/lib/firebase/realtime";
import { DashboardPayload } from "@/lib/types/dashboard";
import { SessionHciEvent } from "@/lib/types/hci";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function formatScore(score: number | null): string {
  if (typeof score !== "number") {
    return "—";
  }

  return `${Math.round(score * 100)}%`;
}

function statusColor(score: number | null, status: RoomStatus): string {
  if (status === RoomStatus.ENDED) {
    return "bg-slate-500";
  }

  if (typeof score !== "number") {
    return "bg-gray-400";
  }

  if (score >= 0.75) {
    return "bg-emerald-500";
  }

  if (score >= 0.45) {
    return "bg-amber-500";
  }

  return "bg-rose-500";
}

function flagStyle(flag: string): string {
  if (flag === "NORMAL") {
    return "border-emerald-600/40 bg-emerald-500/15 text-emerald-200";
  }

  if (flag === "LOW_ENGAGEMENT" || flag === "STALE_SIGNAL" || flag.includes("OUTLIER")) {
    return "border-amber-600/40 bg-amber-500/15 text-amber-200";
  }

  if (flag === "SESSION_ENDED") {
    return "border-slate-600/40 bg-slate-500/15 text-slate-200";
  }

  if (flag === "NO_SIGNAL" || flag === "EMOTION_ALERT") {
    return "border-rose-600/40 bg-rose-500/15 text-rose-200";
  }

  return "border-indigo-600/40 bg-indigo-500/15 text-indigo-200";
}

function formatMetric(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number") {
    return "—";
  }

  return value.toFixed(digits);
}

function trendStyle(trend: "up" | "down" | "flat" | "unknown"): string {
  if (trend === "up") {
    return "text-emerald-300";
  }

  if (trend === "down") {
    return "text-rose-300";
  }

  if (trend === "flat") {
    return "text-amber-300";
  }

  return "text-slate-300";
}

function trendLabel(trend: "up" | "down" | "flat" | "unknown"): string {
  if (trend === "up") {
    return "↑ up";
  }

  if (trend === "down") {
    return "↓ down";
  }

  if (trend === "flat") {
    return "→ flat";
  }

  return "?";
}

export default function TeacherDashboardSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [isSuggestingBreak, setIsSuggestingBreak] = useState(false);
  const [hciEvents, setHciEvents] = useState<SessionHciEvent[]>([]);

  useEffect(() => {
    let didCancel = false;

    async function bootstrapAndSubscribe() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/signals`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          const fallback =
            response.status === 401
              ? "Unauthorized. Please sign in."
              : response.status === 403
                ? "You do not have access to this dashboard."
                : response.status === 404
                  ? "Session not found."
                  : "Unable to load dashboard data.";
          throw new Error(payload?.error ?? fallback);
        }

        if (didCancel) {
          return;
        }

        const initialPayload = (await response.json()) as DashboardPayload;
        setData(initialPayload);
        setError(null);
        setIsLoading(false);

        const firestore = getFirebaseClientFirestore();
        const docRef = doc(
          firestore,
          SESSION_DASHBOARDS_COLLECTION,
          normalizeSessionDashboardDocId(initialPayload.session.code || sessionId)
        );

        const unsubscribeDashboard = onSnapshot(
          docRef,
          (snapshot) => {
            if (didCancel || !snapshot.exists()) {
              return;
            }

            const { updatedAt, ...rawPayload } = snapshot.data() as DashboardPayload & {
              updatedAt?: string;
            };
            void updatedAt;
            const payload = rawPayload as DashboardPayload;
            if (!payload?.session) {
              return;
            }

            setData(payload);
            setError(null);
          },
          (snapshotError) => {
            if (didCancel) {
              return;
            }

            setError(
              snapshotError instanceof Error
                ? snapshotError.message
                : "Realtime listener failed."
            );
          }
        );

        const eventsQuery = query(
          collection(docRef, SESSION_HCI_EVENTS_SUBCOLLECTION),
          orderBy("createdAt", "desc"),
          limit(30)
        );

        const unsubscribeEvents = onSnapshot(
          eventsQuery,
          (snapshot) => {
            if (didCancel) {
              return;
            }

            const nextEvents = snapshot.docs
              .map((docSnapshot) => docSnapshot.data() as SessionHciEvent)
              .filter((event) => Boolean(event?.id && event?.type && event?.createdAt));

            setHciEvents(nextEvents);
          },
          (snapshotError) => {
            if (didCancel) {
              return;
            }

            setError(
              snapshotError instanceof Error
                ? snapshotError.message
                : "Realtime event listener failed."
            );
          }
        );

        if (!didCancel) {
          cleanup = () => {
            unsubscribeDashboard();
            unsubscribeEvents();
          };
        } else {
          unsubscribeDashboard();
          unsubscribeEvents();
        }
      } catch (pollError) {
        if (didCancel) {
          return;
        }

        setError(pollError instanceof Error ? pollError.message : "Failed to load dashboard.");
        setIsLoading(false);
      }
    }

    let cleanup: (() => void) | null = null;
    void bootstrapAndSubscribe();

    return () => {
      didCancel = true;

      if (cleanup) {
        cleanup();
      }
    };
  }, [sessionId]);

  async function handleSuggestBreak(): Promise<void> {
    if (isSuggestingBreak) {
      return;
    }

    setIsSuggestingBreak(true);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/hci-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "BREAK_SUGGESTION",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to send break suggestion.");
      }

      setError(null);
    } catch (breakError) {
      setError(breakError instanceof Error ? breakError.message : "Failed to send break suggestion.");
    } finally {
      setIsSuggestingBreak(false);
    }
  }

  const sessionEnded = data?.session.status === RoomStatus.ENDED;

  const sortedParticipants = useMemo(() => {
    if (!data) {
      return [];
    }

    return [...data.participants].sort((a, b) => {
      const scoreA = a.latestSignal?.engagementScore ?? -1;
      const scoreB = b.latestSignal?.engagementScore ?? -1;
      return scoreB - scoreA;
    });
  }, [data]);

  async function handleEndSession(): Promise<void> {
    if (sessionEnded || isEnding) {
      return;
    }

    setIsEnding(true);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to end session.");
      }

      setData((current) =>
        current
          ? {
              ...current,
              session: {
                ...current.session,
                status: RoomStatus.ENDED,
              },
            }
          : current
      );
      setError(null);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Failed to end session.");
    } finally {
      setIsEnding(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <Card className="max-w-2xl border-border">
          <CardHeader>
            <CardTitle>Dashboard unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>{data?.session.title ?? "Session dashboard"}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Session code: {data?.session.code}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Class average: <span className="font-medium text-foreground">{formatScore(data?.classAverage ?? null)}</span>
              </p>
            </div>
            <Button
              type="button"
              variant={sessionEnded ? "outline" : "destructive"}
              disabled={sessionEnded || isEnding}
              onClick={() => {
                void handleEndSession();
              }}
            >
              {sessionEnded ? "Session ended" : isEnding ? "Ending…" : "End session"}
            </Button>
          </CardHeader>
          {error ? (
            <CardContent>
              <p className="text-sm text-rose-600">{error}</p>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">HCI event feed</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSuggestingBreak || sessionEnded}
              onClick={() => {
                void handleSuggestBreak();
              }}
            >
              {isSuggestingBreak ? "Sending…" : "Suggest break"}
            </Button>
          </CardHeader>
          <CardContent>
            {hciEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No HCI events yet.</p>
            ) : (
              <div className="space-y-2">
                {hciEvents.map((event) => (
                  <div key={event.id} className="rounded-md border border-border/70 p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{event.type}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                    {event.studentName ? (
                      <p className="mt-1 text-xs text-muted-foreground">Student: {event.studentName}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Debug metrics (class)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">Participants</p>
                <p className="font-medium">{data?.classMetrics.participantCount ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">With signal</p>
                <p className="font-medium">{data?.classMetrics.withSignalCount ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">No signal</p>
                <p className="font-medium">{data?.classMetrics.noSignalCount ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">Stale</p>
                <p className="font-medium">{data?.classMetrics.staleCount ?? 0}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">Low / Med / High</p>
                <p className="font-medium">
                  {data?.classMetrics.lowCount ?? 0} / {data?.classMetrics.mediumCount ?? 0} / {data?.classMetrics.highCount ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">Avg signal age</p>
                <p className="font-medium">{formatMetric(data?.classMetrics.avgSignalAgeSec ?? null, 1)}s</p>
              </div>
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">Avg cadence</p>
                <p className="font-medium">{formatMetric(data?.classMetrics.avgCadenceSec ?? null, 1)}s</p>
              </div>
              <div className="rounded-md border border-border/70 p-2">
                <p className="text-muted-foreground">Trends (↑/↓/→/?)</p>
                <p className="font-medium">
                  {data?.classMetrics.trend.up ?? 0} / {data?.classMetrics.trend.down ?? 0} / {data?.classMetrics.trend.flat ?? 0} / {data?.classMetrics.trend.unknown ?? 0}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1 text-muted-foreground">Flag counts</p>
              <div className="flex flex-wrap gap-1.5">
                {data && Object.entries(data.classMetrics.flagCounts).length > 0 ? (
                  Object.entries(data.classMetrics.flagCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([flag, count]) => (
                      <span
                        key={flag}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-medium tracking-[0.08em] ${flagStyle(flag)}`}
                      >
                        {flag} ({count})
                      </span>
                    ))
                ) : (
                  <span className="text-xs text-muted-foreground">No flags yet.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {sortedParticipants.map((participant) => {
            const score = participant.latestSignal?.engagementScore ?? null;
            const capturedAt = participant.latestSignal?.capturedAt
              ? new Date(participant.latestSignal.capturedAt).toLocaleTimeString()
              : "No signal yet";

            return (
              <Card key={participant.userId}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {participant.displayName?.trim() || participant.email}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{participant.role}</p>
                    </div>
                    <span
                      className={`mt-1 inline-block h-3 w-3 rounded-full ${statusColor(score, data?.session.status ?? RoomStatus.LIVE)}`}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>
                    Score: <span className="font-medium">{formatScore(score)}</span>
                  </p>
                  <p className="text-muted-foreground">Updated: {capturedAt}</p>
                  <p className="text-muted-foreground">
                    Age: {participant.debugMetrics.signalAgeSec ?? "—"}s · Bucket: {participant.debugMetrics.scoreBucket}
                  </p>
                  <p className="text-muted-foreground">
                    Samples: {participant.debugMetrics.sampleCount} · Cadence: {formatMetric(participant.debugMetrics.cadenceSec, 1)}s
                  </p>
                  <p className="text-muted-foreground">
                    Rolling avg: {formatMetric(participant.debugMetrics.rollingAverage, 3)} · Δ: {formatMetric(participant.debugMetrics.scoreDelta, 3)} · Trend:{" "}
                    <span className={trendStyle(participant.debugMetrics.trend)}>
                      {trendLabel(participant.debugMetrics.trend)}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Emotion: {participant.latestSignal?.emotion ?? "—"} · Yaw/Pitch/Roll: {formatMetric(participant.latestSignal?.yaw)} / {formatMetric(participant.latestSignal?.pitch)} / {formatMetric(participant.latestSignal?.roll)}
                  </p>
                  <p className="text-muted-foreground">
                    |Yaw|/|Pitch|/|Roll|: {formatMetric(participant.debugMetrics.absYaw, 1)} / {formatMetric(participant.debugMetrics.absPitch, 1)} / {formatMetric(participant.debugMetrics.absRoll, 1)} · Pose mag: {formatMetric(participant.debugMetrics.poseMagnitude, 1)}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {participant.flags.map((flag) => (
                      <span
                        key={`${participant.userId}-${flag}`}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-medium tracking-[0.08em] ${flagStyle(flag)}`}
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
