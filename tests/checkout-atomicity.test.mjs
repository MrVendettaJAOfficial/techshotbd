// Checkout atomicity tests — TechShot.
//
// Covers the 2026-11-12 fix for mediums #1–#7 (audit run-1, head
// 9c305966): duplicate checkout / idempotency, guest stock
// decrement, coupon usage-limit race, FIRST2000 fallback,
// guest coupon state, paid-cancel callback, advance double-submit.
//
// These tests import the REAL helper modules (lib/orders/checkout/*
// and lib/orders/stock.ts) through the loader registered by
// tests/register-ts-loader.mjs; Node 24 strips the erasable
// TypeScript types, so the rules tested here are the exact rules
// the checkout server action runs — not a stub copy of them. The
// fake Supabase client below speaks the same query-builder chain
// the helpers use, with REAL conditional-update semantics: an
// update only lands on rows matching every .eq() filter, and
// returns exactly the rows it changed — which is what makes the
// coupon-claim race test meaningful.
//
// What is proven here:
//   - validateCouponFromDb(): the coupons table is the only source
//     of truth — no row, inactive, expired, over-limit or
//     below-minimum-spend all reject; an unlimited active row accepts;
//   - claimCouponAtomically(): a limit-1 coupon is claimed once —
//     two claims from the same read-time used_count cannot both
//     land (the audit's S2 race, at the claim layer);
//   - releaseCouponClaim(): a claim is given back exactly once, and
//     never below zero;
//   - findOrderByIdempotencyKey(): signed-in and guest (user_id
//     NULL, IS NULL) lookups, scoped per buyer — one buyer's key
//     never finds another buyer's order;
//   - loadStoredOrder(): a stored row reloads as the StoredOrder
//     shape (items with live slugs, address split, delivery
//     inferred, latest payment status), buyerToken null (no column);
//   - computeCheckoutTotalsFromLines(): a DB-validated coupon
//     decides the discount / error, and without one the local
//     FIRST2000 rule still prices (display only);
//   - restoreOrderStock(): the helper the callback uses returns
//     stock after a cancel;
//   - source-level pins for the parts that need Next.js / a session
//     and cannot run under node (createSupabaseOrder, the callback,
//     the route, advanceOrderStatus, the checkout form/page): the
//     exact guards are present in the real files.
//
// What is NOT proven here: the full createSupabaseOrder flow (needs
// next/headers + a session + a database) and the browser flows —
// those are covered by tests/e2e/checkout-atomicity.mjs against the
// mock Supabase.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  claimCouponAtomically,
  releaseCouponClaim,
  validateCoupon,
  validateCouponFromDb,
} from "../lib/orders/checkout/coupons.ts";
import {
  findOrderByIdempotencyKey,
  isUniqueViolationError,
  loadStoredOrder,
} from "../lib/orders/checkout/idempotency.ts";
import { computeCheckoutTotalsFromLines } from "../lib/orders/checkout/totals.ts";
import { restoreOrderStock } from "../lib/orders/stock.ts";

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = (p) => readFileSync(join(SOURCE, p), "utf8");

// ---------------------------------------------------------------------------
// Fake Supabase client — in-memory tables, conditional-update semantics.
// ---------------------------------------------------------------------------

