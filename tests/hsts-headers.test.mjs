// HSTS header tests — TechShot.
//
// Audit NV 13 (run-1): next.config.mjs set four security headers but
// no Strict-Transport-Security. The header is now set explicitly in
// headers() (see next.config.mjs) with the same value Vercel itself
// sends for *.vercel.app — max-age=63072000; includeSubDomains;
// preload — so the app does not rely on the platform edge to add it,
// and a custom domain later gets the same value.
//
// What is proven here: the header is present on /:path* with exactly
// that value, and the four pre-existing headers are unchanged.
// What is NOT proven here: what the live edge actually returns —
// Vercel also sends HSTS on *.vercel.app by default, so confirm with
// `curl -I https://techshotbd.vercel.app` after deploy.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import nextConfig from "../next.config.mjs";

const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

async function headersForPath() {
  const routes = await nextConfig.headers();
  assert.equal(Array.isArray(routes), true, "headers() returns a route list");
  const root = routes.find((route) => route.source === "/:path*");
  assert.ok(root, "headers() covers /:path*");
  return root.headers;
}

test("NV 13: Strict-Transport-Security is set on every path", async () => {
  const headers = await headersForPath();
  const hsts = headers.find(
    (header) => header.key.toLowerCase() === "strict-transport-security",
  );
  assert.ok(hsts, "Strict-Transport-Security header is present");
  assert.equal(hsts.value, HSTS_VALUE, `HSTS value is ${HSTS_VALUE}`);
});

test("NV 13: the four pre-existing security headers are unchanged", async () => {
  const headers = await headersForPath();
  const byKey = new Map(
    headers.map((header) => [header.key.toLowerCase(), header.value]),
  );
  assert.equal(byKey.get("x-content-type-options"), "nosniff");
  assert.equal(byKey.get("x-frame-options"), "DENY");
  assert.equal(
    byKey.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.match(
    byKey.get("content-security-policy") ?? "",
    /^default-src 'self';/,
    "CSP still starts with default-src 'self'",
  );
  // Exactly five headers: the four old ones plus HSTS, nothing else added.
  assert.equal(headers.length, 5, "header list is exactly the four old ones + HSTS");
});
