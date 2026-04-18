"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, signUp, useSession } from "@/lib/auth-client";

function resolveNextPath(rawNext: string | null): string {
  const fallback = "/";

  if (!rawNext) {
    return fallback;
  }

  if (!rawNext.startsWith("/")) {
    return fallback;
  }

  if (rawNext.startsWith("//")) {
    return fallback;
  }

  return rawNext;
}

export function AuthPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: isSessionPending } = useSession();

  const nextPath = useMemo(
    () => resolveNextPath(searchParams.get("next")),
    [searchParams]
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);

  useEffect(() => {
    if (!isSessionPending && session?.user) {
      router.replace(nextPath);
    }
  }, [isSessionPending, nextPath, router, session?.user]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSigningIn(true);

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        throw new Error(result.error.message ?? "Unable to sign in.");
      }

      router.replace(nextPath);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unable to sign in right now.";
      setError(message);
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSigningUp(true);

    try {
      const result = await signUp.email({
        name: name.trim() || "ClassSense User",
        email,
        password,
      });

      if (result.error) {
        throw new Error(result.error.message ?? "Unable to sign up.");
      }

      router.replace(nextPath);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unable to sign up right now.";
      setError(message);
    } finally {
      setIsSigningUp(false);
    }
  }

  if (isSessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#e2f4ff_0%,_#fef6ee_45%,_#fff_80%)] px-4 text-slate-700">
        Checking auth session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e2f4ff_0%,_#fef6ee_45%,_#fff_80%)] px-4 py-12 text-slate-900 sm:px-8">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-8 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.35)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            ClassSense Realtime
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Authentication
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Sign in to host rooms. If you don&apos;t have an account, create one below.
          </p>
          <div className="mt-4">
            <Link
              href={nextPath === "/" ? "/" : nextPath}
              className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              Back
            </Link>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleSignIn}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
            <p className="mt-2 text-sm text-slate-600">Use your existing account.</p>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  required
                  minLength={8}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={isSigningIn}
              className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSigningIn ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <form
            onSubmit={handleSignUp}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold text-slate-900">Sign up</h2>
            <p className="mt-2 text-sm text-slate-600">Create a new account.</p>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  required
                  minLength={8}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={isSigningUp}
              className="mt-6 inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningUp ? "Creating account..." : "Create account"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
