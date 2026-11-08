/** @type {import('next').NextConfig} */

// The browser talks to Supabase directly (Auth + PostgREST), so the
// configured Supabase origin must be allowed by connect-src. The
// default allows the hosted *.supabase.co origins; when the app is
// pointed at another origin — the local mock Supabase on
// http://127.0.0.1:3101, or a self-hosted instance — exactly that
// origin is added, and nothing else. With a *.supabase.co URL (the
// production case) the header is unchanged. Without this, sign-in
// against any non-supabase.co origin fails in the browser with a CSP
// violation and the user only sees "Sign-in failed. Please try
// again." — the server-side calls are unaffected, which makes the
// failure hard to spot.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let supabaseOrigin = "";
try {
  const parsed = new URL(supabaseUrl);
  if (!/\.supabase\.co$/.test(parsed.hostname)) {
    supabaseOrigin = parsed.origin;
  }
} catch {
  // Unconfigured or invalid URL: no extra origin.
}
const connectSrc = ["'self'", "https://*.supabase.co", "wss://*.supabase.co", supabaseOrigin]
  .filter(Boolean)
  .join(" ");

// Development only: Next.js dev mode evaluates modules with eval
// (webpack devtool), which the production CSP below blocks — with
// 'unsafe-eval' missing, every page throws EvalError and client-side
// JavaScript (including the sign-in form) silently stops working in
// `npm run dev`. Production builds never use eval, so the production
// header stays strict. Never enable this outside development.
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";

const nextConfig = {
  images: {
    remotePatterns: [],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
