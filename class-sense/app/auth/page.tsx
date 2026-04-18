import { Suspense } from "react";
import { AuthPageClient } from "@/app/auth/page-client";

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#e2f4ff_0%,_#fef6ee_45%,_#fff_80%)] px-4 text-slate-700">
          Loading...
        </div>
      }
    >
      <AuthPageClient />
    </Suspense>
  );
}
