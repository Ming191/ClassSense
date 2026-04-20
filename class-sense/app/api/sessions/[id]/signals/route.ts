import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getValidationErrorMessage,
  signalIngestionBodySchema,
} from "@/lib/request-validation";
import { prisma } from "@/lib/prisma";
import {
  listRecentSessionHciEvents,
  publishSessionDashboardSnapshot,
  publishSessionHciEvent,
} from "@/lib/firebase/admin";
import { DashboardPayload } from "@/lib/types/dashboard";
import { SessionHciEvent } from "@/lib/types/hci";
import { resolveSessionByIdentifier } from "@/lib/server/session-service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const LOW_ENGAGEMENT_THRESHOLD = 0.45;
const HIGH_ENGAGEMENT_THRESHOLD = 0.8;
const STALE_SIGNAL_SECONDS = 12;
const YAW_ALERT_DEGREES = 20;
const PITCH_ALERT_DEGREES = 15;
const ROLL_ALERT_DEGREES = 15;
const TREND_DELTA_ALERT = 0.08;
const LOW_SIGNAL_RATE_SECONDS = 6;
const LOW_ENGAGEMENT_ALERT_COOLDOWN_SECONDS = 45;
const CONFUSION_PROMPT_COOLDOWN_SECONDS = 300;
const FATIGUE_ALERT_COOLDOWN_SECONDS = 180;
const CONFUSION_EMOTIONS = ["confused", "fear", "disgust", "sad"];

type LatestSignal = {
  capturedAt: Date;
  engagementScore: number | null;
  cameraEnabled: boolean | null;
  microphoneEnabled: boolean | null;
  faceDetected: boolean | null;
  emotion: string | null;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
};

type ScoreBucket = "high" | "medium" | "low" | "unknown";
type TrendDirection = "up" | "down" | "flat" | "unknown";

type ParticipantDebugMetrics = {
  signalAgeSec: number | null;
  scoreBucket: ScoreBucket;
  isStale: boolean;
  sampleCount: number;
  cadenceSec: number | null;
  rollingAverage: number | null;
  scoreDelta: number | null;
  trend: TrendDirection;
  absYaw: number | null;
  absPitch: number | null;
  absRoll: number | null;
  poseMagnitude: number | null;
  cameraEnabled: boolean | null;
  microphoneEnabled: boolean | null;
  faceDetected: boolean | null;
};

type ParticipantDebugSummary = {
  flags: string[];
  debugMetrics: ParticipantDebugMetrics;
};

type RoomDashboardSnapshot = {
  id: string;
  code: string;
  title: string;
  status: RoomStatus;
  hostId: string;
};

type HciDetectionContext = {
  room: RoomDashboardSnapshot;
  participant: {
    userId: string;
    displayName: string | null;
    email: string;
    role: ParticipantRole;
  };
  latestSignal: LatestSignal;
  debugSummary: ParticipantDebugSummary;
};

function toLatestSignal(
  signal: {
    capturedAt: Date;
    engagementScore: number | null;
    emotion: string | null;
    yaw: number | null;
    pitch: number | null;
    roll: number | null;
  } | null,
  sampleMeta: {
    cameraEnabled?: boolean;
    microphoneEnabled?: boolean;
    faceDetected?: boolean;
  } | null
): LatestSignal | null {
  if (!signal) {
    return null;
  }

  return {
    capturedAt: signal.capturedAt,
    engagementScore: signal.engagementScore,
    cameraEnabled: sampleMeta?.cameraEnabled ?? null,
    microphoneEnabled: sampleMeta?.microphoneEnabled ?? null,
    faceDetected: sampleMeta?.faceDetected ?? null,
    emotion: signal.emotion,
    yaw: signal.yaw,
    pitch: signal.pitch,
    roll: signal.roll,
  };
}

