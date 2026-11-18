// Second-order review tests — TechShot.
//
// Covers audit run-1 LOW 13
// (techshot/reviews/submitReview-first-delivered-order-already-reviewed):
// submitReview picked the FIRST delivered order containing the
// product with Array.find and inserted the review against it — so
// a repeat buyer with two delivered orders for the same product,
// who already reviewed via the first, was told "You have already
// reviewed this product for this order" even though the second,
// unreviewed order still entitled them to a review. submitReview
// now excludes already-reviewed delivered orders before picking
// one, and only reports "already reviewed" when no eligible
// delivered order remains. The sibling path
// (submitSupabaseReview in lib/orders/server/reviews.ts) reviews
// ONE caller-chosen order, so there is nothing to re-pick there —
// but its unique-constraint collision (23505) used to surface as
// a generic failure; it now reports the same already-reviewed
// message.
//
// These tests run the REAL actions against fake clients
// (tests/fake-supabase.mjs) with a stub signed-in user, under the
// stub hook in tests/next-stub-hooks.mjs. What is proven here:
//   - with two delivered orders and the first already reviewed,
//     the review is inserted against the second order;
//   - with the first unreviewed, it is picked as before;
//   - with every delivered order already reviewed, the caller
//     gets the already-reviewed message and nothing is inserted;
//   - with no delivered order, the delivered-only message stands;
//   - submitSupabaseReview maps a 23505 on its chosen order to
//     the already-reviewed message, and still succeeds on a fresh
//     order.
//
// What is NOT proven here: the live round-trip — the
// browser-level proof (seeded delivered orders + one review, a
// second review through the product page succeeds) is in
// tests/e2e/lows-products-catalog.mjs.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);
register("./react-cache-stub-hooks.mjs", import.meta.url);

import { __setAdminClient, __setPublicClient } from "./stubs/supabase-server-stub.mjs";
import { __setUser } from "./stubs/auth-server-stub.mjs";
import { makeFakeAdmin, stepArgs, stepOp } from "./fake-supabase.mjs";

const reviews = await import("../lib/reviews.ts");
const orderReviews = await import("../lib/orders/server/reviews.ts");

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

const USER = { id: "user-1", email: "cust@techshot.test", displayName: "Customer", role: "customer" };
const PRODUCT_ID = "prod-1";
const PRODUCT_SLUG = "iphone-slug";

function deliveredOrder(id) {
  return { id, order_items: [{ product_id: PRODUCT_ID }] };
}

function reviewClients({
  deliveredOrders = [deliveredOrder("ord-A"), deliveredOrder("ord-B")],
  existingReviews = [],
  failInsertCode = null,
} = {}) {
  const inserted = [];
  const pub = makeFakeAdmin((table, steps) => {
    const op = stepOp(steps);
    if (table === "orders") {
      if (op === "select") {
        // submitReview: plain select of all delivered orders.
        if (!steps.some(([method]) => method === "maybeSingle")) {
          return { data: deliveredOrders, error: null };
        }
        // submitSupabaseReview: one order by id.
        const id = stepArgs(steps, "eq")[1];
        const found = deliveredOrders.find((order) => order.id === id) ?? null;
        return { data: found, error: null };
      }
    }
    if (table === "reviews") {
      if (op === "select") return { data: existingReviews, error: null };
      if (op === "insert") {
        const row = stepArgs(steps, "insert")[0];
        if (failInsertCode) return { data: null, error: { code: failInsertCode } };
        inserted.push(row);
        return { data: [row], error: null };
      }
    }
    return { data: null, error: null };
  });
  pub.auth = {
    getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
  };
  const admin = makeFakeAdmin((table, steps) => {
    if (table === "products") {
      // resolveProductId (lib/reviews.ts): by id first, then slug.
      // resolveDbProduct (orders/server/shared.ts): slug + active.
      const eqs = steps.filter(([method]) => method === "eq").map(([, args]) => args);
      const bySlug = eqs.find(([col, value]) => col === "slug" && value === PRODUCT_SLUG);
      if (bySlug) return { data: { id: PRODUCT_ID }, error: null };
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
  return { pub, admin, inserted };
}

test.beforeEach(() => {
  __setUser(USER);
});

test.afterEach(() => {
  __setAdminClient(null);
  __setPublicClient(null);
  __setUser(USER);
});

test("submitReview uses the second delivered order when the first is already reviewed", async () => {
  const { pub, admin, inserted } = reviewClients({
    existingReviews: [{ order_id: "ord-A" }],
  });
  __setPublicClient(pub);
  __setAdminClient(admin);
  assert.deepEqual(await reviews.submitReview(PRODUCT_SLUG, 5, "Great phone."), { ok: true });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].order_id, "ord-B");
  assert.equal(inserted[0].product_id, PRODUCT_ID);
  assert.equal(inserted[0].user_id, "user-1");
});

test("submitReview picks the first delivered order when it is unreviewed", async () => {
  const { pub, admin, inserted } = reviewClients({ existingReviews: [] });
  __setPublicClient(pub);
  __setAdminClient(admin);
  assert.deepEqual(await reviews.submitReview(PRODUCT_SLUG, 4, "Good."), { ok: true });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].order_id, "ord-A");
});

test("submitReview reports already-reviewed only when every delivered order is reviewed", async () => {
  const { pub, admin, inserted } = reviewClients({
    existingReviews: [{ order_id: "ord-A" }, { order_id: "ord-B" }],
  });
  __setPublicClient(pub);
  __setAdminClient(admin);
  assert.deepEqual(await reviews.submitReview(PRODUCT_SLUG, 5, "Again."), {
    ok: false,
    message: "You have already reviewed this product for this order.",
  });
  assert.equal(inserted.length, 0);
});

test("submitReview still requires a delivered order containing the product", async () => {
  const { pub, admin, inserted } = reviewClients({ deliveredOrders: [] });
  __setPublicClient(pub);
  __setAdminClient(admin);
  assert.deepEqual(await reviews.submitReview(PRODUCT_SLUG, 5, "No order."), {
    ok: false,
    message: "You can only review products from a delivered order.",
  });
  assert.equal(inserted.length, 0);
});

test("submitSupabaseReview maps a 23505 on its chosen order to the already-reviewed message", async () => {
  const { pub, admin, inserted } = reviewClients({ failInsertCode: "23505" });
  __setPublicClient(pub);
  __setAdminClient(admin);
  assert.deepEqual(
    await orderReviews.submitSupabaseReview({
      productSlug: PRODUCT_SLUG,
      orderId: "ord-A",
      rating: 5,
      text: "Again.",
    }),
    { ok: false, message: "You have already reviewed this product for this order." },
  );
  assert.equal(inserted.length, 0);
});

test("submitSupabaseReview succeeds on a fresh delivered order", async () => {
  const { pub, admin, inserted } = reviewClients({});
  __setPublicClient(pub);
  __setAdminClient(admin);
  assert.deepEqual(
    await orderReviews.submitSupabaseReview({
      productSlug: PRODUCT_SLUG,
      orderId: "ord-A",
      rating: 5,
      text: "Great phone.",
    }),
    { ok: true },
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].order_id, "ord-A");
});
