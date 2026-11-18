// Sign-up registered-email oracle — TechShot.
//
// Covers the fix for audit run-1 low
// techshot/auth/signup-registered-email-oracle: signUp used to map
// a Supabase already-registered error to the distinct message "An
// account with this email already exists. Please sign in instead.",
// which the sign-up page displayed verbatim - so an unauthenticated
// visitor could test any address through the sign-up form and learn
// whether an account exists for it. The reset flow in the same
// file is explicitly designed not to reveal this.
//
// The fix: an already-registered address gets exactly the same
// outcome as a new address awaiting email confirmation - the
// confirmation wording "Please check your email to confirm your
// account, then sign in.", which the sign-up page shows as a notice
// (setNotice), never as an error. A generic failure would NOT close
// the oracle: a registered address would get a form error while a
// new address gets the notice, so the two cases would still be
// distinguishable.
//
// These tests import the REAL lib/auth.ts signUp through the loader
// registered by tests/register-ts-loader.mjs (see package.json
// "test"); Node 24 strips the erasable TypeScript types, so the
// branch tested here is the exact branch the sign-up page runs.
// The browser client runs for real against a loopback mock GoTrue
// endpoint below (no live Supabase, dummy keys only): the mock
// answers "User already registered" for one address, a
// confirmation-pending sign-up (user, no session) for another, and
// a database error for a third, so the test proves the two outcomes
// a visitor can see are identical. The next/headers and react
// imports that cannot exist under plain Node are doubled by
// tests/auth-hooks.mjs.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test, { after, before } from "node:test";
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

const { signUp } = await import("../lib/auth.ts");

const ANON_KEY = "test-anon-key";
const SERVICE_KEY = "test-service-role-key";
const CONFIRMATION_MESSAGE = "Please check your email to confirm your account, then sign in.";

const REGISTERED_EMAIL = "registered@example.com";
const NEW_EMAIL = "new@example.com";
const ERROR_EMAIL = "error@example.com";

let mockBase = "";

function sendJson(res, code, value) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/auth/v1/signup") {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = {};
      }
      if (parsed.email === REGISTERED_EMAIL) {
        return sendJson(res, 400, {
          code: "user_already_exists",
          msg: "User already registered",
          message: "User already registered",
        });
      }
      if (parsed.email === ERROR_EMAIL) {
        return sendJson(res, 400, {
          msg: "Database error saving new user",
          message: "Database error saving new user",
        });
      }
      // Email confirmation on: a user, no session.
      return sendJson(res, 200, {
        user: {
          id: "user-new",
          aud: "authenticated",
          role: "authenticated",
          email: parsed.email,
          email_confirmed_at: null,
          created_at: "2026-11-18T00:00:00Z",
          updated_at: "2026-11-18T00:00:00Z",
          user_metadata: { display_name: "New User", role: "customer" },
          app_metadata: {},
        },
      });
    }
    if (req.method === "POST" && url.pathname === "/rest/v1/profiles") {
      // ensureProfile (server action) upserts the profiles row; the
      // sign-up under test swallows any failure here, so a plain
      // created answer keeps the flow identical to production.
      return sendJson(res, 201, []);
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

async function signUpMessage(email) {
  try {
    await signUp({
      displayName: "Test User",
      email,
      password: "password-123",
      role: "customer",
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------
// The oracle is closed: registered and unregistered look identical
// ---------------------------------------------------------------------------

test("already-registered address gets the confirmation wording, not a distinct error", async () => {
  assert.equal(await signUpMessage(REGISTERED_EMAIL), CONFIRMATION_MESSAGE);
});

test("new address gets the exact same confirmation wording", async () => {
  assert.equal(await signUpMessage(NEW_EMAIL), CONFIRMATION_MESSAGE);
});

test("registered and new addresses are indistinguishable from the thrown message", async () => {
  const registered = await signUpMessage(REGISTERED_EMAIL);
  const fresh = await signUpMessage(NEW_EMAIL);
  assert.equal(registered, fresh);
  assert.equal(registered, CONFIRMATION_MESSAGE);
});

test("other sign-up failures still get the generic message (the oracle branch is specific)", async () => {
  assert.equal(
    await signUpMessage(ERROR_EMAIL),
    "Could not create your account. Please try again.",
  );
});

// ---------------------------------------------------------------------------
// Wiring: the page shows the confirmation wording as a notice
// ---------------------------------------------------------------------------

test("lib/auth.ts no longer contains the already-exists oracle message", () => {
  const source = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
  assert.ok(
    !source.includes("An account with this email already exists"),
    "the distinct registered-address message must be gone",
  );
  assert.match(source, /if \(\/already registered\|already exists\/i\.test\(error\.message\)\) \{/);
});

test("the sign-up page routes the confirmation wording to the notice, never to a form error", () => {
  const page = readFileSync(new URL("../app/auth/sign-up/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(message\.startsWith\("Please check your email"\)\) \{\s*setNotice\(message\);/);
  assert.match(page, /\} else \{\s*setFormError\(message\);/);
});
