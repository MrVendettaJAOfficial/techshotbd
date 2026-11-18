// Admin read-helper role gates — TechShot.
//
// Covers the in-function gates for audit run-1 low
// techshot/admin-reads-no-in-function-gate (getAdminStats,
// fetchAllProducts, fetchAdminUsers open the service-role client
// with no caller check, so the /admin middleware is the only gate
// on draft/paused catalogue, store stats and the full profiles
// list):
//
//   - fetchAllProducts (lib/products/queries.ts) now requires any
//     staff role (admin / co_admin / manager), re-read from the
//     database on every call with getCallerRole(), and returns
//     empty lists with NO service-role read for anyone else.
//   - fetchAdminUsers (lib/products/queries.ts) is owner-only
//     (role "admin"), like listUsers in
//     lib/auth-server/admin-users.ts: a co-admin or manager gets
//     an empty list with no service-role read at all.
//   - getAdminStats (lib/admin/stats.ts) was already gated by the
//     14-medium batch - its behaviour is pinned by
//     tests/admin-stats.test.mjs, and this file pins the gate in
//     source so a later edit cannot silently drop it.
//   - listUsers (lib/auth-server/admin-users.ts) was already
//     owner-only - this file pins that gate in source too. (The
//     audit record names the users list "fetchAdminUsers in
//     lib/auth-server/admin-users.ts"; that file's users list is
//     listUsers - fetchAdminUsers lives in lib/products/queries.ts
//     and is gated here.)
//
// These tests import the REAL modules (lib/products/queries.ts,
// lib/auth-server/session.ts, lib/roles.ts, lib/supabase/server.ts)
// through the loader registered by tests/register-ts-loader.mjs
// (see package.json "test"); Node 24 strips the erasable
// TypeScript types, so the rules tested here are the exact rules
// the admin page runs - not a stub copy of them. The two Next.js
// runtime imports that cannot exist under plain Node are doubled
// by tests/admin-stats-hooks.mjs (shared with
// tests/admin-stats.test.mjs); the session read itself - cookies
// -> auth.getUser() -> profiles.role - runs for real against the
// loopback mock below.
//
// Supabase is a loopback mock (node:http) serving the same shape
// as the audit's reproduction: 2 fixture products (one active,
// one draft), 1 active category, 2 fixture profiles - so a staff
// fetchAllProducts must return both products (draft included)
// and an owner fetchAdminUsers must return both users. Every
// request to the mock is recorded, which is what proves "no
// service-role read" for a caller without the right role: not just
// the empty result, but zero requests carrying the service-role key.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./admin-stats-hooks.mjs", import.meta.url);

const { fetchAllProducts, fetchAdminUsers } = await import("../lib/products/queries.ts");

const ANON_KEY = "test-anon-key";
const SERVICE_KEY = "test-service-role-key";
const ACCESS_TOKEN = "test-access-token";
const USER_ID = "user-1";

const EMPTY_PRODUCTS = { products: [], categories: [], configured: false };
const EMPTY_USERS = { users: [], configured: false };

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
function asCaller({ role = null, signedIn = false } = {}) {
  globalThis.__techshotTestProfileRole = role;
  globalThis.__techshotTestCookies = signedIn ? [sessionCookie()] : [];
  requests.length = 0;
}

const serviceRoleRequests = () =>
  requests.filter((request) => request.apikey === SERVICE_KEY);

