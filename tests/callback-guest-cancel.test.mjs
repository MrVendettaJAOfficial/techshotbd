// Callback memory-miss + guest-cancel tests — TechShot.
//
// Covers the Ponytail review fixes for findings #1 and #2
// (payment callback + guest cancel):
//
//   Finding #1 — the public callback route 400s when the order is
//     not in this server process's memory, so a real paid order
//     stays "pending payment" when the callback lands on a
//     different server (or after a restart). The fix loads the
//     order from Supabase on a memory miss
//     (loadSupabaseOrderForCallback) and continues the same flow.
//   Finding #2 — cancelMyOrder returned localOnly: true for every
//     guest before even looking for the order, so a guest COD
//     order (a real DB row with user_id NULL since migration
//     0014) looked cancelled in the browser while the database
//     row stayed confirmed and its stock stayed held. The fix
//     loads the database row first: a guest with a live row gets
//     a contact-us error (after proving ownership with the
//     buyerToken), and the browser-only fallback runs only when
//     no database row exists.
//
// These tests import the REAL modules (lib/orders/actions/cancel.ts
// and lib/orders/server/callback.ts) through the loader registered
// by tests/register-ts-loader.mjs, with the Next.js runtime imports
// doubled by tests/next-stub-hooks.mjs (see that file) plus the
// "react" double in tests/callback-guest-cancel-hooks.mjs: the auth
// stub supplies the caller, the Supabase-factory stub supplies the
// fake admin client below. Node 24 strips the erasable TypeScript
// types, so the rules tested here are the exact rules the route
// and the server action run — not a stub copy of them. The fake
// client speaks the same query-builder chain the code uses, with
// REAL conditional-update semantics: an update only lands on rows
// matching every .eq() filter, and returns exactly the rows it
// changed.
//
// What is proven here:
//   - loadSupabaseOrderForCallback(): a database row loads with
//     its current status and latest payment status; no row (or
//     Supabase unconfigured) loads as null;
//   - cancelMyOrder(): a guest with a live DB guest order and the
//     matching buyerToken gets the contact-us error (refund
//     wording when already paid) — never localOnly, never ok, the
//     row stays live and the stock is untouched; a wrong or
//     missing token, or a row owned by a signed-in user, gets the
//     generic error instead; a guest with no DB row still gets
//     localOnly (browser fallback preserved); the signed-in owner
//     cancel is unchanged (live cancel, stock restored, audit
//     row) and a signed-in non-owner is refused;
//   - source-level pins for the parts that need Next.js routing
//     and cannot run under node (the callback route itself):
//     memory miss falls through to the database load before the
//     400, the signature is still verified before any write, the
//     paid-cancel guard uses the resolved order, and the memory
//     record is only touched when one exists; plus the order page
//     passes the buyerToken through.
//
// What is NOT proven here: the full POST /api/payments/callback
// round trip and the browser cancel click — those are covered by
// tests/e2e/callback-guest-cancel.mjs against the mock Supabase.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);
register("./callback-guest-cancel-hooks.mjs", import.meta.url);

const { cancelMyOrder } = await import("../lib/orders/actions/cancel.ts");
const { GUEST_DB_CANCEL_ERROR, GUEST_DB_REFUND_ERROR } = await import(
  "../lib/orders/actions/shared.ts"
);
const { loadSupabaseOrderForCallback } = await import("../lib/orders/server/callback.ts");
const { createOrderRecord } = await import("../lib/orders/checkout/memory-store.ts");
const { __setUser } = await import("./stubs/auth-server-stub.mjs");
const { __setAdminClient } = await import("./stubs/supabase-server-stub.mjs");

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = (p) => readFileSync(join(SOURCE, p), "utf8");

// The callback loader checks isConfigured(), which reads these.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

const GUEST_TOKEN = "550e8400-e29b-41d4-a716-446655440000";

after(() => {
  __setUser(null);
  __setAdminClient(null);
});

/** A minimal StoredOrder for the in-memory record (only the
 *  buyerToken is read by the code under test). */
function memoryOrder(id, buyerToken) {
  return { id, buyerToken };
}

// ---------------------------------------------------------------------------
// Fake Supabase client — in-memory tables, conditional-update semantics.
// ---------------------------------------------------------------------------

