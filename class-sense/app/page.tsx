"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";

type CreateRoomResponse = {
  room: {
    code: string;
  };
};

function buildRoomUrl(
  code: string,
  name: string,
  email: string,
  options?: { includeEmail?: boolean }
): string {
  const searchParams = new URLSearchParams();

  if (name.trim()) {
    searchParams.set("name", name.trim());
  }

  if (options?.includeEmail !== false && email.trim()) {
    searchParams.set("email", email.trim());
  }

  const query = searchParams.toString();
  return query ? `/room/${code}?${query}` : `/room/${code}`;
}

export default function Home() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = useSession();
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-GB"),
    []
  );

  const [title, setTitle] = useState(`ClassSense Session ${todayLabel}`);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSignOut() {
    setError(null);

    const result = await signOut();

    if (result.error) {
      setError(result.error.message ?? "Unable to sign out.");
    }
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!session?.user) {
      router.push("/auth?next=%2F");
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          hostName: name,
          hostEmail: email,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };

        if (response.status === 401) {
          router.push("/auth?next=%2F");
          return;
        }

        throw new Error(payload.error ?? "Failed to create room");
      }

      const payload = (await response.json()) as CreateRoomResponse;
      router.push(
        buildRoomUrl(payload.room.code, name, email, {
          includeEmail: !session?.user,
        })
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to create a room right now.";
      setError(message);
    } finally {
      setIsCreating(false);
    }
  }

  function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!joinCode.trim()) {
      setError("Please enter a room code to join.");
      return;
    }

    router.push(
      buildRoomUrl(joinCode.trim().toUpperCase(), name, email, {
        includeEmail: !session?.user,
      })
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e2f4ff_0%,_#fef6ee_45%,_#fff_80%)] px-4 py-12 text-slate-900 sm:px-8">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-8 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.35)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            ClassSense Realtime
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <p>
              {isSessionPending
                ? "Checking auth session..."
                : session?.user
                  ? `Signed in as ${session.user.email}`
                  : "Not signed in"}
            </p>
            {session?.user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/auth?next=%2F"
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign in / Sign up
              </Link>
            )}
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Video classroom with live AI attention signals.
          </h1>
          <p className="mt-4 max-w-3xl text-base text-slate-600 sm:text-lg">
            Start a room in one click, invite learners with a short code, then
            stream audio/video while your CV pipeline scores engagement in
            realtime.
          </p>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!session?.user ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
            You need to sign in before creating rooms. Guests can still join an existing room.
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleCreateRoom}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold text-slate-900">Create room</h2>
            <p className="mt-2 text-sm text-slate-600">
              Host creates a room and receives a code learners can join.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Room title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Your name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="Nguyen"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Host email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="host@classsense.ai"
                  required
                  disabled={Boolean(session?.user)}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isCreating ? "Creating room..." : "Create and join"}
            </button>
          </form>

          <form
            onSubmit={handleJoinRoom}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold text-slate-900">Join room</h2>
            <p className="mt-2 text-sm text-slate-600">
              Learners can join with room code and display name.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Room code
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm uppercase tracking-[0.16em] text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="ABCD1234"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Your name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="Learner name"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Email (optional)
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="student@classsense.ai"
                />
              </label>
            </div>

            <button
              type="submit"
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Join existing room
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
