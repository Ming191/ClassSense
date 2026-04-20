import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { buildGuestEmail } from "@/lib/request-input";
import { auth } from "@/lib/auth";
import { upsertSessionDashboardMeta } from "@/lib/firebase/admin";

export type LivekitConfig = {
  apiKey: string;
  apiSecret: string;
  serverUrl: string;
};

type ParticipantTokenPayload = {
  token: string;
  serverUrl: string;
  room: {
    code: string;
    title: string;
    livekitRoomName: string;
  };
  participant: {
    id: string;
    displayName: string | null;
    role: ParticipantRole;
  };
};

type WorkerTokenPayload = {
  token: string;
  serverUrl: string;
  room: {
    id: string;
    code: string;
    title: string;
    livekitRoomName: string;
  };
  worker: {
    identity: string;
    name: string;
  };
};

export type CreateParticipantTokenResult =
  | {
      error: {
        status: number;
        message: string;
      };
    }
  | {
      data: ParticipantTokenPayload;
    };

export type CreateWorkerTokenResult =
  | {
      error: {
        status: number;
        message: string;
      };
    }
  | {
      data: WorkerTokenPayload;
    };

export function getLivekitConfig(): LivekitConfig | null {
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

export async function createParticipantToken(input: {
  headers: Headers;
  roomCode: string;
  participantName?: string;
  participantEmail?: string;
}): Promise<CreateParticipantTokenResult> {
  const session = await auth.api.getSession({ headers: input.headers });
  const livekitConfig = getLivekitConfig();

  if (!livekitConfig) {
    return {
      error: {
        status: 500,
        message:
          "Missing LiveKit env. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL or LIVEKIT_URL.",
      },
    } as const;
  }

  const room = await prisma.room.findUnique({
    where: { code: input.roomCode },
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
    return {
      error: {
        status: 404,
        message: "Room not found.",
      },
    } as const;
  }

  if (room.status === RoomStatus.ENDED) {
    return {
      error: {
        status: 409,
        message: "Room has already ended.",
      },
    } as const;
  }

  const participantNameFromBody = input.participantName;

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
  } else if (input.participantEmail) {
    user = await prisma.user.upsert({
      where: { email: input.participantEmail },
      update: {
        displayName: participantNameFromBody ?? "Guest",
      },
      create: {
        email: input.participantEmail,
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
    const promotedRoom = await prisma.room.update({
      where: { id: room.id },
      data: {
        status: RoomStatus.LIVE,
        startedAt: new Date(),
      },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
      },
    });

    try {
      await upsertSessionDashboardMeta({
        sessionId: promotedRoom.id,
        sessionCode: promotedRoom.code,
        status: promotedRoom.status,
        title: promotedRoom.title,
        hostId: room.hostId,
      });
    } catch (syncError) {
      console.error("Failed to sync promoted room metadata to Firestore", syncError);
    }
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

  return {
    data: {
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
  } as const;
}

export async function createServiceWorkerToken(input: {
  roomCode: string;
  workerIdentity?: string;
  workerName?: string;
  expectedSecret?: string;
}): Promise<CreateWorkerTokenResult> {
  if (!input.expectedSecret || input.expectedSecret !== process.env.WORKER_AUTH_SECRET) {
    return {
      error: {
        status: 401,
        message: "Unauthorized worker request.",
      },
    };
  }

  const livekitConfig = getLivekitConfig();

  if (!livekitConfig) {
    return {
      error: {
        status: 500,
        message:
          "Missing LiveKit env. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL or LIVEKIT_URL.",
      },
    };
  }

  const room = await prisma.room.findUnique({
    where: { code: input.roomCode },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      livekitRoomName: true,
    },
  });

  if (!room) {
    return {
      error: {
        status: 404,
        message: "Room not found.",
      },
    };
  }

  if (room.status === RoomStatus.ENDED) {
    return {
      error: {
        status: 409,
        message: "Room has already ended.",
      },
    };
  }

  const workerIdentity =
    input.workerIdentity?.trim() || `cv-worker-${room.code.toLowerCase()}`;
  const workerName = input.workerName?.trim() || "CV Worker";

  const accessToken = new AccessToken(livekitConfig.apiKey, livekitConfig.apiSecret, {
    identity: workerIdentity,
    name: workerName,
    metadata: JSON.stringify({
      role: "SERVICE_WORKER",
      roomCode: room.code,
    }),
    ttl: "2h",
  });

  accessToken.addGrant({
    roomJoin: true,
    room: room.livekitRoomName,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    hidden: true,
  });

  const token = await accessToken.toJwt();

  return {
    data: {
      token,
      serverUrl: livekitConfig.serverUrl,
      room: {
        id: room.id,
        code: room.code,
        title: room.title,
        livekitRoomName: room.livekitRoomName,
      },
      worker: {
        identity: workerIdentity,
        name: workerName,
      },
    },
  };
}
