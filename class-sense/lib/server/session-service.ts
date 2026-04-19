import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { Prisma } from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRoomCode, toLivekitRoomName } from "@/lib/room-code";

type SessionResponse = {
  session: {
    id: string;
    code: string;
    title: string;
    status: RoomStatus;
    livekitRoomName: string;
  };
  host: {
    id: string;
    displayName: string | null;
    email: string;
  };
};

const MAX_ROOM_CODE_ATTEMPTS = 8;

function buildDefaultRoomTitle(): string {
  return `ClassSense Room ${new Date().toLocaleString()}`;
}

export async function resolveSessionByIdentifier(identifier: string) {
  const normalized = identifier.trim();

  const byCode = await prisma.room.findUnique({
    where: { code: normalized.toUpperCase() },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      endedAt: true,
      livekitRoomName: true,
      hostId: true,
      host: {
        select: {
          id: true,
          displayName: true,
          email: true,
        },
      },
    },
  });

  if (byCode) {
    return byCode;
  }

  return prisma.room.findUnique({
    where: { id: normalized },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      endedAt: true,
      livekitRoomName: true,
      hostId: true,
      host: {
        select: {
          id: true,
          displayName: true,
          email: true,
        },
      },
    },
  });
}

export async function createSession(input: {
  headers: Headers;
  title?: string;
  hostName?: string;
  hostEmail?: string;
}): Promise<SessionResponse | { error: { status: number; message: string } }> {
  const session = await auth.api.getSession({ headers: input.headers });

  if (!session) {
    return {
      error: {
        status: 401,
        message: "Unauthorized.",
      },
    };
  }

  if (input.hostEmail && input.hostEmail !== session.user.email.toLowerCase()) {
    return {
      error: {
        status: 403,
        message: "hostEmail must match the authenticated user email.",
      },
    };
  }

  const hostEmail = session.user.email;
  const hostName = input.hostName ?? session.user.name ?? hostEmail.split("@")[0];
  const title = input.title ?? buildDefaultRoomTitle();

  const hostUser = await prisma.user.upsert({
    where: { email: hostEmail },
    update: {
      displayName: hostName,
      emailVerified: session.user.emailVerified,
    },
    create: {
      email: hostEmail,
      displayName: hostName,
      emailVerified: session.user.emailVerified,
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

      return {
        session: {
          id: room.id,
          code: room.code,
          title: room.title,
          status: room.status,
          livekitRoomName: room.livekitRoomName,
        },
        host: {
          id: hostUser.id,
          displayName: hostUser.displayName,
          email: hostUser.email,
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }

      throw error;
    }
  }

  return {
    error: {
      status: 500,
      message: "Unable to allocate unique room code. Try again.",
    },
  };
}

export async function endSession(input: {
  headers: Headers;
  sessionIdentifier: string;
}): Promise<
  | {
      data: {
        session: {
          id: string;
          code: string;
          status: RoomStatus;
          endedAt: string;
        };
      };
    }
  | {
      error: {
        status: number;
        message: string;
      };
    }
> {
  const authSession = await auth.api.getSession({ headers: input.headers });

  if (!authSession) {
    return {
      error: {
        status: 401,
        message: "Unauthorized.",
      },
    };
  }

  const room = await resolveSessionByIdentifier(input.sessionIdentifier);

  if (!room) {
    return {
      error: {
        status: 404,
        message: "Session not found.",
      },
    };
  }

  if (room.hostId !== authSession.user.id) {
    return {
      error: {
        status: 403,
        message: "Only the session host can end this session.",
      },
    };
  }

  if (room.status === RoomStatus.ENDED && room.endedAt) {
    return {
      data: {
        session: {
          id: room.id,
          code: room.code,
          status: RoomStatus.ENDED,
          endedAt: room.endedAt.toISOString(),
        },
      },
    };
  }

  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      status: RoomStatus.ENDED,
      endedAt: room.endedAt ?? new Date(),
    },
    select: {
      id: true,
      code: true,
      status: true,
      endedAt: true,
    },
  });

  return {
    data: {
      session: {
        id: updated.id,
        code: updated.code,
        status: updated.status,
        endedAt: (updated.endedAt ?? new Date()).toISOString(),
      },
    },
  };
}
