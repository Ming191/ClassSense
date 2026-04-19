"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Fraunces, Manrope } from "next/font/google";
import { signIn, signOut, signUp, useSession } from "@/lib/auth-client";

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

type CreateRoomResponse = {
  session: {
    id: string;
    code: string;
  };
};

function buildJoinUrl(
  sessionId: string,
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
  return query ? `/join/${sessionId}?${query}` : `/join/${sessionId}`;
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
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  function openAuthModal(mode: "signin" | "signup" = "signin") {
    setAuthMode(mode);
    setAuthError(null);
    setAuthEmail((previousValue) => previousValue || email.trim());
    setIsAuthModalOpen(true);
  }

  function closeAuthModal() {
    if (isAuthSubmitting) {
      return;
    }

    setIsAuthModalOpen(false);
    setAuthError(null);
    setAuthPassword("");
  }

  useEffect(() => {
    if (!isAuthModalOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isAuthSubmitting) {
          return;
        }

        setIsAuthModalOpen(false);
        setAuthError(null);
        setAuthPassword("");
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isAuthModalOpen, isAuthSubmitting]);

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
      openAuthModal("signin");
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch("/api/sessions", {
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
          openAuthModal("signin");
          setAuthError("Your session has expired. Please sign in again to host a room.");
          return;
        }

        throw new Error(payload.error ?? "Failed to create room");
      }

      const payload = (await response.json()) as CreateRoomResponse;

      router.push(
        buildJoinUrl(payload.session.id, name, email, {
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
      buildJoinUrl(joinCode.trim().toUpperCase(), name, email, {
        includeEmail: !session?.user,
      })
    );
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setIsAuthSubmitting(true);

    try {
      if (authMode === "signin") {
        const result = await signIn.email({
          email: authEmail,
          password: authPassword,
        });

        if (result.error) {
          throw new Error(result.error.message ?? "Unable to sign in.");
        }
      } else {
        const result = await signUp.email({
          name: authName.trim() || "ClassSense User",
          email: authEmail,
          password: authPassword,
        });

        if (result.error) {
          throw new Error(result.error.message ?? "Unable to create account.");
        }
      }

      setIsAuthModalOpen(false);
      setAuthPassword("");
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : authMode === "signin"
            ? "Unable to sign in right now."
            : "Unable to create account right now.";
      setAuthError(message);
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  return (
    <div
      className={`${displayFont.variable} ${bodyFont.variable} relative min-h-screen overflow-hidden bg-[#f7f8fe] px-4 py-6 text-slate-900 sm:px-8 sm:py-8`}
    >
      <div className="pointer-events-none absolute -left-28 -top-36 h-80 w-80 rounded-full bg-[#d5bbff]/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-20 h-72 w-72 rounded-full bg-[#fbcfe8]/60 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-[#bae6fd]/50 blur-3xl" />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-7">
        <header className="rounded-3xl border border-white/80 bg-white/70 px-5 py-4 shadow-[0_25px_70px_-55px_rgba(30,41,59,0.5)] backdrop-blur sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-700">
                ClassSense Realtime
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {isSessionPending
                  ? "Checking auth session..."
                  : session?.user
                    ? `Signed in as ${session.user.email}`
                    : "Guest mode: join room is available"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {session?.user ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex cursor-pointer items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors duration-200 hover:bg-slate-50"
                >
                  Sign out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal("signin")}
                  className="inline-flex cursor-pointer items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors duration-200 hover:bg-slate-50"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="relative overflow-hidden rounded-[2rem] border border-indigo-100/80 bg-[linear-gradient(135deg,#ffffff_8%,#f7f5ff_45%,#eef8ff_100%)] px-6 py-10 shadow-[0_30px_90px_-70px_rgba(30,27,75,0.7)] sm:px-10">
          <div className="pointer-events-none absolute right-0 top-0 h-44 w-44 translate-x-1/3 -translate-y-1/3 rotate-12 rounded-full border border-fuchsia-300/70" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 -translate-x-1/3 translate-y-1/3 rounded-full border border-sky-300/60" />

          <div className="relative max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600">
              Real-time classroom intelligence
            </p>
            <h1
              className="mt-4 text-4xl leading-tight text-slate-900 sm:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Host focus-first classes and track live attention signals.
            </h1>
            <p
              className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg"
              style={{ fontFamily: "var(--font-body)" }}
            >
              Create a room when you&apos;re signed in, share a short code, and run
              engaging video sessions with immediate AI-powered feedback.
            </p>

            {!session?.user ? (
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => openAuthModal("signin")}
                  className="inline-flex cursor-pointer items-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-700"
                >
                  Sign in to host
                </button>
                <button
                  type="button"
                  onClick={() => openAuthModal("signup")}
                  className="inline-flex cursor-pointer items-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-50"
                >
                  Create account
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          {session?.user ? (
            <form
              onSubmit={handleCreateRoom}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_50px_-45px_rgba(15,23,42,0.8)]"
            >
              <h2 className="text-xl font-semibold text-slate-900">Create room</h2>
              <p className="mt-2 text-sm text-slate-600">
                Hosts can launch a room and invite learners with one short code.
              </p>

              <div className="mt-5 space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Room title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100"
                    required
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Your name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100"
                    placeholder="Nguyen"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Host email
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-100/70 px-3 py-2 text-sm text-slate-700 outline-none"
                    placeholder={session.user.email}
                    disabled
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={isCreating}
                className="mt-6 inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isCreating ? "Creating room..." : "Create and join"}
              </button>
            </form>
          ) : (
            <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 shadow-[0_20px_45px_-45px_rgba(146,64,14,0.7)]">
              <h2 className="text-xl font-semibold text-amber-900">Host mode locked</h2>
              <p className="mt-2 text-sm leading-relaxed text-amber-800">
                Sign in to create and host a room. Guest learners can still join any
                room using code below.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal("signin")}
                className="mt-5 inline-flex cursor-pointer items-center rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-amber-800"
              >
                Sign in to host
              </button>
            </section>
          )}

          <form
            onSubmit={handleJoinRoom}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_50px_-45px_rgba(15,23,42,0.8)]"
          >
            <h2 className="text-xl font-semibold text-slate-900">Join room</h2>
            <p className="mt-2 text-sm text-slate-600">
              Guest and learners can join instantly with room code.
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
              className="mt-6 inline-flex w-full cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors duration-200 hover:border-slate-400 hover:bg-slate-50"
            >
              Join existing room
            </button>
          </form>
        </section>
      </main>

      {isAuthModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 sm:px-6">
          <button
            type="button"
            aria-label="Close authentication modal"
            onClick={closeAuthModal}
            className="absolute inset-0 cursor-pointer bg-slate-900/45 backdrop-blur-sm"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-label="Authentication"
            className="relative z-10 w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={closeAuthModal}
              className="absolute right-3 top-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>

            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-700">
              {authMode === "signin" ? "Welcome back" : "Start hosting"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              {authMode === "signin" ? "Sign in" : "Create account"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {authMode === "signin"
                ? "Sign in to create and manage live classrooms."
                : "Create your account to host ClassSense rooms."}
            </p>

            <div className="mt-5 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signin");
                  setAuthError(null);
                }}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-200 ${
                  authMode === "signin"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setAuthError(null);
                }}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-200 ${
                  authMode === "signup"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sign up
              </button>
            </div>

            {authError ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {authError}
              </div>
            ) : null}

            <form onSubmit={handleAuthSubmit} className="mt-4 space-y-4">
              {authMode === "signup" ? (
                <label className="block text-sm font-medium text-slate-700">
                  Name
                  <input
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100"
                    placeholder="Class host"
                  />
                </label>
              ) : null}

              <label className="block text-sm font-medium text-slate-700">
                Email
                <input
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Password
                <input
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  type="password"
                  minLength={8}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isAuthSubmitting
                  ? authMode === "signin"
                    ? "Signing in..."
                    : "Creating account..."
                  : authMode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
