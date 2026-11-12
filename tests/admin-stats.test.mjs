// Admin stats role-gate tests — TechShot.
//
// Covers the defense-in-depth half of the fix for audit run-1
// finding #11 (techshot:next-14.2.5-cve-2025-29927-middleware-bypass-admin-stats):
// getAdminStats() must check the caller's role itself and return
// empty stats for a non-staff caller, running NO service-role read,
// even if middleware is bypassed. A staff caller still gets the
// real totals from the service-role reads.
//
// These tests import the REAL modules (lib/admin/stats.ts,
// lib/auth-server/session.ts, lib/roles.ts, lib/supabase/server.ts)
// through the loader registered by tests/register-ts-loader.mjs
// (see package.json "test"); Node 24 strips the erasable
// TypeScript types, so the rules tested here are the exact rules
// the admin page runs — not a stub copy of them. The two Next.js
// runtime imports that cannot exist under plain Node are doubled
// by tests/admin-stats-hooks.mjs (see that file for why each
// double is faithful); the session read itself — cookies ->
// auth.getUser() -> profiles.role — runs for real against the
// loopback mock below.
//
// Supabase is a loopback mock (node:http) serving the same seeded
// totals as the audit's reproduction: 12 products, 3 orders
// (delivered / confirmed / cancelled), 1 paid payment — so staff
// stats must be { totalProducts: 12, totalOrders: 3, delivered: 1,
// notDelivered: 1, paid: 1, unpaid: 2, returned: 0 }. Every request
// to the mock is recorded, which is what proves "no service-role
// read" for a non-staff caller: not just the empty result, but
// zero requests carrying the service-role key.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./admin-stats-hooks.mjs", import.meta.url);

const { getAdminStats, EMPTY_ADMIN_STATS } = await import("../lib/admin/stats.ts");

const ANON_KEY = "test-anon-key";
const SERVICE_KEY = "test-service-role-key";
const ACCESS_TOKEN = "test-access-token";
const USER_ID = "user-1";

const EXPECTED_STAFF_STATS = {
  totalProducts: 12,
  totalOrders: 3,
  delivered: 1,
  notDelivered: 1,
  paid: 1,
  unpaid: 2,
  returned: 0,
};

const requests = [];
let mockBase = "";

/** Supabase session cookie, base64url-encoded like @supabase/ssr stores it. */
function sessionCookie() {
  const session = {
    access_token: ACCESS_TOKEN,
    refresh_token: "test-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: USER_ID, email: "admin@example.com", user_metadata: {}, app_metadata: {} },
  };
  const storageKey = `sb-${new URL(mockBase).hostname.split(".")[0]}-auth-token`;
  return {
    name: storageKey,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  };
}

/** Set the caller the mock will see, and clear the request log. */
function asCaller({ role = null, signedIn = false, authFails = false } = {}) {
  globalThis.__techshotTestProfileRole = role;
  globalThis.__techshotTestCookies = signedIn ? [sessionCookie()] : [];
  globalThis.__techshotTestAuthFails = authFails;
  requests.length = 0;
}

const serviceRoleRequests = () =>
  requests.filter((request) => request.apikey === SERVICE_KEY);

function sendJson(res, code, value, extraHeaders = {}) {
  res.writeHead(code, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(value));
}

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    requests.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization ?? null,
      apikey: req.headers.apikey ?? null,
    });
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/auth/v1/user") {
      if (globalThis.__techshotTestAuthFails) return sendJson(res, 500, { error: "mock auth down" });
      if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
        return sendJson(res, 401, { error: "bad token" });
      }
      return sendJson(res, 200, {
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "admin@example.com",
        email_confirmed_at: "2025-01-01T00:00:00Z",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        user_metadata: {},
        app_metadata: {},
      });
    }
    if (url.pathname === "/rest/v1/profiles") {
      // maybeSingle(): a single object, not an array.
      return sendJson(res, 200, {
        id: USER_ID,
        role: globalThis.__techshotTestProfileRole,
        display_name: "Test User",
      });
    }
    if (url.pathname === "/rest/v1/products" && req.method === "HEAD") {
      res.writeHead(200, { "content-range": "0-11/12" });
      return res.end();
    }
    if (url.pathname === "/rest/v1/orders") {
      return sendJson(res, 200, [
        { id: "o1", status: "delivered" },
        { id: "o2", status: "confirmed" },
        { id: "o3", status: "cancelled" },
      ]);
    }
    if (url.pathname === "/rest/v1/payments") {
      return sendJson(res, 200, [{ order_id: "o1" }]);
    }
    return sendJson(res, 404, { error: `not mocked: ${req.method} ${url.pathname}` });
  });
});

const savedEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

before(async () => {
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = mockBase;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});

