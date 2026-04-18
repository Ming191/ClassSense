import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { buildGuestEmail } from "@/lib/request-input";
import { auth } from "@/lib/auth";
import {
  getValidationErrorMessage,
  tokenRequestBodySchema,
} from "@/lib/request-validation";

type LivekitConfig = {
  apiKey: string;
  apiSecret: string;
  serverUrl: string;
};

function getLivekitConfig(): LivekitConfig | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl) {
    return null;
  }

  return {
    apiKey,
    apiSecret,
    serverUrl,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsedBody = tokenRequestBodySchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error) },
        { status: 400 }
      );
    }

    const roomCode = parsedBody.data.roomCode;
    const session = await auth.api.getSession({ headers: request.headers });

    const livekitConfig = getLivekitConfig();

    if (!livekitConfig) {
      return NextResponse.json(
        {
          error:
            "Missing LiveKit env. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL or LIVEKIT_URL.",
        },
        { status: 500 }
      );
    }

    const room = await prisma.room.findUnique({
      where: { code: roomCode },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        hostId: true,
        livekitRoomName: true,
      },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.status === RoomStatus.ENDED) {
      return NextResponse.json({ error: "Room has already ended." }, { status: 409 });
    }

    const participantNameFromBody = parsedBody.data.participantName;

    let user;

    if (session) {
      user = await prisma.user.upsert({
        where: { id: session.user.id },
        update: {
          email: session.user.email,
          displayName: participantNameFromBody ?? session.user.name,
          emailVerified: session.user.emailVerified,
        },
        create: {
          id: session.user.id,
          email: session.user.email,
          displayName: participantNameFromBody ?? session.user.name,
          emailVerified: session.user.emailVerified,
        },
      });
    } else if (parsedBody.data.participantEmail) {
      user = await prisma.user.upsert({
        where: { email: parsedBody.data.participantEmail },
        update: {
          displayName: participantNameFromBody ?? "Guest",
        },
        create: {
          email: parsedBody.data.participantEmail,
          displayName: participantNameFromBody ?? "Guest",
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: buildGuestEmail(),
          displayName: participantNameFromBody ?? "Guest",
        },
      });
    }

    const participantName =
      user.displayName ?? participantNameFromBody ?? session?.user.name ?? "Guest";
    const role = session?.user.id === room.hostId ? ParticipantRole.HOST : ParticipantRole.STUDENT;

    await prisma.participant.upsert({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: user.id,
        },
      },
      update: {
        role,
        leftAt: null,
      },
      create: {
        roomId: room.id,
        userId: user.id,
        role,
      },
    });

    if (room.status === RoomStatus.SCHEDULED) {
      await prisma.room.update({
        where: { id: room.id },
        data: {
          status: RoomStatus.LIVE,
          startedAt: new Date(),
        },
      });
    }

    const accessToken = new AccessToken(livekitConfig.apiKey, livekitConfig.apiSecret, {
      identity: user.id,
      name: user.displayName ?? participantName,
      metadata: JSON.stringify({
        userId: user.id,
        email: user.email,
        role,
        roomCode: room.code,
      }),
      ttl: "2h",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: room.livekitRoomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await accessToken.toJwt();

    return NextResponse.json(
      {
        token,
        serverUrl: livekitConfig.serverUrl,
        room: {
          code: room.code,
          title: room.title,
          livekitRoomName: room.livekitRoomName,
        },
        participant: {
          id: user.id,
          displayName: user.displayName,
          role,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to create LiveKit token", error);
    return NextResponse.json(
      { error: "Failed to generate participant token." },
      { status: 500 }
    );
  }
}
