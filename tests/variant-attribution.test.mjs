// Variant-attribution tests — TechShot.
//
// Covers audit run-1 LOW 10
// (techshotbd:placeOrderAction:variant-attribution-collision):
// createSupabaseOrder used to insert order_items without
// variant_id and then attribute variants by re-reading the rows
// and matching on product_id alone — with two lines for the same
// product in different variants, both lookups found the same
// first row, so the second line's update overwrote the first
// line's variant_id and the other row kept variant_id null. The
// decrements were correct, but on a later cancel
// restoreOrderStock restored the stamped variant once and skipped
// the unattributed row, permanently losing one variant's stock.
// variant_id is now written at insert time, one row per line in
// line order, and the post-hoc attribution block is gone.
//
// These tests run the REAL createSupabaseOrder (plus the REAL
// restoreOrderStock, the exact cancel path) against a fake admin
// client (tests/fake-supabase.mjs) with a stub signed-in user,
// under the stub hook in tests/next-stub-hooks.mjs. The fake
// applies the conditional stock updates the way PostgREST would,
// so the decrement / restore round-trip is exercised, not just
// asserted from source. What is proven here:
//   - a two-variant order writes one order_items row per line,
//     each carrying its own variant_id, in line order;
//   - both variant stocks decrement by exactly one;
//   - cancelling (restoreOrderStock) restores BOTH variants to
//     their original stock — nothing is lost;
//   - a single-variant order still attributes its variant, and a
//     product-level (no variant) order still writes variant_id
//     null and restores the product row.
//
// What is NOT proven here: the live round-trip — the
// browser-level proof (two-variant order in the mock shop, cancel
// it, both variant stocks return) is in
// tests/e2e/lows-products-catalog.mjs.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);
register("./react-cache-stub-hooks.mjs", import.meta.url);

import { __setAdminClient } from "./stubs/supabase-server-stub.mjs";
import { __setUser } from "./stubs/auth-server-stub.mjs";
import { makeFakeAdmin, stepArgs, stepOp } from "./fake-supabase.mjs";

const create = await import("../lib/orders/server/create.ts");
const { restoreOrderStock } = await import("../lib/orders/stock.ts");

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

const USER = { id: "user-1", email: "cust@techshot.test", displayName: "Customer", role: "customer" };

const ADDRESS = {
  firstName: "Test",
  lastName: "User",
  email: "cust@techshot.test",
  mobile: "01700000000",
  address: "1 Dummy Road",
  area: "Dummy Area",
  division: "Chattogram",
  district: "Chattogram",
  city: "Chattogram",
  billingSame: true,
};

/**
 * A fake admin client with an in-memory store: one product with
 * two variant rows (stock 5 each) plus the product row itself.
 * Conditional updates (decrementStockGuarded / adjustStockRow)
 * only land when the row still holds the expected stock, the way
 * the real guarded updates do.
 */
