import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { HOME_BY_ROLE, isPublicPath, isRole, resolveDestination } from "@/lib/rules/routing";

/**
 * Runs on every request (including client-side navigations):
 *  1. refreshes the Supabase session cookie;
 *  2. sends signed-out users to /login;
 *  3. sends signed-in users to their role's home if they ask for a screen
 *     their role cannot open (lib/rules/routing). RLS still guards the data.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const path = request.nextUrl.pathname;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    const [pathname, search] = to.split("?");
    url.pathname = pathname ?? "/";
    url.search = search ? `?${search}` : "";
    const res = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) res.cookies.set(c);
    return res;
  };

  if (!user) {
    if (isPublicPath(path)) return response;
    return redirect(`/login?next=${encodeURIComponent(path + request.nextUrl.search)}`);
  }

  const { data: profile } = await supabase.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!profile || !profile.active || !isRole(profile.role)) {
    // Signed in but not provisioned (or deactivated): only the login page and its message.
    if (path === "/login") return response;
    return redirect("/login?error=no-access");
  }

  if (path === "/login") return redirect(HOME_BY_ROLE[profile.role]);
  const destination = resolveDestination(profile.role, path);
  if (destination !== path) return redirect(destination);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
