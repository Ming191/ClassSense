import { NextRequest, NextResponse } from "next/server";
import { endSession, resolveSessionByIdentifier } from "@/lib/server/session-service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const room = await resolveSessionByIdentifier(id);

  if (!room) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({
    session: {
      id: room.id,
      code: room.code,
      title: room.title,
      status: room.status,
      livekitRoomName: room.livekitRoomName,
    },
    host: room.host,
  });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await endSession({
      headers: request.headers,
      sessionIdentifier: id,
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error.message },
        { status: result.error.status }
      );
    }

    return NextResponse.json(result.data, { status: 200 });
  } catch (error) {
    console.error("Failed to end session", error);
    return NextResponse.json({ error: "Failed to end session." }, { status: 500 });
  }
}
