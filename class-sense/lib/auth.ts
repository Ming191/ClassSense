import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

const betterAuthBaseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ??
  "http://localhost:3000";

const betterAuthSecret =
  process.env.BETTER_AUTH_SECRET ??
  process.env.AUTH_SECRET ??
  "classsense-local-auth-secret-change-me";

export const auth = betterAuth({
  baseURL: betterAuthBaseURL,
  secret: betterAuthSecret,
  trustedOrigins: ["http://localhost:3000", "http://localhost:3100"],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    modelName: "User",
    fields: {
      name: "displayName",
      image: "avatarUrl",
    },
  },
  session: {
    modelName: "Session",
  },
  account: {
    modelName: "Account",
  },
  verification: {
    modelName: "Verification",
  },
  plugins: [nextCookies()],
});
