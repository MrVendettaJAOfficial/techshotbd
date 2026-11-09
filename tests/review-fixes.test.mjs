// Review-fix tests — TechShot (gstack pre-landing review, 2026-11-08).
//
// These tests import the REAL modules through the loader registered by
// tests/register-ts-loader.mjs (see package.json "test"); Node 24 strips
// the erasable TypeScript types, so the rules tested here are the exact
// rules the app runs — not stub copies.
//
// What is proven here:
//   - mergeOrders compares Date.parse values numerically and returns 0
//     for equal timestamps (fix #12);
//   - stored orders read from localStorage are validated with zod and
//     crafted entries are dropped before rendering (fix #16);
//   - a refund from "delivered" is a returns flow (legal only when the
//     latest payment is paid) (fix #13);
//   - the conditional stock decrement guard: two checkouts for the
//     last item cannot both succeed (fix #5);
//   - cancel / refund stock restore puts quantities back on exactly
//     the row checkout decremented (fix #2);
//   - the server code itself carries the guards that need a database
//     to run: conditional status updates, refund-before-status-change,
//     append-only payment rows, transition validation in the sync
//     path, the customer cancel action, and the admin in-flight state
//     (fixes #1, #3, #4, #6, #7, #8) — checked against the real source
//     files, with the live behaviour covered by the Playwright
//     mock-Supabase checks in tests/e2e/.
//
// What is NOT proven here: the Supabase writes themselves (they need
// a signed-in session and a database). Those are covered by the
// Playwright mock-Supabase run (see README, "End-to-end checks").
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeOrders } from "../lib/account-rules.ts";
import {
  storedOrderSchema,
  validateStoredOrders,
} from "../lib/checkout-store.ts";
import { isLegalOrderTransition } from "../lib/orders/transitions.ts";
import {
  adjustStockRow,
  decrementStockGuarded,
  restoreOrderStock,
} from "../lib/orders/stock.ts";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// Fix #12 — mergeOrders comparator
// ---------------------------------------------------------------------------

test("mergeOrders: equal timestamps compare 0 (stable, no -1 for equals)", () => {
  const a = { id: "a", orderNumber: "TS-1", status: "confirmed", total_poisha: 100, createdAt: "2026-11-08T10:00:00.000Z" };
  const b = { id: "b", orderNumber: "TS-2", status: "confirmed", total_poisha: 200, createdAt: "2026-11-08T10:00:00.000Z" };
  const merged = mergeOrders([a], [b]);
  assert.equal(merged.length, 2);
  // Equal timestamps: neither order is "newer", so the sort keeps
  // insertion order instead of reversing one of them.
  assert.deepEqual(merged.map((o) => o.id), ["a", "b"]);
});

test("mergeOrders: ISO strings in different formats compare by instant, not lexicographically", () => {
  // 10:00 UTC vs 15:00+06:00 (= 09:00 UTC): lexicographic order says
  // the +06:00 string is "later"; the instant says the UTC one is.
  const utc = { id: "utc", orderNumber: "TS-1", status: "confirmed", total_poisha: 100, createdAt: "2026-11-08T10:00:00.000Z" };
  const plusSix = { id: "plus6", orderNumber: "TS-2", status: "confirmed", total_poisha: 200, createdAt: "2026-11-08T15:00:00+06:00" };
  const merged = mergeOrders([plusSix], [utc]);
  assert.equal(merged[0].id, "utc");
  assert.equal(merged[1].id, "plus6");
});

test("mergeOrders: live copy still wins on a shared id", () => {
  const local = { id: "x", orderNumber: "TS-1", status: "pending_payment", total_poisha: 100, createdAt: "2026-11-08T09:00:00.000Z" };
  const live = { id: "x", orderNumber: "TS-1", status: "processing", total_poisha: 100, createdAt: "2026-11-08T10:00:00.000Z" };
  const merged = mergeOrders([local], [live]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "processing");
});

// ---------------------------------------------------------------------------
// Fix #16 — stored-order validation
// ---------------------------------------------------------------------------

