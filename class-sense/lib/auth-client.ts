import { createAuthClient } from "better-auth/react";

const betterAuthBaseURL =
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ??
  (typeof window !== "undefined" ? window.location.origin : undefined);

export const authClient = createAuthClient({
  ...(betterAuthBaseURL ? { baseURL: betterAuthBaseURL } : {}),
});

export const { useSession, signIn, signOut, signUp } = authClient;