function parseSampleMeta(emotion: string | null): {
  cameraEnabled?: boolean;
  microphoneEnabled?: boolean;
  faceDetected?: boolean;
  baseEmotion: string | null;
} {
  if (!emotion) {
    return {
      baseEmotion: null,
    };
  }

  if (!emotion.startsWith("meta:")) {
    return {
      baseEmotion: emotion,
    };
  }

  const payload = emotion.slice(5).trim();

  if (!payload) {
    return {
      baseEmotion: null,
    };
  }

  const segments = payload.split(";").map((segment) => segment.trim());
  const next: {
    cameraEnabled?: boolean;
    microphoneEnabled?: boolean;
    faceDetected?: boolean;
    baseEmotion: string | null;
  } = {
    baseEmotion: null,
  };

  for (const segment of segments) {
    const [rawKey, rawValue] = segment.split("=");

    if (!rawKey || !rawValue) {
      continue;
    }

    const key = rawKey.trim();
    const value = rawValue.trim().toLowerCase();

    if (key === "cameraEnabled") {
      next.cameraEnabled = value === "true";
    } else if (key === "microphoneEnabled") {
      next.microphoneEnabled = value === "true";
    } else if (key === "faceDetected") {
      next.faceDetected = value === "true";
    } else if (key === "emotion") {
      next.baseEmotion = value || null;
    }
  }

  return next;
}