function validOrder(overrides = {}) {
  return {
    id: "order_1",
    orderNumber: "TS-20261108-0001",
    items: [
      { productId: "apple-iphone-16-pro", title: "Apple iPhone 16 Pro", price_poisha: 11990000, mrp_poisha: 12990000, quantity: 1 },
    ],
    address: {
      id: "addr_1", firstName: "Test", lastName: "User", email: "test@example.com",
      mobile: "01712345678", address: "House 1, Road 2", area: "Dhanmondi",
      division: "Dhaka", district: "Dhaka", city: "Dhaka", isDefault: false,
    },
    delivery: "standard",
    paymentMethod: "cod",
    subtotal_poisha: 11990000,
    savings_poisha: 1000000,
    couponCode: null,
    couponDiscount_poisha: 0,
    deliveryFee_poisha: 0,
    total_poisha: 11990000,
    status: "confirmed",
    paymentStatus: "unpaid",
    testMode: false,
    createdAt: "2026-11-08T10:00:00.000Z",
    updatedAt: "2026-11-08T10:00:00.000Z",
    ...overrides,
  };
}

test("validateStoredOrders: a real stored order passes validation", () => {
  const parsed = storedOrderSchema.safeParse(validOrder());
  assert.equal(parsed.success, true);
  assert.deepEqual(validateStoredOrders([validOrder()]).length, 1);
});

test("validateStoredOrders: a crafted localStorage entry is dropped, not rendered", () => {
  const fake = {
    id: "order_fake",
    orderNumber: "TS-FAKE-9999",
    // No items, no address, a status that does not exist, a negative
    // total and a paymentStatus the app never writes — exactly what a
    // hand-edited localStorage entry could look like.
    items: [],
    status: "refunded_by_admin",
    paymentStatus: "paid",
    total_poisha: -5000000,
  };
  assert.deepEqual(validateStoredOrders([validOrder(), fake]).map((o) => o.id), ["order_1"]);
});

test("validateStoredOrders: wrong types and negative money are dropped", () => {
  const badPrice = validOrder({ total_poisha: "11990000" });
  const badStatus = validOrder({ status: "delivered_early" });
  const badQty = validOrder({
    items: [{ productId: "x", title: "X", price_poisha: 100, mrp_poisha: 100, quantity: 0 }],
  });
  assert.deepEqual(validateStoredOrders([badPrice, badStatus, badQty]), []);
  assert.deepEqual(validateStoredOrders("not-an-array"), []);
  assert.deepEqual(validateStoredOrders(null), []);
});

// ---------------------------------------------------------------------------
// Fix #13 — refund from delivered is a returns flow (paid only)
// ---------------------------------------------------------------------------

test("refund from delivered is legal only when the latest payment is paid", () => {
  assert.equal(isLegalOrderTransition("delivered", "refunded", "paid"), true);
  assert.equal(isLegalOrderTransition("delivered", "refunded", "unpaid"), false);
  assert.equal(isLegalOrderTransition("delivered", "refunded", "failed"), false);
  assert.equal(isLegalOrderTransition("delivered", "refunded", "refunded"), false);
});

// ---------------------------------------------------------------------------
// Fixes #2 / #5 — conditional stock writes, driven by a fake client
// ---------------------------------------------------------------------------

/**
 * Minimal fake Supabase query builder: implements the exact chain the
 * stock helpers use (.from().select/.update/.insert with .eq/.limit/
 * .maybeSingle/.select), against in-memory tables, with PostgREST
 * semantics that matter here — an update whose .eq() guards do not
 * match touches 0 rows and returns an empty array.
 */
