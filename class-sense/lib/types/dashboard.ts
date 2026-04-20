import { RoomStatus } from "@/app/generated/prisma/enums";

export type ScoreBucket = "high" | "medium" | "low" | "unknown";
export type TrendDirection = "up" | "down" | "flat" | "unknown";

export type ParticipantDebugMetrics = {
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
};

export type DashboardPayload = {
  session: {
    id: string;
    code: string;
    title: string;
    status: RoomStatus;
  };
  classAverage: number | null;
  classMetrics: {
    participantCount: number;
    withSignalCount: number;
    noSignalCount: number;
    staleCount: number;
    lowCount: number;
    mediumCount: number;
    highCount: number;
    avgSignalAgeSec: number | null;
    avgCadenceSec: number | null;
    trend: {
      up: number;
      down: number;
      flat: number;
      unknown: number;
    };
    flagCounts: Record<string, number>;
  };
  participants: Array<{
    userId: string;
    role: string;
    displayName: string | null;
    email: string;
    latestSignal: {
      capturedAt: string;
      engagementScore: number | null;
      emotion: string | null;
      yaw: number | null;
      pitch: number | null;
      roll: number | null;
    } | null;
    flags: string[];
    debugMetrics: ParticipantDebugMetrics;
  }>;
};