function encodeSampleMeta(input: {
  cameraEnabled?: boolean;
  microphoneEnabled?: boolean;
  faceDetected?: boolean;
  emotion?: string;
}): string {
  const items = [
    `cameraEnabled=${input.cameraEnabled ?? false}`,
    `microphoneEnabled=${input.microphoneEnabled ?? false}`,
    `faceDetected=${input.faceDetected ?? false}`,
    `emotion=${input.emotion?.trim() || ""}`,
  ];

  return `meta:${items.join(";")}`;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getTrend(scoreDelta: number | null): TrendDirection {
  if (typeof scoreDelta !== "number") {
    return "unknown";
  }

  if (scoreDelta >= 0.03) {
    return "up";
  }

  if (scoreDelta <= -0.03) {
    return "down";
  }

  return "flat";
}

function getScoreBucket(score: number | null): ScoreBucket {
  if (typeof score !== "number") {
    return "unknown";
  }

  if (score >= HIGH_ENGAGEMENT_THRESHOLD) {
    return "high";
  }

  if (score >= LOW_ENGAGEMENT_THRESHOLD) {
    return "medium";
  }

  return "low";
}

function buildDebugSummary(input: {
  latest: LatestSignal | null;
  previous: LatestSignal | null;
  recent: LatestSignal[];
  roomStatus: RoomStatus;
}): ParticipantDebugSummary {
  const flags: string[] = [];

  const engagementValues = input.recent
    .map((sample) => sample.engagementScore)
    .filter((score): score is number => typeof score === "number");

  const scoreDelta =
    typeof input.latest?.engagementScore === "number" &&
    typeof input.previous?.engagementScore === "number"
      ? input.latest.engagementScore - input.previous.engagementScore
      : null;

  const cadenceSec =
    input.latest && input.previous
      ? Math.max(0, (input.latest.capturedAt.getTime() - input.previous.capturedAt.getTime()) / 1000)
      : null;

  const absYaw = typeof input.latest?.yaw === "number" ? Math.abs(input.latest.yaw) : null;
  const absPitch = typeof input.latest?.pitch === "number" ? Math.abs(input.latest.pitch) : null;
  const absRoll = typeof input.latest?.roll === "number" ? Math.abs(input.latest.roll) : null;

  const poseMagnitude =
    typeof input.latest?.yaw === "number" &&
    typeof input.latest?.pitch === "number" &&
    typeof input.latest?.roll === "number"
      ? Math.sqrt(input.latest.yaw ** 2 + input.latest.pitch ** 2 + input.latest.roll ** 2)
      : null;

  const debugMetrics = {
    signalAgeSec: null as number | null,
    scoreBucket: getScoreBucket(input.latest?.engagementScore ?? null),
    isStale: false,
    sampleCount: input.recent.length,
    cadenceSec,
    rollingAverage: average(engagementValues),
    scoreDelta,
    trend: getTrend(scoreDelta),
    absYaw,
    absPitch,
    absRoll,
    poseMagnitude,
    cameraEnabled: input.latest?.cameraEnabled ?? null,
    microphoneEnabled: input.latest?.microphoneEnabled ?? null,
    faceDetected: input.latest?.faceDetected ?? null,
  };

  if (input.roomStatus === RoomStatus.ENDED) {
    flags.push("SESSION_ENDED");
  }

  if (!input.latest) {
    flags.push("NO_SIGNAL");
    return {
      flags,
      debugMetrics,
    };
  }

  const signalAgeSec = Math.max(0, Math.round((Date.now() - input.latest.capturedAt.getTime()) / 1000));
  debugMetrics.signalAgeSec = signalAgeSec;

  if (signalAgeSec > STALE_SIGNAL_SECONDS) {
    flags.push("STALE_SIGNAL");
    debugMetrics.isStale = true;
  }

  if (input.latest.cameraEnabled === false) {
    flags.push("CAMERA_OFF");

    if (typeof input.latest.engagementScore === "number" && input.latest.engagementScore > 0.35) {
      flags.push("SCORE_INCONSISTENT_WITH_CAMERA_OFF");
    }
  }

  if (input.latest.microphoneEnabled === false) {
    flags.push("MICROPHONE_OFF");
  }

  if (input.latest.faceDetected === false) {
    flags.push("FACE_MISSING");
  }

  if (input.latest.cameraEnabled !== false) {
    if (typeof input.latest.engagementScore === "number") {
      if (input.latest.engagementScore < LOW_ENGAGEMENT_THRESHOLD) {
        flags.push("LOW_ENGAGEMENT");
      } else if (input.latest.engagementScore >= HIGH_ENGAGEMENT_THRESHOLD) {
        flags.push("HIGH_ENGAGEMENT");
      }
    }
  }

  if (typeof input.latest.yaw === "number" && Math.abs(input.latest.yaw) > YAW_ALERT_DEGREES) {
    flags.push("YAW_OUTLIER");
  }

  if (typeof input.latest.pitch === "number" && Math.abs(input.latest.pitch) > PITCH_ALERT_DEGREES) {
    flags.push("PITCH_OUTLIER");
  }

  if (typeof input.latest.roll === "number" && Math.abs(input.latest.roll) > ROLL_ALERT_DEGREES) {
    flags.push("ROLL_OUTLIER");
  }

  const emotion = input.latest.emotion?.toLowerCase();

  if (emotion && ["away", "distracted", "confused", "sad", "fear", "disgust"].includes(emotion)) {
    flags.push("EMOTION_ALERT");
  }

  if (typeof scoreDelta === "number") {
    if (scoreDelta <= -TREND_DELTA_ALERT) {
      flags.push("TREND_DROP");
    } else if (scoreDelta >= TREND_DELTA_ALERT) {
      flags.push("TREND_RISE");
    }
  }

  if (typeof cadenceSec === "number" && cadenceSec > LOW_SIGNAL_RATE_SECONDS) {
    flags.push("LOW_SIGNAL_RATE");
  }

  if (
    typeof input.latest.yaw !== "number" &&
    typeof input.latest.pitch !== "number" &&
    typeof input.latest.roll !== "number"
  ) {
    flags.push("NO_POSE_DATA");
  }

  if (flags.length === 0) {
    flags.push("NORMAL");
  }

  return {
    flags,
    debugMetrics,
  };
}

async function buildDashboardPayload(room: RoomDashboardSnapshot): Promise<DashboardPayload> {
  const participants = await prisma.participant.findMany({
    where: {
      roomId: room.id,
      role: {
        in: [ParticipantRole.STUDENT, ParticipantRole.CO_HOST],
      },
    },
    orderBy: {
      joinedAt: "asc",
    },
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });

  const signals = await prisma.cvSignalSample.findMany({
    where: {
      roomId: room.id,
      userId: {
        in: participants.map((participant) => participant.userId),
      },
    },
    orderBy: {
      capturedAt: "desc",
    },
    select: {
      userId: true,
      capturedAt: true,
      engagementScore: true,
      emotion: true,
      yaw: true,
      pitch: true,
      roll: true,
    },
  });

  const signalsByUserId = new Map<string, Array<(typeof signals)[number]>>();

  for (const signal of signals) {
    const current = signalsByUserId.get(signal.userId) ?? [];

    if (current.length < 5) {
      current.push(signal);
    }

    signalsByUserId.set(signal.userId, current);
  }

  const responseParticipants = participants.map((participant) => {
    const userSignals = signalsByUserId.get(participant.userId) ?? [];
    const latestRaw = userSignals[0] ?? null;
    const previousRaw = userSignals[1] ?? null;
    const latestMeta = parseSampleMeta(latestRaw?.emotion ?? null);
    const previousMeta = parseSampleMeta(previousRaw?.emotion ?? null);
    const latestSignal = toLatestSignal(latestRaw, latestMeta);
    const previousSignal = toLatestSignal(previousRaw, previousMeta);
    const recentSignals = userSignals
      .map((signal) => {
        const meta = parseSampleMeta(signal.emotion ?? null);
        return toLatestSignal(signal, meta);
      })
      .filter((signal): signal is LatestSignal => Boolean(signal));
    const debugSummary = buildDebugSummary({
      latest: latestSignal,
      previous: previousSignal,
      recent: recentSignals,
      roomStatus: room.status,
    });

    return {
      userId: participant.userId,
      role: participant.role,
      displayName: participant.user.displayName,
      email: participant.user.email,
      latestSignal: latestSignal
        ? {
            capturedAt: latestSignal.capturedAt.toISOString(),
            engagementScore: latestSignal.engagementScore,
            emotion: latestMeta.baseEmotion,
            yaw: latestSignal.yaw,
            pitch: latestSignal.pitch,
            roll: latestSignal.roll,
          }
        : null,
      flags: debugSummary.flags,
      debugMetrics: debugSummary.debugMetrics,
    };
  });

  const engagementValues = responseParticipants
    .map((participant) => participant.latestSignal?.engagementScore)
    .filter((score): score is number => typeof score === "number");

  const classAverage =
    engagementValues.length > 0
      ? engagementValues.reduce((sum, score) => sum + score, 0) / engagementValues.length
      : null;

  const classSignalAges = responseParticipants
    .map((participant) => participant.debugMetrics.signalAgeSec)
    .filter((value): value is number => typeof value === "number");

  const classCadenceValues = responseParticipants
    .map((participant) => participant.debugMetrics.cadenceSec)
    .filter((value): value is number => typeof value === "number");

  const classMetrics = {
    participantCount: responseParticipants.length,
    withSignalCount: responseParticipants.filter((participant) => participant.latestSignal !== null)
      .length,
    noSignalCount: responseParticipants.filter((participant) => participant.latestSignal === null).length,
    staleCount: responseParticipants.filter((participant) => participant.debugMetrics.isStale).length,
    lowCount: responseParticipants.filter((participant) => participant.debugMetrics.scoreBucket === "low")
      .length,
    mediumCount: responseParticipants.filter(
      (participant) => participant.debugMetrics.scoreBucket === "medium"
    ).length,
    highCount: responseParticipants.filter((participant) => participant.debugMetrics.scoreBucket === "high")
      .length,
    avgSignalAgeSec: average(classSignalAges),
    avgCadenceSec: average(classCadenceValues),
    trend: {
      up: responseParticipants.filter((participant) => participant.debugMetrics.trend === "up").length,
      down: responseParticipants.filter((participant) => participant.debugMetrics.trend === "down").length,
      flat: responseParticipants.filter((participant) => participant.debugMetrics.trend === "flat").length,
      unknown: responseParticipants.filter((participant) => participant.debugMetrics.trend === "unknown")
        .length,
    },
    flagCounts: responseParticipants.reduce<Record<string, number>>((accumulator, participant) => {
      for (const flag of participant.flags) {
        accumulator[flag] = (accumulator[flag] ?? 0) + 1;
      }

      return accumulator;
    }, {}),
  };

  return {
    session: {
      id: room.id,
      code: room.code,
      title: room.title,
      status: room.status,
    },
    classAverage,
    classMetrics,
    participants: responseParticipants,
  };
}

async function syncDashboardRealtimeSnapshot(room: RoomDashboardSnapshot): Promise<DashboardPayload> {
  const payload = await buildDashboardPayload(room);

  try {
    await publishSessionDashboardSnapshot(payload);
  } catch (error) {
    console.error("Failed to publish dashboard snapshot to Firestore", error);
  }

  return payload;
}

function nowIso(): string {
  return new Date().toISOString();
}

function secondsBetween(nowDate: Date, previousIso: string): number {
  const previous = new Date(previousIso).getTime();

  if (Number.isNaN(previous)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (nowDate.getTime() - previous) / 1000);
}

async function shouldEmitEvent(input: {
  roomCode: string;
  type: SessionHciEvent["type"];
  targetStudentId: string | null;
  cooldownSec: number;
}): Promise<boolean> {
  const recent = await listRecentSessionHciEvents({
    sessionCode: input.roomCode,
    limit: 30,
  });

  const nowDate = new Date();
  const duplicate = recent.find((event) => {
    if (event.type !== input.type) {
      return false;
    }

    if (event.targetStudentId !== (input.targetStudentId ?? null)) {
      return false;
    }

    return secondsBetween(nowDate, event.createdAt) < input.cooldownSec;
  });

  return !duplicate;
}

function createHciEvent(input: {
  room: RoomDashboardSnapshot;
  type: SessionHciEvent["type"];
  severity: SessionHciEvent["severity"];
  audience: SessionHciEvent["audience"];
  message: string;
  suggestedAction?: string | null;
  autoTrigger?: boolean;
  actorStudentId?: string | null;
  actorStudentName?: string | null;
  targetStudentId?: string | null;
  metadata?: Record<string, unknown>;
}): SessionHciEvent {
  const createdAt = nowIso();
  const unique = Math.random().toString(36).slice(2, 10);

  return {
    id: `${createdAt}-${input.type}-${unique}`,
    sessionId: input.room.id,
    sessionCode: input.room.code,
    type: input.type,
    severity: input.severity,
    message: input.message,
    suggestedAction: input.suggestedAction ?? null,
    studentId: input.actorStudentId ?? null,
    studentName: input.actorStudentName ?? null,
    targetStudentId: input.targetStudentId ?? null,
    audience: input.audience,
    autoTrigger: input.autoTrigger ?? true,
    createdAt,
    metadata: input.metadata,
  };
}

async function detectAndPublishHciEvents(context: HciDetectionContext): Promise<void> {
  const score = context.latestSignal.engagementScore;
  const emotion = context.latestSignal.emotion?.toLowerCase() ?? null;
  const absPitch = typeof context.latestSignal.pitch === "number" ? Math.abs(context.latestSignal.pitch) : 0;
  const absYaw = typeof context.latestSignal.yaw === "number" ? Math.abs(context.latestSignal.yaw) : 0;
  const flags = context.debugSummary.flags;

  const emits: SessionHciEvent[] = [];

  const lowEngagement = flags.includes("LOW_ENGAGEMENT") && typeof score === "number" && score < 0.4;
  if (lowEngagement) {
    const allowed = await shouldEmitEvent({
      roomCode: context.room.code,
      type: "LOW_ENGAGEMENT",
      targetStudentId: context.participant.userId,
      cooldownSec: LOW_ENGAGEMENT_ALERT_COOLDOWN_SECONDS,
    });

    if (allowed) {
      emits.push(
        createHciEvent({
          room: context.room,
          type: "LOW_ENGAGEMENT",
          severity: "warning",
          audience: "teacher",
          message: `${context.participant.displayName || context.participant.email} is showing low engagement.`,
          suggestedAction: "Check in with this student or ask a quick comprehension question.",
          actorStudentId: context.participant.userId,
          actorStudentName: context.participant.displayName,
          targetStudentId: context.participant.userId,
          metadata: {
            score,
            flags,
          },
        })
      );
    }
  }

  const confusionDetected =
    (emotion ? CONFUSION_EMOTIONS.includes(emotion) : false) || flags.includes("EMOTION_ALERT");
  if (confusionDetected) {
    const allowed = await shouldEmitEvent({
      roomCode: context.room.code,
      type: "CONFUSION_PROMPT",
      targetStudentId: context.participant.userId,
      cooldownSec: CONFUSION_PROMPT_COOLDOWN_SECONDS,
    });

    if (allowed) {
      emits.push(
        createHciEvent({
          room: context.room,
          type: "CONFUSION_PROMPT",
          severity: "info",
          audience: "student",
          message: "Having trouble with this section? You can raise your hand privately.",
          suggestedAction: "raise_hand",
          actorStudentId: context.participant.userId,
          actorStudentName: context.participant.displayName,
          targetStudentId: context.participant.userId,
          metadata: {
            emotion,
            flags,
          },
        })
      );
    }
  }

  const fatigueDetected =
    flags.includes("STALE_SIGNAL") ||
    (typeof score === "number" && score < 0.32 && absPitch > 18) ||
    (typeof score === "number" && score < 0.36 && absYaw > 28);

  if (fatigueDetected) {
    const allowed = await shouldEmitEvent({
      roomCode: context.room.code,
      type: "FATIGUE_WARNING",
      targetStudentId: context.participant.userId,
      cooldownSec: FATIGUE_ALERT_COOLDOWN_SECONDS,
    });

    if (allowed) {
      emits.push(
        createHciEvent({
          room: context.room,
          type: "FATIGUE_WARNING",
          severity: "warning",
          audience: "teacher",
          message: `${context.participant.displayName || context.participant.email} may be fatigued.`,
          suggestedAction: "Consider a short break or switching activity.",
          actorStudentId: context.participant.userId,
          actorStudentName: context.participant.displayName,
          targetStudentId: context.participant.userId,
          metadata: {
            score,
            absPitch,
            absYaw,
            flags,
          },
        })
      );
    }
  }

  if (emits.length === 0) {
    return;
  }

  await Promise.all(
    emits.map(async (event) => {
      try {
        await publishSessionHciEvent(event);
      } catch (error) {
        console.error("Failed to publish HCI event", error, event);
      }
    })
  );
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsedBody = signalIngestionBodySchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error) },
        { status: 400 }
      );
    }

    const { id } = await context.params;
    const room = await resolveSessionByIdentifier(id);

    if (!room) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    if (room.status === RoomStatus.ENDED) {
      return NextResponse.json({ error: "Session has already ended." }, { status: 409 });
    }

    const participant = await prisma.participant.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: parsedBody.data.participantId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (!participant) {
      return NextResponse.json(
        { error: "Participant is not a member of this room." },
        { status: 403 }
      );
    }

    const created = await prisma.cvSignalSample.create({
      data: {
        roomId: room.id,
        userId: participant.userId,
        capturedAt: new Date(),
        engagementScore: parsedBody.data.engagementScore,
        emotion: encodeSampleMeta({
          cameraEnabled: parsedBody.data.cameraEnabled,
          microphoneEnabled: parsedBody.data.microphoneEnabled,
          faceDetected: parsedBody.data.faceDetected,
          emotion: parsedBody.data.emotion,
        }),
        yaw: parsedBody.data.yaw,
        pitch: parsedBody.data.pitch,
        roll: parsedBody.data.roll,
      },
      select: {
        capturedAt: true,
      },
    });

    const participantRecord = await prisma.participant.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: participant.userId,
        },
      },
      select: {
        role: true,
        user: {
          select: {
            displayName: true,
            email: true,
          },
        },
      },
    });

    const latestSignal: LatestSignal = {
      capturedAt: created.capturedAt,
      engagementScore: parsedBody.data.engagementScore,
      cameraEnabled: parsedBody.data.cameraEnabled ?? null,
      microphoneEnabled: parsedBody.data.microphoneEnabled ?? null,
      faceDetected: parsedBody.data.faceDetected ?? null,
      emotion: parsedBody.data.emotion ?? null,
      yaw: parsedBody.data.yaw ?? null,
      pitch: parsedBody.data.pitch ?? null,
      roll: parsedBody.data.roll ?? null,
    };

    const debugSummary = buildDebugSummary({
      latest: latestSignal,
      previous: null,
      recent: [latestSignal],
      roomStatus: room.status,
    });

    await detectAndPublishHciEvents({
      room,
      participant: {
        userId: participant.userId,
        displayName: participantRecord?.user.displayName ?? null,
        email: participantRecord?.user.email ?? "unknown@student.local",
        role: participantRecord?.role ?? ParticipantRole.STUDENT,
      },
      latestSignal,
      debugSummary,
    });

    await syncDashboardRealtimeSnapshot(room);

    return NextResponse.json(
      {
        ok: true,
        capturedAt: created.capturedAt.toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to ingest signal sample", error);
    return NextResponse.json({ error: "Failed to ingest signal sample." }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const authSession = await auth.api.getSession({ headers: request.headers });

    if (!authSession) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { id } = await context.params;
    const room = await resolveSessionByIdentifier(id);

    if (!room) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    if (room.hostId !== authSession.user.id) {
      return NextResponse.json({ error: "Only the host can view session signals." }, { status: 403 });
    }

    const payload = await syncDashboardRealtimeSnapshot(room);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch session signals", error);
    return NextResponse.json({ error: "Failed to fetch session signals." }, { status: 500 });
  }
}