function makeFakeClient(tables, options = {}) {
  const db = tables;
  class Builder {
    constructor(table) {
      this.table = table;
      this.mode = "select";
      this.columns = "*";
      this.filters = [];
      this.values = null;
      this.limitN = null;
      this.single = false;
    }
    select(columns) {
      if (this.mode === "update") {
        this.returning = true;
        this.returnColumns = columns;
        return this;
      }
      this.columns = columns;
      return this;
    }
    eq(col, val) {
      this.filters.push([col, val]);
      return this;
    }
    order() {
      return this;
    }
    limit(n) {
      this.limitN = n;
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    update(values) {
      this.mode = "update";
      this.values = values;
      return this;
    }
    insert(row) {
      this.mode = "insert";
      this.values = row;
      return this;
    }
    matches(row) {
      return this.filters.every(([col, val]) => String(row[col] ?? "") === String(val));
    }
    runSelect() {
      // order_items has no variant_id column until migration 0003.
      if (
        this.table === "order_items" &&
        options.noVariantColumn &&
        typeof this.columns === "string" &&
        this.columns.includes("variant_id")
      ) {
        return { data: null, error: { message: 'column "variant_id" does not exist' } };
      }
      let rows = (db[this.table] ?? []).filter((r) => this.matches(r));
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      if (this.single) {
        if (rows.length === 0) return { data: null, error: null };
        return { data: rows[0], error: null };
      }
      return { data: rows, error: null };
    }
    runUpdate() {
      const targets = (db[this.table] ?? []).filter((r) => this.matches(r));
      for (const row of targets) Object.assign(row, this.values);
      if (!this.returning) return { data: null, error: null };
      return { data: targets.map((r) => ({ id: r.id })), error: null };
    }
    runInsert() {
      const row = { ...this.values };
      if (!row.id) row.id = `fake-${Math.random().toString(36).slice(2)}`;
      (db[this.table] ??= []).push(row);
      return { data: [row], error: null };
    }
    then(resolve, reject) {
      try {
        const result =
          this.mode === "update"
            ? this.runUpdate()
            : this.mode === "insert"
              ? this.runInsert()
              : this.runSelect();
        return Promise.resolve(result).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    }
  }
  return {
    from(table) {
      return new Builder(table);
    },
  };
}

test("decrementStockGuarded: two concurrent checkouts for the last item cannot both succeed", async () => {
  const db = { products: [{ id: "prod-1", stock: 1 }], product_variants: [], order_items: [] };
  const client = makeFakeClient(db);
  // First checkout takes the last item.
  assert.equal(await decrementStockGuarded(client, "products", "prod-1", 1, 1), true);
  assert.equal(db.products[0].stock, 0);
  // Second checkout, checked against the same stale stock of 1,
  // must fail: the guard (stock still = 1) no longer holds.
  assert.equal(await decrementStockGuarded(client, "products", "prod-1", 1, 1), false);
  assert.equal(db.products[0].stock, 0);
});

test("decrementStockGuarded: 0 rows affected fails the order instead of overselling", async () => {
  const db = { products: [{ id: "prod-1", stock: 0 }], product_variants: [], order_items: [] };
  const client = makeFakeClient(db);
  // A checkout that checked stock 1 against a row that now holds 0
  // (another checkout took it) must fail: the guard no longer holds.
  assert.equal(await decrementStockGuarded(client, "products", "prod-1", 1, 1), false);
  assert.equal(db.products[0].stock, 0);
});

test("adjustStockRow: a restore adds the quantity back, guarded by the current stock", async () => {
  const db = { products: [{ id: "prod-1", stock: 3 }], product_variants: [], order_items: [] };
  const client = makeFakeClient(db);
  assert.equal(await adjustStockRow(client, "products", "prod-1", 2), true);
  assert.equal(db.products[0].stock, 5);
  assert.equal(await adjustStockRow(client, "products", "missing", 2), false);
});

test("restoreOrderStock: cancel restores the product row checkout decremented", async () => {
  const db = {
    products: [{ id: "prod-1", stock: 10 }],
    product_variants: [],
    order_items: [{ id: "item-1", order_id: "order-1", product_id: "prod-1", quantity: 2 }],
  };
  const client = makeFakeClient(db, { noVariantColumn: true });
  const result = await restoreOrderStock(client, "order-1");
  assert.deepEqual(result, { restored: 1, skipped: 0 });
  assert.equal(db.products[0].stock, 12);
});

test("restoreOrderStock: a variant line restores the variant row, not the product row", async () => {
  const db = {
    products: [{ id: "prod-1", stock: 10 }],
    product_variants: [{ id: "var-1", stock: 4 }],
    order_items: [
      { id: "item-1", order_id: "order-1", product_id: "prod-1", variant_id: "var-1", quantity: 1 },
    ],
  };
  const client = makeFakeClient(db);
  const result = await restoreOrderStock(client, "order-1");
  assert.deepEqual(result, { restored: 1, skipped: 0 });
  assert.equal(db.product_variants[0].stock, 5);
  assert.equal(db.products[0].stock, 10);
});

test("restoreOrderStock: a line that cannot be attributed to a stock row is skipped, not guessed", async () => {
  const db = {
    products: [{ id: "prod-1", stock: 10 }],
    product_variants: [{ id: "var-1", product_id: "prod-1", stock: 4 }],
    // No variant_id recorded (pre-migration row) but the product HAS
    // variants: restoring to the product row could over-restore.
    order_items: [{ id: "item-1", order_id: "order-1", product_id: "prod-1", quantity: 1 }],
  };
  const client = makeFakeClient(db, { noVariantColumn: true });
  const result = await restoreOrderStock(client, "order-1");
  assert.deepEqual(result, { restored: 0, skipped: 1 });
  assert.equal(db.products[0].stock, 10);
  assert.equal(db.product_variants[0].stock, 4);
});

// ---------------------------------------------------------------------------
// Fixes #1, #3, #4, #6, #7, #8, #14 — guards in the real source files.
// These paths need a signed-in session + a database, so the unit suite
// proves the guard code is present in the exact files that run it,
// and the Playwright mock-Supabase run proves the behaviour.
// ---------------------------------------------------------------------------

test("admin status change is a conditional update (0 rows = already changed, audit only on success)", () => {
  const src = readSource("../lib/orders/actions.ts");
  assert.ok(src.includes('.eq("status", order.status)'), "update is conditional on the read status");
  assert.ok(src.includes('.select("id")'), "affected-row count is read back");
  assert.ok(src.includes("ALREADY_CHANGED_ERROR"), "0 rows affected is reported as already changed");
  // Audit is written after the conditional update, only on its success.
  const updateAt = src.indexOf('.eq("status", order.status)');
  const auditAt = src.indexOf("await writeAudit(admin, user.id, order.id, order.status, target)");
  assert.ok(updateAt > 0 && auditAt > updateAt);
});

test("admin refund calls the payment adapter FIRST and only then marks the order refunded", () => {
  const src = readSource("../lib/orders/actions.ts");
  assert.ok(src.includes("testAdapter.refund(paidPayment.id, paidPayment.amount_poisha)"));
  assert.ok(src.includes("loadLatestPaidPayment"), "refund uses the latest PAID payment attempt");
  const refundAt = src.indexOf("testAdapter.refund(");
  const updateAt = src.indexOf('.update({ status: target })');
  assert.ok(refundAt > 0 && updateAt > refundAt, "adapter refund precedes the status update");
  // Refund appends a new payments row; it never overwrites the paid row.
  assert.ok(src.includes('status: "refunded"'), "refund payment row is inserted");
  assert.ok(!src.includes('.update({ status: "refunded" })'), "no payments row is overwritten to refunded");
});

test("cancel / refund restore stock only after the conditional update succeeds", () => {
  const src = readSource("../lib/orders/actions.ts");
  assert.ok(src.includes("restoreStockAfterStatusChange"), "stock restore is wired into status changes");
  assert.ok(src.includes('if (target === "cancelled" || target === "refunded" || target === "returned")'), "cancel, refund and returned all restore stock");
  const updateAt = src.indexOf('.eq("status", order.status)');
  const restoreAt = src.indexOf("await restoreStockAfterStatusChange(admin, order.id)");
  assert.ok(restoreAt > updateAt, "restore happens after the update, never before it");
});

test("customer cancel is a server action with owner + state checks (fix #3)", () => {
  const src = readSource("../lib/orders/actions.ts");
  assert.ok(src.includes("export async function cancelMyOrder"), "dedicated customer cancel action exists");
  assert.ok(src.includes("order.userId !== user.id"), "owner check");
  assert.ok(src.includes('order.status !== "pending_payment" && order.status !== "confirmed"'), "state check");
  assert.ok(src.includes("localOnly: true"), "browser-only orders fall back without a stock claim");
  const page = readSource("../app/orders/[id]/page.tsx");
  assert.ok(page.includes("await cancelMyOrder(order.id)"), "order page routes cancel through the server action");
  assert.ok(
    page.includes("Order cancelled. Stock for these items has been released back to inventory."),
    "stock message only on the server-confirmed path",
  );
  assert.ok(
    page.includes("Order cancelled in this browser. This order was not saved to your account."),
    "local-only cancel says so honestly",
  );
});

test("payment sync appends attempt rows and never overwrites a payment row (fix #6)", () => {
  const src = readSource("../lib/orders-server.ts");
  assert.ok(!src.includes('.update({ status: paymentStatus })'), "no payments-row status overwrite remains");
  assert.ok(src.includes("from(\"payments\").insert"), "callback inserts a new attempt row");
});

test("payment-status changes are rejected from the owner sync path (fix #7)", () => {
  const src = readSource("../lib/orders-server.ts");
  assert.ok(src.includes("isLegalOrderTransition(currentStatus, patch.status, currentPayment)"));
  assert.ok(src.includes('patch.paymentStatus !== undefined && patch.paymentStatus !== "unpaid"'));
  assert.ok(src.includes('patch.status === "delivered" || patch.status === "refunded"'), "delivered/refunded are admin-only there");
});

test("payment callbacks and status syncs write audit rows (fix #8)", () => {
  const src = readSource("../lib/orders-server.ts");
  assert.ok(src.includes("writeOrderAudit"), "audit helper exists for the sync paths");
  assert.ok(src.includes('"payment-callback"'), "callback audit rows are labelled");
  assert.ok(src.includes('"status-sync"'), "status-sync audit rows are labelled");
});

test("latest-payment lookups carry the id tiebreaker (fix #11)", () => {
  for (const file of ["../lib/orders-server.ts", "../lib/orders/actions.ts"]) {
    const src = readSource(file);
    assert.ok(src.includes('.order("id", { ascending: false })'), `${file} orders latest payments by id desc too`);
  }
});

test("admin users list carries no email into the client bundle (fix #14)", () => {
  const queries = readSource("../lib/products/queries.ts");
  const iface = queries.slice(queries.indexOf("export interface AdminUserItem"), queries.indexOf("}", queries.indexOf("export interface AdminUserItem")));
  assert.ok(!iface.includes("email"), "AdminUserItem has no email field");
  const page = readSource("../app/admin/page.tsx");
  assert.ok(!page.includes("email: row.email"), "admin page does not pass emails to the dashboard");
});

test("admin order buttons are disabled while their server action is in flight (fix #1)", () => {
  // The guard moved with the orders section when the dashboard was
  // split into tabs (2026-11-09): it lives in
  // components/AdminOrders.tsx now, not in the tab shell
  // (app/admin/AdminDashboard.tsx). The behaviour is unchanged.
  const src = readSource("../components/AdminOrders.tsx");
  assert.ok(src.includes("pendingOrderId"), "pending order id is tracked in state");
  assert.ok(src.includes("disabled={pendingOrderId === order.id}"), "buttons disable while pending");
});

test("admin double-click guard is a synchronous ref, not state alone (fix #1 follow-up)", () => {
  const src = readSource("../components/AdminOrders.tsx");
  // 2026-11-08: two clicks in the same task both read stale state
  // (null) and both reached the server, moving two steps — the
  // server's conditional update cannot stop the second one, because
  // "advance from the new status" is legal once the first lands.
  // A ref mutates synchronously, so the second invocation in the
  // same task sees the order in flight and returns first.
  assert.ok(src.includes("pendingOrderIdsRef"), "in-flight ref exists");
  assert.ok(src.includes("useRef<Set<string>>"), "ref holds the in-flight order ids");
  assert.ok(src.includes("pendingOrderIdsRef.current.has(orderId)"), "handler checks the ref before acting");
  assert.ok(src.includes("pendingOrderIdsRef.current.add(orderId)"), "handler claims the order synchronously");
  assert.ok(src.includes("pendingOrderIdsRef.current.delete(orderId)"), "order is released when the action settles");
  assert.ok(src.includes("if (!beginOrderAction(order.id)) return;"), "both handlers go through the ref guard");
  const actions = readSource("../lib/orders/actions.ts");
  assert.ok(
    !actions.includes("A double-clicked Advance can therefore never skip a step"),
    "server comment no longer claims the conditional update alone stops a double-click",
  );
});

test("cancel confirmation survives the order-page remount (fix #3 follow-up)", () => {
  // 2026-11-08: the live cancel succeeded (order cancelled, stock
  // restored, audit row written) but no notice showed — the cancel
  // server action revalidates the order pages and that refresh
  // remounts the order page, wiping the transient notice state
  // (proven with mount-count instrumentation in the browser).
  // The outcome is therefore persisted on the stored order and the
  // notice is derived from it, so the remounted page still shows it.
  const parsed = storedOrderSchema.safeParse(validOrder({ cancelNotice: "live" }));
  assert.equal(parsed.success, true, "cancelNotice: live validates");
  assert.equal(storedOrderSchema.safeParse(validOrder({ cancelNotice: "local" })).success, true);
  assert.equal(storedOrderSchema.safeParse(validOrder({ cancelNotice: "bogus" })).success, false, "other values are rejected");
  assert.equal(
    validateStoredOrders([validOrder()]).length,
    1,
    "orders stored before this field existed still validate (optional)",
  );
  assert.equal(
    validateStoredOrders([validOrder({ cancelNotice: "live" })])[0].cancelNotice,
    "live",
    "the persisted outcome survives validation",
  );
  const page = readSource("../app/orders/[id]/page.tsx");
  assert.ok(page.includes('cancelNotice: "live"'), "live cancel persists its outcome on the stored order");
  assert.ok(page.includes('cancelNotice: "local"'), "local-only cancel persists its outcome too");
  assert.ok(page.includes("order.cancelNotice"), "the notice is derived from the stored order, not only from state");
});

test("audit failures are visible server-side, never swallowed silently (fix #9)", () => {
  const src = readSource("../lib/orders/actions.ts");
  assert.ok(src.includes('console.error("TechShot audit_log insert failed:"'), "audit insert failure is logged server-side");
});

test("customer order page shows cancel only from pending_payment / confirmed (fix #3)", () => {
  const src = readSource("../app/orders/[id]/page.tsx");
  assert.ok(src.includes('const cancellable = ["pending_payment", "confirmed"].includes(order.status);'));
});

test("admin users notice survives the refresh remount (pending notice)", () => {
  // setUserNotice followed by router.refresh() wiped the notice: the
  // refresh remounts the component (same bug class as the 2026-11-08
  // cancel notice, which is why the role-change confirmation never
  // showed). AdminUsers keeps the notice in a module-level variable
  // like ProductManager's pendingSaveNotice, consumed on remount.
  const src = readSource("../components/AdminUsers.tsx");
  assert.match(src, /let pendingUserNotice: string \| null = null;/);
  assert.match(src, /const notice = pendingUserNotice;/);
  assert.match(src, /pendingUserNotice = notice;/);
});

test("review submit shows the review without a refresh remount", () => {
  // The form's router.refresh() remounted the gallery, wiping the
  // thank-you notice and resetting the tab to Description — hiding
  // the review just written, even though the row was saved. The form
  // now hands the saved review to the parent, which appends it from
  // local state; the next navigation loads the server copy.
  const gallery = readSource("../components/ProductGallery.tsx");
  const form = gallery.slice(gallery.indexOf("function ReviewForm"));
  assert.equal(/router\.refresh\(\)/.test(form), false);
  assert.match(form, /onReviewSaved\?\.\(/);
  assert.match(gallery, /function handleReviewSaved/);
  assert.match(gallery, /setShownReviews/);
});