function sendJson(res, code, value) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function productRow(id, title, slug, status) {
  return {
    id,
    seller_id: null,
    category_id: "cat-1",
    title,
    slug,
    description: `${title} description`,
    price_poisha: 11990000,
    compare_at_poisha: null,
    stock: 5,
    status,
    warranty: null,
    specifications: [],
    created_at: "2026-11-01T00:00:00Z",
  };
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
      accept: req.headers.accept ?? null,
    });
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/auth/v1/user") {
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
      // The role read (maybeSingle) filters by the caller's id and
      // wants one row; the users list asks for the whole table
      // ordered by created_at. (supabase-js sends Accept: */* for
      // both, so the query - not the header - tells them apart.)
      if (url.searchParams.has("id")) {
        return sendJson(res, 200, {
          id: USER_ID,
          role: globalThis.__techshotTestProfileRole,
          display_name: "Test User",
        });
      }
      return sendJson(res, 200, [
        { id: "user-1", display_name: "Owner", role: "admin", created_at: "2026-11-01T00:00:00Z" },
        { id: "user-2", display_name: "Shopper", role: "customer", created_at: "2026-11-02T00:00:00Z" },
      ]);
    }
    if (url.pathname === "/rest/v1/products") {
      return sendJson(res, 200, [
        productRow("prod-1", "Apple iPhone 16 Pro", "apple-iphone-16-pro", "active"),
        productRow("prod-2", "Draft Headphones", "draft-headphones", "draft"),
      ]);
    }
    if (url.pathname === "/rest/v1/categories") {
      return sendJson(res, 200, [
        { id: "cat-1", slug: "electronics", name: "Electronics", is_active: true },
        { id: "cat-2", slug: "archived", name: "Archived", is_active: false },
      ]);
    }
    if (
      url.pathname === "/rest/v1/product_images" ||
      url.pathname === "/rest/v1/product_variants" ||
      url.pathname === "/rest/v1/product_categories"
    ) {
      return sendJson(res, 200, []);
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

function readSource(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// fetchAllProducts: staff only, no service-role read for anyone else
// ---------------------------------------------------------------------------

test("anonymous caller gets empty products and makes no requests at all", async () => {
  asCaller();
  assert.deepEqual(await fetchAllProducts(), EMPTY_PRODUCTS);
  assert.equal(requests.length, 0, `expected zero Supabase requests, saw: ${JSON.stringify(requests)}`);
});

test("signed-in customer gets empty products and no service-role read", async () => {
  asCaller({ role: "customer", signedIn: true });
  assert.deepEqual(await fetchAllProducts(), EMPTY_PRODUCTS);
  // The role read itself (auth + profiles, anon key) still runs;
  // the service-role catalogue reads must not.
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url.split("?")[0]}`),
    ["GET /auth/v1/user", "GET /rest/v1/profiles"],
  );
  assert.equal(serviceRoleRequests().length, 0);
});

test("legacy seller role is treated as non-staff for the catalogue", async () => {
  asCaller({ role: "seller", signedIn: true });
  assert.deepEqual(await fetchAllProducts(), EMPTY_PRODUCTS);
  assert.equal(serviceRoleRequests().length, 0);
});

test("staff admin gets every product, draft included, from the service-role reads", async () => {
  asCaller({ role: "admin", signedIn: true });
  const result = await fetchAllProducts();
  assert.equal(result.configured, true);
  assert.deepEqual(
    result.products.map((product) => `${product.slug}:${product.status}`),
    ["apple-iphone-16-pro:active", "draft-headphones:draft"],
  );
  assert.deepEqual(result.categories, [{ slug: "electronics", name: "Electronics" }]);
  assert.ok(
    serviceRoleRequests().some((request) => request.url.startsWith("/rest/v1/products")),
    "the products read uses the service key",
  );
  const profileRequest = requests.find((request) => request.url.startsWith("/rest/v1/profiles"));
  assert.equal(profileRequest.apikey, ANON_KEY, "the role read uses the anon key, never the service key");
});

test("manager and co_admin are staff too: full catalogue, draft included", async () => {
  for (const role of ["manager", "co_admin"]) {
    asCaller({ role, signedIn: true });
    const result = await fetchAllProducts();
    assert.equal(result.products.length, 2, `role ${role}`);
    assert.equal(result.configured, true, `role ${role}`);
    assert.ok(serviceRoleRequests().length > 0, `role ${role} runs service-role reads`);
  }
});

// ---------------------------------------------------------------------------
// fetchAdminUsers: owner only - staff who are not the owner get nothing
// ---------------------------------------------------------------------------

test("anonymous caller gets an empty users list and makes no requests at all", async () => {
  asCaller();
  assert.deepEqual(await fetchAdminUsers(), EMPTY_USERS);
  assert.equal(requests.length, 0, `expected zero Supabase requests, saw: ${JSON.stringify(requests)}`);
});

test("signed-in customer gets an empty users list and no service-role read", async () => {
  asCaller({ role: "customer", signedIn: true });
  assert.deepEqual(await fetchAdminUsers(), EMPTY_USERS);
  assert.equal(serviceRoleRequests().length, 0);
});

test("manager and co_admin get an empty users list: the list is owner-only", async () => {
  for (const role of ["manager", "co_admin"]) {
    asCaller({ role, signedIn: true });
    assert.deepEqual(await fetchAdminUsers(), EMPTY_USERS, `role ${role}`);
    assert.equal(serviceRoleRequests().length, 0, `role ${role} runs no service-role read`);
  }
});

test("owner admin gets the full users list from the service-role read", async () => {
  asCaller({ role: "admin", signedIn: true });
  const result = await fetchAdminUsers();
  assert.equal(result.configured, true);
  assert.deepEqual(
    result.users.map((user) => `${user.displayName}:${user.role}`),
    ["Owner:admin", "Shopper:customer"],
  );
  assert.ok(
    serviceRoleRequests().some((request) => request.url.startsWith("/rest/v1/profiles")),
    "the profiles list read uses the service key",
  );
});

// ---------------------------------------------------------------------------
// Wiring: the gates are written the way the audit record prescribes,
// and the two already-gated helpers stay gated
// ---------------------------------------------------------------------------

test("queries.ts gates fetchAllProducts on getCallerRole + isStaff before any service-role read", () => {
  const source = readSource("lib/products/queries.ts");
  assert.match(source, /import \{ getCallerRole \} from "@\/lib\/auth-server\/session";/);
  assert.match(source, /import \{ isOwner, isStaff \} from "@\/lib\/roles";/);
  const gateAt = source.indexOf("if (!isStaff(role)) return empty;");
  const clientAt = source.indexOf("createAdminClient()", source.indexOf("fetchAllProducts"));
  assert.ok(gateAt !== -1 && clientAt !== -1 && gateAt < clientAt, "gate precedes createAdminClient()");
});

test("queries.ts gates fetchAdminUsers on getCallerRole + isOwner before any service-role read", () => {
  const source = readSource("lib/products/queries.ts");
  const gateAt = source.indexOf('if (!isOwner(role)) return { users: [], configured: false };');
  const clientAt = source.indexOf("createAdminClient()", source.indexOf("fetchAdminUsers"));
  assert.ok(gateAt !== -1 && clientAt !== -1 && gateAt < clientAt, "gate precedes createAdminClient()");
});

test("getAdminStats stays gated on getCallerRole + isStaff (14-medium batch; behaviour pinned by admin-stats.test.mjs)", () => {
  const source = readSource("lib/admin/stats.ts");
  assert.match(source, /const role = await getCallerRole\(\)\.catch\(\(\) => null\);/);
  const gateAt = source.indexOf("if (!isStaff(role)) return { ...EMPTY_ADMIN_STATS };");
  const clientAt = source.indexOf("createAdminClient()");
  assert.ok(gateAt !== -1 && clientAt !== -1 && gateAt < clientAt, "gate precedes createAdminClient()");
});

test("listUsers in admin-users.ts stays owner-only: non-admin throws before any service-role read", () => {
  const source = readSource("lib/auth-server/admin-users.ts");
  const listUsersAt = source.indexOf("export async function listUsers()");
  assert.ok(listUsersAt !== -1, "listUsers exists");
  const body = source.slice(listUsersAt);
  assert.match(body, /if \(profile\?\.role !== "admin"\) \{\s*throw new Error\("Not allowed\."\);\s*\}/);
  const throwAt = body.indexOf('throw new Error("Not allowed.")');
  const clientAt = body.indexOf("createAdminClient()");
  assert.ok(throwAt !== -1 && clientAt !== -1 && throwAt < clientAt, "owner check precedes createAdminClient()");
});
