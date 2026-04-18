import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { Prisma } from "@/app/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRoomCode, toLivekitRoomName } from "@/lib/room-code";

type CreateRoomBody = {
  title?: string;
  hostName?: string;
  hostEmail?: string;
};

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateRoomBody;
    const hostEmail = body.hostEmail ? normalizeEmail(body.hostEmail) : "";

    if (!hostEmail || !hostEmail.includes("@")) {
      return NextResponse.json(
        { error: "hostEmail is required and must be a valid email." },
        { status: 400 }
      );
    }

    const hostName = body.hostName?.trim() || hostEmail.split("@")[0];
    const title = body.title?.trim() || `ClassSense Room ${new Date().toLocaleString()}`;

    const hostUser = await prisma.user.upsert({
      where: { email: hostEmail },
      update: { displayName: hostName },
      create: {
        email: hostEmail,
        displayName: hostName,
      },
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
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