after(async () => {
  await new Promise((resolve) => mock.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// The gate: non-staff callers get empty stats and no service-role read
// ---------------------------------------------------------------------------

test("anonymous caller gets empty stats and makes no requests at all", async () => {
  asCaller();
  const stats = await getAdminStats();
  assert.deepEqual(stats, EMPTY_ADMIN_STATS);
  assert.notEqual(stats, EMPTY_ADMIN_STATS, "a fresh copy, not the shared constant");
  assert.equal(requests.length, 0, `expected zero Supabase requests, saw: ${JSON.stringify(requests)}`);
});

test("signed-in customer gets empty stats and no service-role read", async () => {
  asCaller({ role: "customer", signedIn: true });
  const stats = await getAdminStats();
  assert.deepEqual(stats, EMPTY_ADMIN_STATS);
  // The role read itself (auth + profiles, anon key) still runs;
  // the three service-role reads must not.
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url.split("?")[0]}`),
    ["GET /auth/v1/user", "GET /rest/v1/profiles"],
  );
  assert.equal(serviceRoleRequests().length, 0);
});

test("legacy seller role is treated as non-staff: empty stats, no service-role read", async () => {
  asCaller({ role: "seller", signedIn: true });
  const stats = await getAdminStats();
  assert.deepEqual(stats, EMPTY_ADMIN_STATS);
  assert.equal(serviceRoleRequests().length, 0);
});

test("unknown role is treated as non-staff: empty stats, no service-role read", async () => {
  asCaller({ role: "superadmin", signedIn: true });
  const stats = await getAdminStats();
  assert.deepEqual(stats, EMPTY_ADMIN_STATS);
  assert.equal(serviceRoleRequests().length, 0);
});

test("when the session read fails, the caller gets empty stats and no service-role read", async () => {
  asCaller({ role: "admin", signedIn: true, authFails: true });
  const stats = await getAdminStats();
  assert.deepEqual(stats, EMPTY_ADMIN_STATS);
  assert.equal(requests.length, 1, "only the failed auth read runs");
  assert.equal(serviceRoleRequests().length, 0);
});

test("when Supabase is not configured, the caller gets empty stats and never throws", async () => {
  const empty = { ...EMPTY_ADMIN_STATS };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    asCaller();
    assert.deepEqual(await getAdminStats(), empty);
    assert.equal(requests.length, 0);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = mockBase;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  }
});

// ---------------------------------------------------------------------------
// Staff callers still get the real totals
// ---------------------------------------------------------------------------

test("staff admin gets the real totals from the three service-role reads", async () => {
  asCaller({ role: "admin", signedIn: true });
  const stats = await getAdminStats();
  assert.deepEqual(stats, EXPECTED_STAFF_STATS);
  assert.deepEqual(
    serviceRoleRequests().map((request) => `${request.method} ${request.url.split("?")[0]}`),
    ["HEAD /rest/v1/products", "GET /rest/v1/orders", "GET /rest/v1/payments"],
  );
  for (const request of serviceRoleRequests()) {
    assert.equal(request.auth, `Bearer ${SERVICE_KEY}`, "service-role reads use the service key");
  }
  // The role read uses the anon key, never the service key.
  const profileRequest = requests.find((request) => request.url.startsWith("/rest/v1/profiles"));
  assert.equal(profileRequest.apikey, ANON_KEY);
});

test("manager and co_admin are staff too: real totals, not zeros", async () => {
  for (const role of ["manager", "co_admin"]) {
    asCaller({ role, signedIn: true });
    assert.deepEqual(await getAdminStats(), EXPECTED_STAFF_STATS, `role ${role}`);
    assert.equal(serviceRoleRequests().length, 3, `role ${role} runs the three reads`);
  }
});

// ---------------------------------------------------------------------------
// Wiring: the gate is written the way the audit record prescribes
// ---------------------------------------------------------------------------

test("stats.ts gates on getCallerRole + isStaff before any service-role read", () => {
  const source = readFileSync(new URL("../lib/admin/stats.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ getCallerRole \} from "@\/lib\/auth-server\/session";/);
  assert.match(source, /import \{ isStaff \} from "@\/lib\/roles";/);
  assert.match(source, /const role = await getCallerRole\(\)\.catch\(\(\) => null\);/);
  assert.match(source, /if \(!isStaff\(role\)\) return \{ \.\.\.EMPTY_ADMIN_STATS \};/);
  const gateAt = source.indexOf("if (!isStaff(role))");
  const clientAt = source.indexOf("createAdminClient()");
  assert.ok(gateAt !== -1 && clientAt !== -1 && gateAt < clientAt, "gate precedes createAdminClient()");
});

test("EMPTY_ADMIN_STATS has all seven figures, all zero", () => {
  assert.deepEqual(EMPTY_ADMIN_STATS, {
    totalProducts: 0,
    totalOrders: 0,
    delivered: 0,
    notDelivered: 0,
    paid: 0,
    unpaid: 0,
    returned: 0,
  });
});

// ---------------------------------------------------------------------------
// The upgrade: Next.js 14.2.25 exactly, nothing else moved
// ---------------------------------------------------------------------------

test("package.json pins next 14.2.25 exactly; eslint-config-next stays 14.2.5", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies.next, "14.2.25");
  assert.equal(pkg.devDependencies["eslint-config-next"], "14.2.5");
});

test("package-lock.json records next 14.2.25 with its tarball and integrity", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.packages[""].dependencies.next, "14.2.25");
  const entry = lock.packages["node_modules/next"];
  assert.equal(entry.version, "14.2.25");
  assert.equal(entry.resolved, "https://registry.npmjs.org/next/-/next-14.2.25.tgz");
  assert.match(entry.integrity, /^sha512-/);
});