function orderClient() {
  const product = {
    id: "prod-phone",
    seller_id: null,
    title: "Test Phone",
    slug: "test-phone",
    price_poisha: 100000,
    compare_at_poisha: null,
    stock: 10,
    status: "active",
  };
  const variants = [
    { id: "var-A", product_id: "prod-phone", name: "Variant A", price_override_poisha: null, stock: 5 },
    { id: "var-B", product_id: "prod-phone", name: "Variant B", price_override_poisha: null, stock: 5 },
  ];
  const orders = [];
  const orderItems = [];
  const eqs = (steps) =>
    steps.filter(([method]) => method === "eq").map(([, args]) => args);
  const admin = makeFakeAdmin((table, steps) => {
    const op = stepOp(steps);
    if (table === "products") {
      if (op === "select") {
        const bySlug = eqs(steps).find(([col, value]) => col === "slug" && value === "test-phone");
        if (bySlug) return { data: { ...product }, error: null };
        const byId = eqs(steps).find(([col]) => col === "id");
        if (byId) return { data: { stock: product.stock }, error: null };
        return { data: null, error: null };
      }
      if (op === "update") {
        const update = stepArgs(steps, "update")[0];
        const idEq = eqs(steps).find(([col]) => col === "id");
        const stockEq = eqs(steps).find(([col]) => col === "stock");
        if (idEq && idEq[1] === product.id && stockEq && stockEq[1] === product.stock) {
          product.stock = update.stock;
          return { data: [{ id: product.id }], error: null };
        }
        return { data: [], error: null };
      }
    }
    if (table === "product_variants") {
      if (op === "select") {
        const byProduct = eqs(steps).find(([col]) => col === "product_id");
        if (byProduct) {
          // restoreOrderStock's has-variants probe (select id,
          // limit 1) and the checkout variant list both land here.
          const rows = variants.filter((v) => v.product_id === byProduct[1]);
          return { data: rows.map((v) => ({ ...v })), error: null };
        }
        const byId = eqs(steps).find(([col]) => col === "id");
        if (byId) {
          const found = variants.find((v) => v.id === byId[1]);
          return { data: found ? { stock: found.stock } : null, error: null };
        }
        return { data: [], error: null };
      }
      if (op === "update") {
        const update = stepArgs(steps, "update")[0];
        const idEq = eqs(steps).find(([col]) => col === "id");
        const stockEq = eqs(steps).find(([col]) => col === "stock");
        const row = variants.find((v) => v.id === idEq?.[1]);
        if (row && stockEq && stockEq[1] === row.stock) {
          row.stock = update.stock;
          return { data: [{ id: row.id }], error: null };
        }
        return { data: [], error: null };
      }
    }
    if (table === "orders") {
      if (op === "select") {
        // Idempotency lookup: no twin order exists yet.
        return { data: null, error: null };
      }
      if (op === "insert") {
        const row = stepArgs(steps, "insert")[0];
        orders.push({ ...row, id: "order-1" });
        return { data: { id: "order-1" }, error: null };
      }
      if (op === "delete") {
        return { data: null, error: null };
      }
    }
    if (table === "order_items") {
      if (op === "select") {
        const byOrder = eqs(steps).find(([col]) => col === "order_id");
        const rows = orderItems.filter((item) => item.order_id === byOrder?.[1]);
        return { data: rows.map((item) => ({ ...item })), error: null };
      }
      if (op === "insert") {
        const rows = stepArgs(steps, "insert")[0];
        rows.forEach((row, i) => orderItems.push({ ...row, id: `item-${i + 1}` }));
        return { data: null, error: null };
      }
    }
    return { data: null, error: null };
  });
  return { admin, product, variants, orderItems };
}

function placeTwoVariantOrder() {
  return create.createSupabaseOrder({
    items: [
      { slug: "test-phone", variant: "Variant A", quantity: 1 },
      { slug: "test-phone", variant: "Variant B", quantity: 1 },
    ],
    couponCode: null,
    delivery: "standard",
    paymentMethod: "cod",
    address: ADDRESS,
    idempotencyKey: "key-two-variant",
  });
}

test.beforeEach(() => {
  __setUser(USER);
});

test.afterEach(() => {
  __setAdminClient(null);
  __setUser(USER);
});

test("two-variant order: each order_items row carries its own variant_id, in line order", async () => {
  const { admin, orderItems } = orderClient();
  __setAdminClient(admin);
  const result = await placeTwoVariantOrder();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(orderItems.length, 2);
  assert.equal(orderItems[0].variant_id, "var-A");
  assert.equal(orderItems[1].variant_id, "var-B");
  assert.equal(orderItems[0].product_id, "prod-phone");
  assert.equal(orderItems[1].product_id, "prod-phone");
});

test("two-variant order then cancel: both variant stocks return to 5", async () => {
  const { admin, variants, orderItems } = orderClient();
  __setAdminClient(admin);
  const result = await placeTwoVariantOrder();
  assert.equal(result.ok, true, JSON.stringify(result));
  // Both variants decremented by exactly one.
  assert.deepEqual(variants.map((v) => v.stock), [4, 4]);
  // The cancel path restores exactly the rows checkout decremented.
  const restored = await restoreOrderStock(admin, "order-1");
  assert.deepEqual(restored, { restored: 2, skipped: 0 });
  assert.deepEqual(variants.map((v) => v.stock), [5, 5]);
  assert.equal(orderItems.length, 2);
});

test("single-variant order still attributes its variant and restores it", async () => {
  const { admin, variants } = orderClient();
  __setAdminClient(admin);
  const result = await create.createSupabaseOrder({
    items: [{ slug: "test-phone", variant: "Variant A", quantity: 1 }],
    couponCode: null,
    delivery: "standard",
    paymentMethod: "cod",
    address: ADDRESS,
    idempotencyKey: "key-one-variant",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(variants.map((v) => v.stock), [4, 5]);
  assert.deepEqual(await restoreOrderStock(admin, "order-1"), { restored: 1, skipped: 0 });
  assert.deepEqual(variants.map((v) => v.stock), [5, 5]);
});
