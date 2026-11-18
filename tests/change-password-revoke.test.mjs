// Change-password session revocation — TechShot.
//
// Covers needs-validation item 11
// (techshot:auth:change-password-other-sessions-not-revoked):
// changePassword used to end at supabase.auth.updateUser with no
// session revocation, so sessions on other devices - or a stolen
// session - survived a password change. The fix calls
// supabase.auth.signOut({ scope: "others" }) after a successful
// updateUser: every session except this one is revoked server-side,
// and the user stays signed in on this device. (Installed
// @supabase/auth-js supports "others" - SIGN_OUT_SCOPES is
// ["global", "local", "others"] - and its _signOut only removes the
// current session locally for scope "global", so "others" keeps
// this session. The bare signOut() default is "global" and would
// have signed this device out too.)
//
// These tests import the REAL lib/auth.ts changePassword through
// the loader registered by tests/register-ts-loader.mjs (see
// package.json "test"); Node 24 strips the erasable TypeScript
// types, so the revocation tested here is the exact call the
// account security section runs. The browser client runs for real
// against a loopback mock GoTrue endpoint below (no live Supabase,
// dummy keys only): the mock serves the re-authentication
// sign-in, the password update, and the logout endpoint, and
// records every request - which is what proves the revocation
// happens, with scope "others", after the update and only on
// success. The next/headers and react imports that cannot exist
// under plain Node are doubled by tests/auth-hooks.mjs.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./auth-hooks.mjs", import.meta.url);

// A Supabase client created in a browser environment opens a
// BroadcastChannel for cross-tab session sync, and Node's
// BroadcastChannel keeps the test child process alive until it is
// closed - the clients these tests create are never closed, so the
// file would pass every test and then never settle ("Promise
// resolution is still pending but the event loop has already
// resolved"). These tests never need cross-tab sync, so the
// channel is removed from the test environment before any client
// is created. (Verified: with it present the success path hangs
// the file; without it the file exits cleanly.)
globalThis.BroadcastChannel = undefined;

// @supabase/ssr treats a window as a browser only when it has a
// document too, and its cookie storage reads the bare global
// `document.cookie` (not window.document); the client stores its
// session in localStorage.
const fakeStore = new Map();
globalThis.document = { cookie: "" };
globalThis.window = {
  document: globalThis.document,
  location: { origin: "http://127.0.0.1" },
  localStorage: {
    getItem: (key) => (fakeStore.has(key) ? fakeStore.get(key) : null),
    setItem: (key, value) => fakeStore.set(key, String(value)),
    removeItem: (key) => fakeStore.delete(key),
    clear: () => fakeStore.clear(),
  },
};

const { changePassword } = await import("../lib/auth.ts");
const { createClient } = await import("../lib/supabase/client.ts");

const ANON_KEY = "test-anon-key";
const SERVICE_KEY = "test-service-role-key";
const ACCESS_TOKEN = "seed-access-token";
const NEW_ACCESS_TOKEN = "reauth-access-token";
const USER_ID = "user-1";
const USER_EMAIL = "user@example.com";
const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "new-password-123";

let mockBase = "";
const requests = [];
let mode = "ok";

/** Storage key the browser client uses for this mock origin. */
function storageKey() {
  return `sb-${new URL(mockBase).hostname.split(".")[0]}-auth-token`;
}

/**
 * Seed the session changePassword starts from. The browser client
 * stores its session in a COOKIE (not localStorage - @supabase/ssr's
 * browser client uses cookie storage), in the same base64- encoding
 * the server client reads in tests/admin-stats.test.mjs, so the
 * seed goes in document.cookie. localStorage stays only for the
 * PKCE verifier the client may write during sign-in.
 */
