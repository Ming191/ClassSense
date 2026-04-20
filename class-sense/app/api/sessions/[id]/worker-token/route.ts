import { NextRequest, NextResponse } from "next/server";
import {
  getValidationErrorMessage,
  workerTokenRequestBodySchema,
} from "@/lib/request-validation";
import {
  createServiceWorkerToken,
  getLivekitConfig,
} from "@/lib/server/livekit-token-service";
import { resolveSessionByIdentifier } from "@/lib/server/session-service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    if (!getLivekitConfig()) {
      return NextResponse.json(
        {
          error:
            "Missing LiveKit env. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL or LIVEKIT_URL.",
        },
        { status: 500 }
      );
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsedBody = workerTokenRequestBodySchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error) },
        { status: 400 }
      );
    }

    const workerSecret =
      extractBearerToken(request.headers.get("authorization")) ||
      request.headers.get("x-worker-secret");

    const { id } = await context.params;
    const session = await resolveSessionByIdentifier(id);

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const tokenResult = await createServiceWorkerToken({
      roomCode: session.code,
      workerIdentity: parsedBody.data.workerIdentity,
      workerName: parsedBody.data.workerName,
      expectedSecret: workerSecret || undefined,
    });

    if ("error" in tokenResult) {
      return NextResponse.json(
        { error: tokenResult.error.message },
        { status: tokenResult.error.status }
      );
    }

    return NextResponse.json(tokenResult.data, { status: 200 });
  } catch (error) {
    console.error("Failed to create worker token", error);
    return NextResponse.json(
      { error: "Failed to generate worker token." },
      { status: 500 }
    );
  }
}
