import { type NextRequest, NextResponse } from "next/server";

/** Cheap gate: protected areas need a session cookie. The real check (revocation, expiry, membership, role) happens on the server. */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("sid")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/app/:path*", "/platform/:path*", "/workspaces", "/api/files/:path*", "/api/export/:path*", "/api/export-tenant"] };