function seedDb() {
  return {
    products: [
      { id: "prod-simple", slug: "test-simple", title: "Test Simple", price_poisha: 100000, stock: 5 },
    ],
    product_variants: [],
    orders: [
      {
        id: "ord-guest-live", order_number: "TS-20261116-1001", user_id: null,
        status: "confirmed", payment_method: "cod", total_poisha: 100000,
      },
      {
        id: "ord-guest-paid", order_number: "TS-20261116-1002", user_id: null,
        status: "confirmed", payment_method: "card", total_poisha: 100000,
      },
      {
        id: "ord-owner", order_number: "TS-20261116-1003", user_id: "user-1",
        status: "confirmed", payment_method: "cod", total_poisha: 200000,
      },
      {
        id: "ord-other-user", order_number: "TS-20261116-1004", user_id: "user-2",
        status: "confirmed", payment_method: "cod", total_poisha: 100000,
      },
      {
        id: "ord-callback", order_number: "TS-20261116-1005", user_id: null,
        status: "pending_payment", payment_method: "card", total_poisha: 100000,
      },
      {
        id: "ord-callback-paid", order_number: "TS-20261116-1006", user_id: null,
        status: "pending_payment", payment_method: "card", total_poisha: 100000,
      },
    ],
    order_items: [
      { id: "oi-guest", order_id: "ord-guest-live", product_id: "prod-simple", title: "Test Simple", price_poisha: 100000, quantity: 1 },
      { id: "oi-owner", order_id: "ord-owner", product_id: "prod-simple", title: "Test Simple", price_poisha: 100000, quantity: 2 },
    ],
    payments: [
      { id: "pay-guest-paid", order_id: "ord-guest-paid", status: "paid", amount_poisha: 100000, provider: "card", created_at: "2026-11-16T00:00:00.000Z" },
      { id: "pay-callback-paid", order_id: "ord-callback-paid", status: "paid", amount_poisha: 100000, provider: "card", created_at: "2026-11-16T00:00:00.000Z" },
    ],
    audit_log: [],
  };
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.op = null;
    this.patch = null;
    this.payload = null;
    this.orderBys = [];
    this.limitN = null;
    this.seq = 0;
  }

  select() {
    if (!this.op) this.op = "select";
    return this;
  }

  insert(payload) {
    this.op = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(patch) {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(col, val) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }

  is(col, val) {
    this.filters.push({ col, op: "is", val });
    return this;
  }

  order(col, { ascending = true } = {}) {
    this.orderBys.push({ col, ascending });
    return this;
  }

  limit(n) {
    this.limitN = n;
    return this;
  }

  _matches(row) {
    return this.filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return String(v ?? "") === String(f.val);
      if (f.op === "is") return f.val === null ? v == null : String(v) === String(f.val);
      return true;
    });
  }

  _run() {
    const rows = this.db[this.table] ?? [];
    if (this.op === "insert") {
      const inserted = this.payload.map((p) => {
        const row = { ...p, id: p.id ?? `fake-${this.table}-${++this.seq}` };
        rows.push(row);
        return row;
      });
      return { data: inserted, error: null };
    }
    if (this.op === "update") {
      const targets = rows.filter((r) => this._matches(r));
      for (const t of targets) Object.assign(t, this.patch);
      return { data: targets, error: null };
    }
    if (this.op === "delete") {
      const targets = rows.filter((r) => this._matches(r));
      for (const t of targets) rows.splice(rows.indexOf(t), 1);
      return { data: targets, error: null };
    }
    let out = rows.filter((r) => this._matches(r));
    for (const { col, ascending } of this.orderBys) {
      out = [...out].sort((a, b) =>
        (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1),
      );
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return { data: out, error: null };
  }

  async maybeSingle() {
    const { data } = this._run();
    return { data: data[0] ?? null, error: null };
  }

  async single() {
    const { data } = this._run();
    if (data.length !== 1) {
      return { data: null, error: { message: "single row expected", code: "PGRST116" } };
    }
    return { data: data[0], error: null };
  }

  then(resolve, reject) {
    try {
      resolve(this._run());
    } catch (error) {
      reject(error);
    }
  }
}

function fakeClient(seed = seedDb()) {
  return {
    __db: seed,
    from(table) {
      return new Query(seed, table);
    },
  };
}

const OWNER = { id: "user-1", email: "test@example.com", role: "customer" };
const OTHER = { id: "user-2", email: "other@example.com", role: "customer" };

function asGuest() {
  __setUser(null);
}

function asUser(user) {
  __setUser(user);
}

// ---------------------------------------------------------------------------
// Finding #1 — loadSupabaseOrderForCallback: the memory-miss fallback.
// ---------------------------------------------------------------------------

test("callback load: a database row loads with its status and latest payment status", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  try {
    assert.deepEqual(await loadSupabaseOrderForCallback("ord-callback"), {
      id: "ord-callback",
      status: "pending_payment",
      paymentStatus: "unpaid",
    });
    assert.deepEqual(await loadSupabaseOrderForCallback("ord-callback-paid"), {
      id: "ord-callback-paid",
      status: "pending_payment",
      paymentStatus: "paid",
    });
    assert.deepEqual(await loadSupabaseOrderForCallback("ord-guest-live"), {
      id: "ord-guest-live",
      status: "confirmed",
      paymentStatus: "unpaid",
    });
  } finally {
    __setAdminClient(null);
  }
});

