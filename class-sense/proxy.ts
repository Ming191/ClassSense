import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(getSessionCookie(request.headers));
}

export async function proxy(request: NextRequest) {
  const isAuthenticated = hasSessionCookie(request);
  const pathname = request.nextUrl.pathname;
  const isSessionCreateRequest = pathname === "/api/sessions" && request.method === "POST";
  const isSessionEndRequest = /^\/api\/sessions\/[^/]+$/.test(pathname) && request.method === "DELETE";

  if ((isSessionCreateRequest || isSessionEndRequest) && !isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/sessions", "/api/sessions/:path*"],
};
