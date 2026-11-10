// Admin tabs + status tabs tests — TechShot roles + admin-tabs build.
//
// These tests import the REAL module (components/admin-helpers.ts)
// through the loader registered by tests/register-ts-loader.mjs
// (see package.json "test"); Node 24 strips the erasable TypeScript
// types, so the rules tested here are the exact rules the admin
// dashboard and the customer orders page use — not a stub copy.
//
// What is proven here:
//   - which admin tabs each role sees (Owner all five, co-admin and
//     manager everything except Users, anyone else none);
//     Messages (broadcast announcements, 2026-11-09) is visible to
//     all staff — managers can read the sent messages — but only
//     the Owner and co-admins can SEND one (lib/roles.ts
//     canSendBroadcasts, enforced in the server actions);
//   - the order status tabs are All + the eight statuses, including
//     Returned, and the product status tabs are All + Active /
//     Paused / Draft;
//   - counting and filtering by status, including Returned;
//   - specification rows are cleaned (blank rows dropped, trimmed)
//     before they are saved, so a product with no specs stores none.
//
// The server-enforced parts (role helpers in lib/roles.ts, order
// transitions in lib/orders/transitions.ts, the reviews and stats
// server functions) are covered by their own tests and by the
// Playwright click-through in tests/e2e/.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_TABS,
  ORDER_STATUSES,
  ORDER_STATUS_TABS,
  PRODUCT_STATUS_TABS,
  USER_ROLE_OPTIONS,
  cleanSpecifications,
  countByStatus,
  filterByStatus,
  isAdminTab,
  orderStatusLabel,
  visibleAdminTabs,
} from "../components/admin-helpers.ts";

test("owner sees all five admin tabs", () => {
  assert.deepEqual(visibleAdminTabs("admin"), ["overview", "products", "banners", "orders", "messages", "users"]);
});

test("co-admin and manager see everything except Users", () => {
  assert.deepEqual(visibleAdminTabs("co_admin"), ["overview", "products", "banners", "orders", "messages"]);
  assert.deepEqual(visibleAdminTabs("manager"), ["overview", "products", "banners", "orders", "messages"]);
});

test("customers, legacy sellers and signed-out callers see no admin tabs", () => {
  assert.deepEqual(visibleAdminTabs("customer"), []);
  assert.deepEqual(visibleAdminTabs("seller"), []);
  assert.deepEqual(visibleAdminTabs(null), []);
  assert.deepEqual(visibleAdminTabs(undefined), []);
});

test("admin tab ids are the five known tabs", () => {
  assert.deepEqual(
    ADMIN_TABS.map((tab) => tab.id),
    ["overview", "products", "banners", "orders", "messages", "users"],
  );
  assert.equal(isAdminTab("banners"), true);
  assert.equal(isAdminTab("orders"), true);
  assert.equal(isAdminTab("messages"), true);
  assert.equal(isAdminTab("coupons"), false);
  assert.equal(isAdminTab(null), false);
});

test("order status tabs are All plus the eight statuses, including Returned", () => {
  assert.deepEqual(ORDER_STATUSES, [
    "pending_payment",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "returned",
    "cancelled",
    "refunded",
  ]);
  assert.equal(ORDER_STATUS_TABS.length, 9);
  assert.equal(ORDER_STATUS_TABS[0]?.id, "all");
  assert.deepEqual(
    ORDER_STATUS_TABS.slice(1).map((tab) => tab.id),
    ORDER_STATUSES,
  );
  assert.equal(orderStatusLabel("returned"), "Returned");
  assert.equal(orderStatusLabel("pending_payment"), "Pending payment");
  assert.equal(orderStatusLabel("something-new"), "something-new");
});

test("product status tabs are All plus Active, Paused, Draft", () => {
  assert.deepEqual(
    PRODUCT_STATUS_TABS.map((tab) => tab.id),
    ["all", "active", "paused", "draft"],
  );
});

test("user role options are Owner, Co-admin, Manager, Customer", () => {
  assert.deepEqual(USER_ROLE_OPTIONS, [
    { value: "admin", label: "Owner" },
    { value: "co_admin", label: "Co-admin" },
    { value: "manager", label: "Manager" },
    { value: "customer", label: "Customer" },
  ]);
});

const sampleOrders = [
  { id: "1", status: "pending_payment" },
  { id: "2", status: "confirmed" },
  { id: "3", status: "delivered" },
  { id: "4", status: "returned" },
  { id: "5", status: "returned" },
  { id: "6", status: "cancelled" },
];

test("countByStatus counts each status, including Returned", () => {
  assert.deepEqual(countByStatus(sampleOrders, (order) => order.status), {
    pending_payment: 1,
    confirmed: 1,
    delivered: 1,
    returned: 2,
    cancelled: 1,
  });
  assert.deepEqual(countByStatus([], (order) => order.status), {});
});

test("filterByStatus returns all for 'all' and only the chosen status otherwise", () => {
  assert.deepEqual(
    filterByStatus(sampleOrders, "all", (order) => order.status).map((order) => order.id),
    ["1", "2", "3", "4", "5", "6"],
  );
  assert.deepEqual(
    filterByStatus(sampleOrders, "returned", (order) => order.status).map((order) => order.id),
    ["4", "5"],
  );
  assert.deepEqual(filterByStatus(sampleOrders, "refunded", (order) => order.status), []);
});

test("cleanSpecifications drops blank rows and trims keys and values", () => {
  assert.deepEqual(
    cleanSpecifications([
      { key: " Display ", value: " 6.1-inch OLED " },
      { key: "", value: "has a value but no key" },
      { key: "Battery", value: "" },
      { key: "   ", value: "   " },
    ]),
    [{ key: "Display", value: "6.1-inch OLED" }],
  );
  assert.deepEqual(cleanSpecifications([]), []);
  assert.deepEqual(cleanSpecifications([{ key: "", value: "" }]), []);
});
