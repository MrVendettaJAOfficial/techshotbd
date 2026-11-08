// Next.js middleware — Supabase Auth guard for /admin.
//
// Reads the Supabase session from the request cookies (via
// @supabase/ssr) and refreshes it, then:
//   - no session on /admin/*  -> redirect to /auth/sign-in
//   - signed in but not an admin on /admin/* -> redirect to /
// The admin role check reads the caller's `profiles` row with the
// request-scoped client (RLS allows a user to read their own row).
// Page-level checks in the admin page still apply; this is the
// server-side gate, and Row Level Security is the real boundary
// for data. There is no /seller route any more (single-seller store:
// the owner manages products in /admin), so it is not guarded here
// and requests to it fall through to the 404 page.
//
// UNCONFIGURED MODE: when the Supabase env vars are missing, this
// middleware falls back to NextResponse.next() and locks nobody out —
// the site keeps working in its local/fallback mode. Do not "fix" that
// by redirecting here; the fallback is deliberate.
//
// Security headers live in next.config.mjs, not here.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured: pass through (see header note).
  if (!url || !anonKey) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refreshes the session (and validates it) — getUser() revalidates
  // the token against Supabase Auth instead of trusting the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/auth/sign-in";
    signInUrl.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(signInUrl);
    // Carry any refreshed session cookies onto the redirect response.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return redirect;
  }

  if (pathname.startsWith("/admin")) {
    const { data: profile } = (await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()) as { data: { role: string } | null };
    if (profile?.role !== "admin") {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.search = "";
      const redirect = NextResponse.redirect(homeUrl);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirect.cookies.set(cookie.name, cookie.value);
      });
      return redirect;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/admin/:path*"],
};
