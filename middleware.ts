// Next.js middleware.
//
// LIMITATION, BY DESIGN: this middleware is a pass-through. It does not
// enforce authentication on /seller or /admin, because the demo auth
// session lives in localStorage (lib/auth, key techshot-auth-v1), which
// middleware cannot read — middleware only sees cookies. A fake auth
// check here (for example, redirecting when no cookie exists) would
// lock every demo user out of the seller and admin pages, since the
// demo never sets an auth cookie.
//
// The seller and admin pages therefore enforce access themselves, in the
// browser, with useAuth: unsigned users are redirected to /auth/sign-in,
// and the admin page refuses non-admin users. That is correct for the
// demo, and it is not a security boundary — demo data is local to the
// browser. When Supabase Auth is connected, this file must be replaced
// with a real check: read the Supabase session from the request cookies
// (via @supabase/ssr) and redirect /seller and /admin to /auth/sign-in
// when there is no session, with role checks enforced by Row Level
// Security in the database.
//
// Security headers live in next.config.mjs, not here.
import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/seller/:path*", "/admin/:path*"],
};
