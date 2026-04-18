import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";

type TokenRequestBody = {
  roomCode?: string;
  participantName?: string;
  participantEmail?: string;
};

function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function buildGuestEmail(): string {
  return `guest-${crypto.randomUUID()}@guest.classsense.local`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TokenRequestBody;
    const roomCode = body.roomCode ? normalizeRoomCode(body.roomCode) : "";

    if (!roomCode) {
      return NextResponse.json({ error: "roomCode is required." }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !serverUrl) {
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

    const participantName = body.participantName?.trim() || "Guest";
    const participantEmail = body.participantEmail?.trim()
      ? normalizeEmail(body.participantEmail)
      : buildGuestEmail();

    const user = await prisma.user.upsert({
      where: { email: participantEmail },
      update: {
        displayName: participantName,
      },
      create: {
        email: participantEmail,
        displayName: participantName,
      },
    });

    const role = user.id === room.hostId ? ParticipantRole.HOST : ParticipantRole.STUDENT;

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

    const accessToken = new AccessToken(apiKey, apiSecret, {
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
        serverUrl,
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