test("callback load: no row loads as null, and unconfigured Supabase loads as null", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  try {
    assert.equal(await loadSupabaseOrderForCallback("ord-missing"), null);
  } finally {
    __setAdminClient(null);
  }
  // No admin client installed: the factory throws, the loader
  // answers null instead of failing the callback route.
  assert.equal(await loadSupabaseOrderForCallback("ord-callback"), null);
});

// ---------------------------------------------------------------------------
// Finding #2 — cancelMyOrder: guest with a live DB row.
// ---------------------------------------------------------------------------

test("guest cancel: a live DB guest order with the matching token gets the contact-us error, never a fake cancel", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asGuest();
  createOrderRecord(memoryOrder("ord-guest-live", GUEST_TOKEN));
  try {
    const result = await cancelMyOrder("ord-guest-live", GUEST_TOKEN);
    assert.equal(result.ok, false);
    assert.equal(result.error, GUEST_DB_CANCEL_ERROR);
    assert.match(result.error, /contact us/i);
    assert.equal(result.localOnly, undefined, "no browser-only fallback for a live row");
    // The row stays live and the stock stays held.
    const row = admin.__db.orders.find((o) => o.id === "ord-guest-live");
    assert.equal(row.status, "confirmed");
    assert.equal(admin.__db.products[0].stock, 5);
    assert.equal(admin.__db.audit_log.length, 0);
  } finally {
    __setAdminClient(null);
  }
});

test("guest cancel: a live DB guest order that is already paid gets the refund wording", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asGuest();
  createOrderRecord(memoryOrder("ord-guest-paid", GUEST_TOKEN));
  try {
    const result = await cancelMyOrder("ord-guest-paid", GUEST_TOKEN);
    assert.equal(result.ok, false);
    assert.equal(result.error, GUEST_DB_REFUND_ERROR);
    assert.match(result.error, /refund/i);
    assert.equal(result.localOnly, undefined);
    assert.equal(admin.__db.orders.find((o) => o.id === "ord-guest-paid").status, "confirmed");
  } finally {
    __setAdminClient(null);
  }
});

test("guest cancel: a wrong token, a missing token, or no memory record all get the generic error", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asGuest();
  createOrderRecord(memoryOrder("ord-guest-live", GUEST_TOKEN));
  try {
    // Wrong token: a stranger cannot probe for guest orders.
    const wrong = await cancelMyOrder("ord-guest-live", "00000000-0000-0000-0000-000000000000");
    assert.equal(wrong.ok, false);
    assert.equal(wrong.localOnly, undefined);
    assert.notEqual(wrong.error, GUEST_DB_CANCEL_ERROR);
    // Missing token.
    const missing = await cancelMyOrder("ord-guest-live", null);
    assert.equal(missing.ok, false);
    assert.equal(missing.localOnly, undefined);
    assert.notEqual(missing.error, GUEST_DB_CANCEL_ERROR);
    // No memory record at all (different server / restart): the
    // token cannot be proved, so fail closed with the generic
    // error — still never a fake browser-only cancel.
    const noMemory = await cancelMyOrder("ord-callback", GUEST_TOKEN);
    assert.equal(noMemory.ok, false);
    assert.equal(noMemory.localOnly, undefined);
    assert.notEqual(noMemory.error, GUEST_DB_CANCEL_ERROR);
    assert.equal(admin.__db.orders.find((o) => o.id === "ord-guest-live").status, "confirmed");
  } finally {
    __setAdminClient(null);
  }
});

test("guest cancel: a live DB row owned by a signed-in user is refused generically, token or not", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asGuest();
  createOrderRecord(memoryOrder("ord-other-user", GUEST_TOKEN));
  try {
    const result = await cancelMyOrder("ord-other-user", GUEST_TOKEN);
    assert.equal(result.ok, false);
    assert.equal(result.localOnly, undefined);
    assert.notEqual(result.error, GUEST_DB_CANCEL_ERROR);
    assert.equal(admin.__db.orders.find((o) => o.id === "ord-other-user").status, "confirmed");
  } finally {
    __setAdminClient(null);
  }
});

test("guest cancel: with no database row the browser-only fallback is preserved", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asGuest();
  try {
    const result = await cancelMyOrder("ord-browser-only", GUEST_TOKEN);
    assert.equal(result.ok, false);
    assert.equal(result.localOnly, true);
  } finally {
    __setAdminClient(null);
  }
  // Supabase not configured at all: same fallback.
  asGuest();
  const unconfigured = await cancelMyOrder("ord-browser-only", GUEST_TOKEN);
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.localOnly, true);
});

