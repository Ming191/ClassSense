import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { publishSessionHciEvent } from "@/lib/firebase/admin";
import { resolveSessionByIdentifier } from "@/lib/server/session-service";
import { SessionHciEvent } from "@/lib/types/hci";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ManualHciEventBody = {
  type?: string;
};

function createManualEvent(input: {
  sessionId: string;
  sessionCode: string;
  type: SessionHciEvent["type"];
}): SessionHciEvent {
  const createdAt = new Date().toISOString();
  const nonce = Math.random().toString(36).slice(2, 10);

  if (input.type === "BREAK_SUGGESTION") {
    return {
      id: `${createdAt}-${input.type}-${nonce}`,
      sessionId: input.sessionId,
      sessionCode: input.sessionCode,
      type: "BREAK_SUGGESTION",
      severity: "info",
      audience: "all",
      message: "Teacher suggests a short break.",
      suggestedAction: "take_break",
      studentId: null,
      studentName: null,
      targetStudentId: null,
      autoTrigger: false,
      createdAt,
      metadata: {
        source: "teacher_manual",
      },
    };
  }

  return {
    id: `${createdAt}-${input.type}-${nonce}`,
    sessionId: input.sessionId,
    sessionCode: input.sessionCode,
    type: input.type,
    severity: "info",
    audience: "teacher",
    message: "Manual HCI event emitted.",
    suggestedAction: null,
    studentId: null,
    studentName: null,
    targetStudentId: null,
    autoTrigger: false,
    createdAt,
  };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
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
      return NextResponse.json({ error: "Only the host can emit manual HCI events." }, { status: 403 });
    }

    const rawBody = (await request.json().catch(() => ({}))) as ManualHciEventBody;
    const type = rawBody.type;

    if (type !== "BREAK_SUGGESTION") {
      return NextResponse.json({ error: "Unsupported manual event type." }, { status: 400 });
    }

    const event = createManualEvent({
      sessionId: room.id,
      sessionCode: room.code,
      type,
    });

    await publishSessionHciEvent(event);

    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (error) {
    console.error("Failed to emit manual HCI event", error);
    return NextResponse.json({ error: "Failed to emit manual HCI event." }, { status: 500 });
  }
}