function seedSession() {
  const session = {
    access_token: ACCESS_TOKEN,
    refresh_token: "seed-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: USER_ID,
      email: USER_EMAIL,
      user_metadata: {},
      app_metadata: {},
    },
  };
  globalThis.document.cookie = `${storageKey()}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function userJson() {
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: USER_EMAIL,
    email_confirmed_at: "2025-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    user_metadata: {},
    app_metadata: {},
  };
}

function sendJson(res, code, value) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "http://127.0.0.1");
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      parsed = {};
    }
    requests.push({
      method: req.method,
      path: url.pathname,
      scope: url.searchParams.get("scope"),
      auth: req.headers.authorization ?? null,
      passwordInBody: typeof parsed.password === "string",
    });
    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      if (
        req.headers.authorization !== `Bearer ${ACCESS_TOKEN}` &&
        req.headers.authorization !== `Bearer ${NEW_ACCESS_TOKEN}`
      ) {
        return sendJson(res, 401, { error: "bad token" });
      }
      return sendJson(res, 200, userJson());
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/token") {
      if (url.searchParams.get("grant_type") !== "password") {
        return sendJson(res, 400, { msg: "unsupported grant type", message: "unsupported grant type" });
      }
      if (mode === "bad-password" || parsed.password !== OLD_PASSWORD) {
        return sendJson(res, 400, { msg: "Invalid login credentials", message: "Invalid login credentials" });
      }
      return sendJson(res, 200, {
        access_token: NEW_ACCESS_TOKEN,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "new-refresh-token",
        user: userJson(),
      });
    }
    if (req.method === "PUT" && url.pathname === "/auth/v1/user") {
      if (mode === "update-fails") {
        return sendJson(res, 400, {
          msg: "New password should be different from the old password.",
          message: "New password should be different from the old password.",
        });
      }
      return sendJson(res, 200, userJson());
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
      res.writeHead(204);
      return res.end();
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

beforeEach(() => {
  mode = "ok";
  requests.length = 0;
  fakeStore.clear();
  globalThis.document.cookie = "";
  seedSession();
});

after(async () => {
  await new Promise((resolve) => mock.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const logoutRequests = () => requests.filter((request) => request.path === "/auth/v1/logout");
const updateRequests = () => requests.filter((request) => request.path === "/auth/v1/user" && request.method === "PUT");

// ---------------------------------------------------------------------------
// The fix: a successful change revokes other sessions and keeps this one
// ---------------------------------------------------------------------------

test("successful password change revokes other sessions with scope 'others', after the update", async () => {
  await changePassword({
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(updateRequests().length, 1, "the password update runs once");
  assert.equal(updateRequests()[0].passwordInBody, true, "the update carries the new password");
  assert.equal(logoutRequests().length, 1, "exactly one revocation runs");
  assert.equal(logoutRequests()[0].scope, "others", "the revocation scope is 'others', not 'global'");
  assert.equal(
    logoutRequests()[0].auth,
    `Bearer ${NEW_ACCESS_TOKEN}`,
    "the revocation is authenticated with the current session",
  );
  const updateAt = requests.indexOf(updateRequests()[0]);
  const logoutAt = requests.indexOf(logoutRequests()[0]);
  assert.ok(updateAt !== -1 && logoutAt !== -1 && updateAt < logoutAt, "revocation runs after the update");
});

test("the current session survives: a fresh client still has it after the change", async () => {
  await changePassword({
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  const fresh = createClient();
  const { data } = await fresh.auth.getSession();
  assert.ok(data.session, "this device is still signed in after its own password change");
  assert.equal(data.session.access_token, NEW_ACCESS_TOKEN);
  assert.equal(data.session.user.email, USER_EMAIL);
});

// ---------------------------------------------------------------------------
// Revocation runs only after a successful change
// ---------------------------------------------------------------------------

test("wrong current password: nothing changes and nothing is revoked", async () => {
  mode = "bad-password";
  await assert.rejects(
    () =>
      changePassword({
        currentPassword: "wrong-password-123",
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    { message: "Your current password is incorrect. Please try again." },
  );
  assert.equal(updateRequests().length, 0, "no password update runs");
  assert.equal(logoutRequests().length, 0, "no revocation runs");
});

test("failed password update: the change is reported and nothing is revoked", async () => {
  mode = "update-fails";
  await assert.rejects(
    () =>
      changePassword({
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    { message: "Could not change your password. Please try again." },
  );
  assert.equal(updateRequests().length, 1, "the update was attempted once");
  assert.equal(logoutRequests().length, 0, "no revocation runs after a failed update");
});

// ---------------------------------------------------------------------------
// Wiring: the revocation call sits in changePassword, after updateUser
// ---------------------------------------------------------------------------

test("changePassword calls signOut({ scope: 'others' }) after updateUser", () => {
  const source = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function changePassword"));
  const updateAt = body.indexOf("supabase.auth.updateUser({ password: parsed.data.newPassword })");
  const revokeAt = body.indexOf('supabase.auth.signOut({ scope: "others" })');
  assert.ok(updateAt !== -1, "updateUser is in changePassword");
  assert.ok(revokeAt !== -1, 'signOut({ scope: "others" }) is in changePassword');
  assert.ok(updateAt < revokeAt, "revocation follows the update");
});

test("installed @supabase/auth-js supports scope 'others' and keeps the current session for it", () => {
  const types = readFileSync(
    new URL("../node_modules/@supabase/auth-js/dist/main/lib/types.js", import.meta.url),
    "utf8",
  );
  assert.match(types, /exports\.SIGN_OUT_SCOPES = \['global', 'local', 'others'\];/);
  const client = readFileSync(
    new URL("../node_modules/@supabase/auth-js/dist/main/GoTrueClient.js", import.meta.url),
    "utf8",
  );
  // _signOut removes the current session locally only for 'global'.
  assert.match(client, /if \(scope === 'global'\) \{\s*await removeCurrentSession\(\);\s*\}/);
});
