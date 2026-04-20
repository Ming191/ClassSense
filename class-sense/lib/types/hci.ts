export type HciEventType =
  | "LOW_ENGAGEMENT"
  | "CONFUSION_PROMPT"
  | "FATIGUE_WARNING"
  | "BREAK_SUGGESTION";

export type HciEventSeverity = "info" | "warning" | "critical";
export type HciEventAudience = "teacher" | "student" | "all";

export type SessionHciEvent = {
  id: string;
  sessionId: string;
  sessionCode: string;
  type: HciEventType;
  severity: HciEventSeverity;
  message: string;
  suggestedAction: string | null;
  studentId: string | null;
  studentName: string | null;
  targetStudentId: string | null;
  audience: HciEventAudience;
  autoTrigger: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
};
