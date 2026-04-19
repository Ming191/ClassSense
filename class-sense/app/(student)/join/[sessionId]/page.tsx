"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

const ROOM_CODE_PATTERN = /^[A-Z0-9]{8}$/;

type SessionLookupResponse = {
  session: {
    id: string;
    code: string;
  };
};

export default function StudentJoinSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = params.sessionId;

  useEffect(() => {
    const normalized = sessionId?.trim().toUpperCase();
    const name = searchParams.get("name")?.trim() ?? "";
    const email = searchParams.get("email")?.trim() ?? "";

    const query = new URLSearchParams();
    if (name) {
      query.set("name", name);
    }

    if (email) {
      query.set("email", email);
    }

    const suffix = query.toString();
    const toRoomPath = (roomCode: string) =>
      suffix ? `/room/${roomCode}?${suffix}` : `/room/${roomCode}`;

    if (normalized && ROOM_CODE_PATTERN.test(normalized)) {
      router.replace(toRoomPath(normalized));
      return;
    }

    let isCancelled = false;

    async function resolveSessionCode() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as SessionLookupResponse;

        if (!isCancelled && payload.session?.code) {
          router.replace(toRoomPath(payload.session.code));
        }
      } catch {
        // Intentionally ignored to keep scaffold resilient.
      }
    }

    resolveSessionCode();

    return () => {
      isCancelled = true;
    };
  }, [router, searchParams, sessionId]);

  return <p className="p-6">Student join route scaffolded</p>;
}
