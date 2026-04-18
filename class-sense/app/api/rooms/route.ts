import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { Prisma } from "@/app/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRoomCode, toLivekitRoomName } from "@/lib/room-code";
import {
  createRoomBodySchema,
  getValidationErrorMessage,
} from "@/lib/request-validation";

const MAX_ROOM_CODE_ATTEMPTS = 8;

function buildDefaultRoomTitle(): string {
  return `ClassSense Room ${new Date().toLocaleString()}`;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsedBody = createRoomBodySchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error) },
        { status: 400 }
      );
    }

    const hostEmail = parsedBody.data.hostEmail;
    const hostName = parsedBody.data.hostName ?? hostEmail.split("@")[0];
    const title = parsedBody.data.title ?? buildDefaultRoomTitle();

    const hostUser = await prisma.user.upsert({
      where: { email: hostEmail },
      update: { displayName: hostName },
      create: {
        email: hostEmail,
        displayName: hostName,
      },
    });

    for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
      const roomCode = createRoomCode();

      try {
        const room = await prisma.room.create({
          data: {
            code: roomCode,
            title,
            status: RoomStatus.LIVE,
            hostId: hostUser.id,
            livekitRoomName: toLivekitRoomName(roomCode),
            startedAt: new Date(),
            participants: {
              create: {
                userId: hostUser.id,
                role: ParticipantRole.HOST,
              },
            },
          },
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            livekitRoomName: true,
          },
        });

        return NextResponse.json(
          {
            room,
            host: {
              id: hostUser.id,
              displayName: hostUser.displayName,
              email: hostUser.email,
            },
          },
          { status: 201 }
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }

        throw error;
      }
    }

    return NextResponse.json(
      { error: "Unable to allocate unique room code. Try again." },
      { status: 500 }
    );
  } catch (error) {
    console.error("Failed to create room", error);
    return NextResponse.json({ error: "Failed to create room." }, { status: 500 });
  }
}
