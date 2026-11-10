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

// Product photos live in the public `product-images` bucket in
// Supabase Storage (see lib/storage-images.ts), so the configured
// Supabase origin must be allowed to serve images too — both by
// next/image (remotePatterns) and by the Content-Security-Policy
// (img-src). The default allows the hosted *.supabase.co origins; a
// non-supabase.co origin (the local mock Supabase, a self-hosted
// instance) is added exactly, the same way as connect-src. Without
// this, remote product photos are rejected and every card falls back
// to its solid-colour initial.
/** @type {Array<{ protocol: string; hostname: string }>} */
const remotePatterns = [];
try {
  const parsed = new URL(supabaseUrl);
  remotePatterns.push({
    protocol: parsed.protocol.replace(/:$/, "") || "https",
    hostname: parsed.hostname,
  });
} catch {
  // Unconfigured or invalid URL: no remote images; local photos only.
}
const imgSrc = ["'self'", "data:", "blob:", "https://*.supabase.co", supabaseOrigin]
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
  // Client router cache for STATIC pages: 30 seconds, not the 300s
  // default. The home page is static (see app/page.tsx), so without
  // this a shopper already browsing could keep seeing the previous
  // home page for up to five minutes after an admin edit when
  // navigating client-side — the server would already be fresh
  // (on-demand revalidation), but their browser would reuse its
  // cached copy. 30 seconds keeps that window short while the
  // prefetched copy still serves repeat taps. Full loads are always
  // fresh regardless. The re-fetched payloads are pre-rendered, so
  // they cost no function run and no database read — only dynamic
  // pages (shop, product, admin) re-render on the server.
  experimental: {
    staleTimes: {
      static: 30,
    },
  },
  images: {
    remotePatterns,
    formats: ["image/avif", "image/webp"],
    // Optimised images are cached for a day instead of the 60-second
    // default. The default meant every product photo was re-optimised
    // from scratch (1.4–2.5s per real photo with squoosh, the
    // built-in optimiser) on the first visit after a minute of
    // quiet — nine cards on /shop is 13–22s of optimisation work on
    // a cold cache. The cache key is the image URL, so a photo
    // re-uploaded under the SAME Storage filename takes up to a day
    // to show the new optimised image; uploading under a new
    // filename (or editing the product's image) busts it immediately.
    minimumCacheTTL: 86400,
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
              `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src ${imgSrc}; font-src 'self'; connect-src ${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
