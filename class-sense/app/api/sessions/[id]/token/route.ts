import { NextRequest, NextResponse } from "next/server";
import {
  getValidationErrorMessage,
  sessionTokenRequestBodySchema,
} from "@/lib/request-validation";
import { createParticipantToken } from "@/lib/server/livekit-token-service";
import { resolveSessionByIdentifier } from "@/lib/server/session-service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsedBody = sessionTokenRequestBodySchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error) },
        { status: 400 }
      );
    }

    const { id } = await context.params;
    const session = await resolveSessionByIdentifier(id);

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const tokenResult = await createParticipantToken({
      headers: request.headers,
      roomCode: session.code,
      participantName: parsedBody.data.participantName,
      participantEmail: parsedBody.data.participantEmail,
    });

    if ("error" in tokenResult) {
      return NextResponse.json(
        { error: tokenResult.error.message },
        { status: tokenResult.error.status }
      );
    }

    return NextResponse.json(tokenResult.data, { status: 200 });
  } catch (error) {
    console.error("Failed to create session token", error);
    return NextResponse.json(
      { error: "Failed to generate participant token." },
      { status: 500 }
    );
  }
}
