import { NextResponse, type NextRequest } from "next/server";
/** Defence in depth: anonymous requests never reach protected pages (each page still authorises on the server). */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("sid")) {
    const url = req.nextUrl.clone(); url.pathname = "/login"; url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/app/:path*", "/admin/:path*", "/portal/:path*", "/workspaces"] };
