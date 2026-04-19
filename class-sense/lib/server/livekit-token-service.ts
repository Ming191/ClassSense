import { ParticipantRole, RoomStatus } from "@/app/generated/prisma/enums";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { buildGuestEmail } from "@/lib/request-input";
import { auth } from "@/lib/auth";

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