// ---------------------------------------------------------------------------
// Finding #2 — the signed-in owner flow is unchanged.
// ---------------------------------------------------------------------------

test("signed-in cancel: the owner still cancels live, restores stock and writes an audit row", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asUser(OWNER);
  try {
    const result = await cancelMyOrder("ord-owner");
    assert.deepEqual(result, { ok: true, orderNumber: "TS-20261116-1003" });
    assert.equal(admin.__db.orders.find((o) => o.id === "ord-owner").status, "cancelled");
    // Two units go back to the product row (no variant rows).
    assert.equal(admin.__db.products[0].stock, 7);
    assert.equal(admin.__db.audit_log.length, 1);
    assert.match(admin.__db.audit_log[0].action, /customer-cancel/);
  } finally {
    __setAdminClient(null);
  }
});

test("signed-in cancel: a non-owner is refused generically and nothing moves", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asUser(OTHER);
  try {
    const result = await cancelMyOrder("ord-owner");
    assert.equal(result.ok, false);
    assert.equal(result.localOnly, undefined);
    assert.equal(admin.__db.orders.find((o) => o.id === "ord-owner").status, "confirmed");
    assert.equal(admin.__db.products[0].stock, 5);
    assert.equal(admin.__db.audit_log.length, 0);
  } finally {
    __setAdminClient(null);
  }
});

test("signed-in cancel: with no database row the browser-only fallback is preserved", async () => {
  const admin = fakeClient();
  __setAdminClient(admin);
  asUser(OWNER);
  try {
    const result = await cancelMyOrder("ord-browser-only");
    assert.equal(result.ok, false);
    assert.equal(result.localOnly, true);
  } finally {
    __setAdminClient(null);
  }
});

// ---------------------------------------------------------------------------
// Source-level pins: the callback route wiring (needs Next.js routing,
// so it cannot run under node) and the token plumbing on the order page.
// ---------------------------------------------------------------------------

test("source: callback route falls back to the database load on a memory miss, before the 400", () => {
  const route = root("app/api/payments/callback/route.ts");
  assert.match(route, /const memoryOrder = getOrderRecord\(orderId\)/);
  assert.match(route, /loadSupabaseOrderForCallback\(orderId\)/);
  const loadAt = route.indexOf("loadSupabaseOrderForCallback(orderId)");
  const orderAt = route.indexOf("const order = memoryOrder ?? dbOrder");
  const invalidAt = route.indexOf('error: "Invalid callback"', orderAt);
  assert.ok(
    loadAt > 0 && orderAt > 0 && invalidAt > 0 && loadAt < orderAt && orderAt < invalidAt,
    "database load runs before the invalid-callback 400 for a missing order",
  );
  // The resolved order (memory or database) is what the guard reads.
  assert.match(route, /const order = memoryOrder \?\? dbOrder/);
  assert.match(route, /patch\.status === "cancelled" && order\.paymentStatus === "paid"/);
  // The memory record is only touched when one exists.
  assert.match(route, /if \(memoryOrder\) updateOrderRecordStatus\(orderId, patch\)/);
});

test("source: callback route still verifies the signature before any write, and the Supabase leg re-verifies it", () => {
  const route = root("app/api/payments/callback/route.ts");
  const verifyAt = route.indexOf("testAdapter.verifyCallback(");
  const syncAt = route.indexOf("updateSupabaseOrderFromCallback(orderId, patch");
  assert.ok(verifyAt > 0 && syncAt > 0 && verifyAt < syncAt, "signature verification precedes the database write");
  const callback = root("lib/orders/server/callback.ts");
  assert.match(callback, /verifyCallbackSignature\(proof\.payload, proof\.signature\)/);
  assert.match(callback, /export async function loadSupabaseOrderForCallback/);
});

test("source: order page passes the buyerToken through to cancelMyOrder", () => {
  const page = root("app/orders/[id]/page.tsx");
  assert.match(page, /cancelMyOrder\(order\.id, order\.buyerToken \?\? null\)/);
});

test("source: the in-memory order store lives on globalThis, so a server action sees checkout's records", () => {
  // Proven 2026-11-16: a module-level Map is one store per bundle
  // in the production build, and the cancel action (bundled apart
  // from checkout) could not see the record checkout created — the
  // buyerToken proof failed closed even though the record existed.
  const store = root("lib/orders/checkout/memory-store.ts");
  assert.match(store, /__techshotMemoryOrders/);
  assert.match(store, /globalThis as unknown as \{ __techshotMemoryOrders\?:/);
  assert.match(store, /holder\.__techshotMemoryOrders \?\?= new Map/);
});