function seedDb() {
  const future = new Date(Date.now() + 365 * 864e5).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  return {
    products: [
      { id: "prod-phone", slug: "test-phone", title: "Test Phone", price_poisha: 6000000, stock: 9 },
    ],
    product_variants: [],
    coupons: [
      { id: "c-first2000", code: "FIRST2000", type: "fixed", value_poisha: 200000, min_spend_poisha: 5000000, usage_limit: null, used_count: 0, expires_at: future, is_active: true },
      { id: "c-limit1", code: "LIMIT1", type: "fixed", value_poisha: 100000, min_spend_poisha: 0, usage_limit: 1, used_count: 0, expires_at: future, is_active: true },
      { id: "c-inactive", code: "INACTIVE", type: "fixed", value_poisha: 100000, min_spend_poisha: 0, usage_limit: null, used_count: 0, expires_at: future, is_active: false },
      { id: "c-expired", code: "EXPIRED", type: "fixed", value_poisha: 100000, min_spend_poisha: 0, usage_limit: null, used_count: 0, expires_at: past, is_active: true },
      { id: "c-usedup", code: "USEDUP", type: "fixed", value_poisha: 100000, min_spend_poisha: 0, usage_limit: 1, used_count: 1, expires_at: future, is_active: true },
    ],
    orders: [
      {
        id: "ord-1", order_number: "TS-20261112-1111", user_id: "user-1", idempotency_key: "key-aaa",
        status: "confirmed", subtotal_poisha: 6000000, delivery_poisha: 0, discount_poisha: 0,
        total_poisha: 6000000,
        address_snapshot: { name: "Test User", phone: "01712345678", division: "Dhaka", district: "Dhaka", city: "Dhaka", full_address: "House 1, Dhanmondi" },
        payment_method: "cod", created_at: "2026-11-12T00:00:00.000Z", updated_at: "2026-11-12T00:00:00.000Z",
      },
      {
        id: "ord-shared-user", order_number: "TS-20261112-2222", user_id: "user-1", idempotency_key: "key-shared",
        status: "confirmed", subtotal_poisha: 6000000, delivery_poisha: 0, discount_poisha: 0,
        total_poisha: 6000000,
        address_snapshot: { name: "Test User", phone: "01712345678", division: "Dhaka", district: "Dhaka", city: "Dhaka", full_address: "House 1, Dhanmondi" },
        payment_method: "cod", created_at: "2026-11-12T00:00:00.000Z", updated_at: "2026-11-12T00:00:00.000Z",
      },
      {
        id: "ord-guest", order_number: "TS-20261112-3333", user_id: null, idempotency_key: "key-guest",
        status: "pending_payment", subtotal_poisha: 6000000, delivery_poisha: 49900, discount_poisha: 0,
        total_poisha: 6049900,
        address_snapshot: { name: "Guest Buyer", phone: "01812345678", division: "Chattogram", district: "Chattogram", city: "Chattogram", full_address: "House 2, Agrabad" },
        payment_method: "card", created_at: "2026-11-12T00:00:00.000Z", updated_at: "2026-11-12T00:00:00.000Z",
      },
      {
        id: "ord-shared-guest", order_number: "TS-20261112-4444", user_id: null, idempotency_key: "key-shared",
        status: "confirmed", subtotal_poisha: 6000000, delivery_poisha: 0, discount_poisha: 0,
        total_poisha: 6000000,
        address_snapshot: { name: "Guest Two", phone: "01912345678", division: "Dhaka", district: "Dhaka", city: "Dhaka", full_address: "House 3, Mirpur" },
        payment_method: "cod", created_at: "2026-11-12T00:00:00.000Z", updated_at: "2026-11-12T00:00:00.000Z",
      },
    ],
    order_items: [
      { id: "oi-1", order_id: "ord-1", product_id: "prod-phone", title: "Test Phone", price_poisha: 6000000, quantity: 1 },
      { id: "oi-g", order_id: "ord-guest", product_id: "prod-phone", title: "Test Phone", price_poisha: 6000000, quantity: 1 },
    ],
    payments: [
      { id: "pay-g", order_id: "ord-guest", status: "paid", amount_poisha: 6049900, provider: "card" },
    ],
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
    this.cols = null;
    this.orderBys = [];
    this.limitN = null;
    this.seq = 0;
  }

  select(cols) {
    if (!this.op) this.op = "select";
    this.cols = cols;
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

  like(col, pattern) {
    this.filters.push({ col, op: "like", val: pattern });
    return this;
  }

  in(col, vals) {
    this.filters.push({ col, op: "in", val: vals });
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
      if (f.op === "in") return (Array.isArray(f.val) ? f.val : [f.val]).map(String).includes(String(v ?? ""));
      if (f.op === "like") {
        const re = new RegExp(`^${String(f.val).replace(/%/g, ".*")}$`);
        return re.test(String(v ?? ""));
      }
      return true;
    });
  }

  _attach(rows) {
    if (this.table === "orders" && this.cols && this.cols.includes("order_items(")) {
      return rows.map((row) => ({
        ...row,
        order_items: this.db.order_items
          .filter((i) => i.order_id === row.id)
          .map((i) => {
            const p = this.db.products.find((x) => x.id === i.product_id);
            return { ...i, products: p ? { slug: p.slug } : null };
          }),
      }));
    }
    return rows;
  }

  _run() {
    const rows = this.db[this.table] ?? [];
    if (this.op === "insert") {
      const inserted = this.payload.map((p) => {
        const row = { ...p, id: p.id ?? `fake-${this.table}-${++this.seq}` };
        rows.push(row);
        return row;
      });
      return { data: this._attach(inserted), error: null };
    }
    if (this.op === "update") {
      // Conditional update: only rows matching EVERY filter change,
      // and only those rows are returned — the guard the atomic
      // coupon claim depends on.
      const targets = rows.filter((r) => this._matches(r));
      for (const t of targets) Object.assign(t, this.patch);
      return { data: this._attach(targets), error: null };
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
    return { data: this._attach(out), error: null };
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

  // Awaiting a bare update/select chain (no .single()/.maybeSingle())
  // resolves with { data, error }, like supabase-js.
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

// ---------------------------------------------------------------------------
// #3 + #4 + #5 — validateCouponFromDb: the DB row decides, always.
// ---------------------------------------------------------------------------

test("coupon DB check: an active row with no limit validates (FIRST2000)", async () => {
  const admin = fakeClient();
  const result = await validateCouponFromDb(admin, "FIRST2000", 6000000);
  assert.equal(result.ok, true);
  assert.equal(result.coupon.value_poisha, 200000);
  assert.equal(result.coupon.used_count, 0);
});

test("coupon DB check: a code with no row is invalid — no hardcoded fallback (#4)", async () => {
  const admin = fakeClient();
  admin.__db.coupons = admin.__db.coupons.filter((c) => c.code !== "FIRST2000");
  const result = await validateCouponFromDb(admin, "FIRST2000", 6000000);
  assert.equal(result.ok, false);
  assert.equal(result.error, "This coupon code is not valid.");
});

test("coupon DB check: inactive and expired rows are invalid, guest or not (#5)", async () => {
  const admin = fakeClient();
  for (const code of ["INACTIVE", "EXPIRED"]) {
    const result = await validateCouponFromDb(admin, code, 6000000);
    assert.equal(result.ok, false, `${code} must be rejected`);
    assert.equal(result.error, "This coupon code is not valid.");
  }
});

test("coupon DB check: below-minimum-spend and over-limit rows are invalid", async () => {
  const admin = fakeClient();
  const belowMin = await validateCouponFromDb(admin, "FIRST2000", 4999999);
  assert.equal(belowMin.ok, false);
  const overLimit = await validateCouponFromDb(admin, "USEDUP", 6000000);
  assert.equal(overLimit.ok, false);
});

test("coupon DB check: an unlimited row stays valid after many uses", async () => {
  const admin = fakeClient();
  admin.__db.coupons.find((c) => c.code === "FIRST2000").used_count = 5;
  const result = await validateCouponFromDb(admin, "FIRST2000", 6000000);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// #3 — claimCouponAtomically / releaseCouponClaim: the usage-limit race.
// ---------------------------------------------------------------------------

test("coupon claim: a limit-1 coupon is claimed once; the second claim from the same read loses", async () => {
  const admin = fakeClient();
  // Audit S2, at the claim layer: both checkouts read used_count 0.
  const readA = (await validateCouponFromDb(admin, "LIMIT1", 6000000)).coupon;
  const readB = (await validateCouponFromDb(admin, "LIMIT1", 6000000)).coupon;
  assert.equal(readA.used_count, 0);
  assert.equal(readB.used_count, 0);
  assert.equal(await claimCouponAtomically(admin, readA.id, readA.used_count), true);
  assert.equal(admin.__db.coupons.find((c) => c.code === "LIMIT1").used_count, 1);
  // The loser read the same expected count, but the row has moved.
  assert.equal(await claimCouponAtomically(admin, readB.id, readB.used_count), false);
  assert.equal(admin.__db.coupons.find((c) => c.code === "LIMIT1").used_count, 1);
  // A fresh read sees used_count 1, so the limit now rejects outright.
  assert.equal((await validateCouponFromDb(admin, "LIMIT1", 6000000)).ok, false);
});

test("coupon claim: a claim against a stale expected count never lands", async () => {
  const admin = fakeClient();
  assert.equal(await claimCouponAtomically(admin, "c-limit1", 7), false);
  assert.equal(admin.__db.coupons.find((c) => c.code === "LIMIT1").used_count, 0);
});

test("coupon release: a failed order gives its claim back exactly once, never below zero", async () => {
  const admin = fakeClient();
  assert.equal(await claimCouponAtomically(admin, "c-limit1", 0), true);
  assert.equal(await releaseCouponClaim(admin, "c-limit1"), true);
  assert.equal(admin.__db.coupons.find((c) => c.code === "LIMIT1").used_count, 0);
  // Second release: nothing to give back.
  assert.equal(await releaseCouponClaim(admin, "c-limit1"), false);
  assert.equal(admin.__db.coupons.find((c) => c.code === "LIMIT1").used_count, 0);
});

// ---------------------------------------------------------------------------
// #1 — findOrderByIdempotencyKey + loadStoredOrder: the dedup lookup.
// ---------------------------------------------------------------------------

test("idempotency lookup: a signed-in buyer's key finds their order", async () => {
  const admin = fakeClient();
  assert.equal(await findOrderByIdempotencyKey(admin, "user-1", "key-aaa"), "ord-1");
  assert.equal(await findOrderByIdempotencyKey(admin, "user-1", "key-missing"), null);
  assert.equal(await findOrderByIdempotencyKey(admin, "user-1", ""), null);
});

test("idempotency lookup: a key is scoped per buyer — never another buyer's order", async () => {
  const admin = fakeClient();
  assert.equal(await findOrderByIdempotencyKey(admin, "user-2", "key-aaa"), null);
  // Same key string, two buyers: each finds only their own row.
  assert.equal(await findOrderByIdempotencyKey(admin, "user-1", "key-shared"), "ord-shared-user");
  assert.equal(await findOrderByIdempotencyKey(admin, null, "key-shared"), "ord-shared-guest");
});

test("idempotency lookup: a guest order (user_id NULL) is found with IS NULL (#1/#2)", async () => {
  const admin = fakeClient();
  assert.equal(await findOrderByIdempotencyKey(admin, null, "key-guest"), "ord-guest");
  // A signed-in lookup must never match the guest row with the same key.
  assert.equal(await findOrderByIdempotencyKey(admin, "user-1", "key-guest"), null);
});

test("order reload: a stored row reloads as the StoredOrder shape", async () => {
  const admin = fakeClient();
  const order = await loadStoredOrder(admin, "ord-1");
  assert.equal(order.id, "ord-1");
  assert.equal(order.orderNumber, "TS-20261112-1111");
  assert.equal(order.status, "confirmed");
  assert.equal(order.total_poisha, 6000000);
  assert.equal(order.delivery, "standard");
  assert.equal(order.paymentMethod, "cod");
  assert.equal(order.paymentStatus, "unpaid");
  assert.equal(order.userId, "user-1");
  // No buyer_token column on orders: a reloaded order has no key.
  assert.equal(order.buyerToken, null);
  assert.equal(order.testMode, false);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productId, "test-phone");
  assert.equal(order.items[0].title, "Test Phone");
  assert.equal(order.items[0].price_poisha, 6000000);
  assert.equal(order.items[0].quantity, 1);
  assert.equal(order.address.firstName, "Test");
  assert.equal(order.address.lastName, "User");
  assert.equal(order.address.mobile, "01712345678");
  assert.equal(order.address.division, "Dhaka");
});

test("order reload: an express delivery charge and a paid row map back", async () => {
  const admin = fakeClient();
  const order = await loadStoredOrder(admin, "ord-guest");
  assert.equal(order.delivery, "express");
  assert.equal(order.paymentMethod, "card");
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.userId, null);
  assert.equal(order.testMode, true);
  assert.equal(await loadStoredOrder(admin, "ord-missing"), null);
});

test("unique-violation detection: 23505 and duplicate-key messages, nothing else", () => {
  assert.equal(isUniqueViolationError({ code: "23505", message: "x" }), true);
  assert.equal(isUniqueViolationError({ message: 'duplicate key value violates unique constraint "orders_idempotency_unique"' }), true);
  assert.equal(isUniqueViolationError({ code: "PGRST116", message: "no rows" }), false);
  assert.equal(isUniqueViolationError(null), false);
  assert.equal(isUniqueViolationError(undefined), false);
});

// ---------------------------------------------------------------------------
// #5 — computeCheckoutTotalsFromLines: a DB-validated coupon decides.
// ---------------------------------------------------------------------------

const displayLines = [
  { productId: "test-phone", title: "Test Phone", price_poisha: 6000000, mrp_poisha: 6500000, quantity: 1 },
];

test("totals: a DB-validated coupon applies its discount; a DB rejection errors, never discounts", () => {
  const granted = computeCheckoutTotalsFromLines(displayLines, [], "FIRST2000", "standard", { discount_poisha: 200000 });
  assert.equal(granted.couponDiscount_poisha, 200000);
  assert.equal(granted.couponError, undefined);
  assert.equal(granted.total_poisha, 5800000);

  const rejected = computeCheckoutTotalsFromLines(displayLines, [], "FIRST2000", "standard", { error: "This coupon code is not valid." });
  assert.equal(rejected.couponDiscount_poisha, 0);
  assert.equal(rejected.couponError, "This coupon code is not valid.");
});

test("totals: without a DB coupon the local FIRST2000 rule still prices (display only)", () => {
  const priced = computeCheckoutTotalsFromLines(displayLines, [], "FIRST2000", "standard");
  assert.equal(priced.couponDiscount_poisha, 200000);
  const unknown = computeCheckoutTotalsFromLines(displayLines, [], "NOPE", "standard");
  assert.equal(unknown.couponError, "This coupon code is not valid.");
  // The local rule itself is unchanged (cart / form display).
  assert.deepEqual(validateCoupon("FIRST2000", 6000000), { discount_poisha: 200000 });
});

// ---------------------------------------------------------------------------
// #6 — restoreOrderStock: the helper the callback now calls on cancel.
// ---------------------------------------------------------------------------

test("stock restore: a cancelled order's line goes back to the product row", async () => {
  const admin = fakeClient();
  assert.equal(admin.__db.products[0].stock, 9);
  const result = await restoreOrderStock(admin, "ord-1");
  assert.deepEqual(result, { restored: 1, skipped: 0 });
  assert.equal(admin.__db.products[0].stock, 10);
  const missing = await restoreOrderStock(admin, "ord-missing");
  assert.deepEqual(missing, { restored: 0, skipped: 0 });
});

// ---------------------------------------------------------------------------
// Source-level pins: the server-only parts (next/headers, sessions)
// cannot run under node, so the exact guards are pinned in place.
// ---------------------------------------------------------------------------

test("source: createSupabaseOrder has no hardcoded coupon fallback and claims atomically (#3/#4)", () => {
  const create = root("lib/orders/server/create.ts");
  assert.match(create, /validateCouponFromDb\(admin, normalizedCode, subtotal_poisha\)/);
  assert.match(create, /claimCouponAtomically\(/);
  assert.match(create, /releaseCouponClaim\(admin, claimedCouponId\)/);
  assert.equal(create.includes("validateCoupon(normalizedCode"), false, "hardcoded fallback must be gone");
  assert.equal(create.includes("fall back to the local FIRST2000"), false);
  // The old read-then-write increment is gone (claim replaced it).
  assert.equal(create.includes("used_count: (coupon.used_count ?? 0) + 1"), false);
});

test("source: createSupabaseOrder dedups on the key and returns the twin on conflict (#1)", () => {
  const create = root("lib/orders/server/create.ts");
  assert.match(create, /findOrderByIdempotencyKey\(admin, userId, idempotencyKey\)/);
  assert.match(create, /idempotency_key: idempotencyKey/);
  assert.match(create, /isUniqueViolationError\(orderError\)/);
  assert.match(create, /loadStoredOrder\(admin, twinId\)/);
});

test("source: createSupabaseOrder takes guest orders through the DB path with a buyerToken (#2)", () => {
  const create = root("lib/orders/server/create.ts");
  assert.match(create, /const buyerToken = userId \? null : randomUUID\(\)/);
  assert.match(create, /user_id: userId,/);
  // No more "sign in to place an order" early return for guests.
  assert.equal(create.includes('Sign in to place an order with your account.'), false);
  assert.equal(create.includes("buyerToken: null,"), false);
});

test("source: checkout form generates one UUID per attempt and sends it (#1)", () => {
  const form = root("components/checkout/checkout-form.tsx");
  assert.match(form, /crypto\.randomUUID\(\)/);
  assert.match(form, /idempotencyKey,/);
  assert.match(form, /const \[idempotencyKey\] = useState/);
});

test("source: PlaceOrderInput threads the idempotency key (#1)", () => {
  const validation = root("lib/orders/checkout/validation.ts");
  assert.match(validation, /idempotencyKey\?: string;/);
});

test("source: checkout page validates the local-fallback coupon from the DB and keys guest redirects (#2/#5)", () => {
  const page = root("app/checkout/page.tsx");
  assert.match(page, /validateCouponFromDb\(admin, normalizedCode, localSubtotal\)/);
  assert.match(page, /dbCoupon/);
  assert.match(page, /\?key=\$\{encodeURIComponent\(order\.buyerToken\)\}/);
  // A duplicate submission must not clobber the in-memory guest key.
  assert.match(page, /getOrderRecord\(supabaseResult\.order\.id\)/);
  assert.match(page, /localCheckoutByKey/);
});

test("source: callback refuses a paid cancel and restores stock on an unpaid cancel (#6)", () => {
  const callback = root("lib/orders/server/callback.ts");
  assert.match(callback, /patch\.status === "cancelled" && currentPayment === "paid"/);
  assert.match(callback, /A paid order cannot be cancelled\. Refund it instead\./);
  assert.match(callback, /restoreOrderStock\(admin, orderId\)/);
  assert.match(callback, /currentStatus !== "cancelled"/);
  // The 3-high fix is untouched: the proof is still verified here.
  assert.match(callback, /verifyCallbackSignature\(proof\.payload, proof\.signature\)/);
  const route = root("app/api/payments/callback/route.ts");
  const guardAt = route.indexOf('patch.status === "cancelled" && order.paymentStatus === "paid"');
  const memoryAt = route.indexOf("updateOrderRecordStatus(orderId, patch)");
  assert.ok(guardAt !== -1 && guardAt < memoryAt, "route must refuse the paid cancel before touching the memory record");
});

test("source: advanceOrderStatus requires the rendered status and rejects a stale one (#7)", () => {
  const status = root("lib/orders/actions/status.ts");
  assert.match(status, /advanceOrderStatus\(\s*orderId: string,\s*expectedStatus\?: unknown/);
  assert.match(status, /orderStatusSchema\.safeParse\(expectedStatus\)/);
  assert.match(status, /ALREADY_CHANGED_ERROR/);
  const list = root("components/admin-orders/orders-list.tsx");
  assert.match(list, /advanceOrderStatus\(order\.id, order\.status\)/);
});

test("source: migration 0014 is written with the idempotency + coupon backstops (NOT applied)", () => {
  const migration = root("supabase/migrations/0014_checkout_idempotency_coupon.sql");
  assert.match(migration, /NOT APPLIED/);
  assert.match(migration, /idempotency_key text/);
  assert.match(migration, /unique \(user_id, idempotency_key\)/);
  assert.match(migration, /orders_idempotency_guest_idx/);
  assert.match(migration, /where user_id is null and idempotency_key is not null/);
  assert.match(migration, /alter column user_id drop not null/);
  assert.match(migration, /check \(usage_limit is null or used_count <= usage_limit\)/);
});
