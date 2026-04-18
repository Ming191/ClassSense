import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(getSessionCookie(request.headers));
}

export async function proxy(request: NextRequest) {
  const isAuthenticated = hasSessionCookie(request);
  const pathname = request.nextUrl.pathname;

  if (pathname === "/api/rooms" && request.method === "POST" && !isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (pathname === "/auth" && isAuthenticated) {
    const nextPath = request.nextUrl.searchParams.get("next");
    const redirectPath =
      nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
        ? nextPath
        : "/";

    return NextResponse.redirect(new URL(redirectPath, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/auth", "/api/rooms"],
};
