// Warranty + specifications validation tests — TechShot.
//
// These tests import the REAL module (lib/products/validation.ts)
// through the loader registered by tests/register-ts-loader.mjs
// (see package.json "test"); Node 24 strips the erasable TypeScript
// types, so the rules tested here are the exact rules the product
// server actions in lib/products/actions.ts enforce — not a stub copy.
//
// What is proven here:
//   - warranty is free text, at most 200 characters, trimmed, and
//     optional (an absent / empty warranty parses to "");
//   - specifications are key/value pairs, each key trimmed (at most
//     80 characters) and each value trimmed (at most 200), at most
//     30 entries, and duplicate keys — compared trimmed and
//     case-insensitively — are rejected;
//   - a product without warranty / specifications still parses
//     (both default), so older callers keep working.
//
// The server actions themselves (Supabase writes of
// products.warranty / products.specifications) are not runnable
// under `node --test` — they need a signed-in staff session and a
// database — so they are covered by the Playwright click-through in
// tests/e2e/ and by live testing against the TechshotBD project
// (see README).
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import { productInputSchema } from "../lib/products/validation.ts";

function validInput(overrides = {}) {
  return {
    title: "Test Phone",
    categorySlug: "smartphones",
    description: "A test product.",
    priceTaka: 1000,
    stock: 5,
    status: "active",
    ...overrides,
  };
}

test("warranty accepts free text up to 200 characters", () => {
  const parsed = productInputSchema.safeParse(
    validInput({ warranty: "1 year official warranty" }),
  );
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.warranty, "1 year official warranty");
});

test("warranty is trimmed and rejects text over 200 characters", () => {
  const parsed = productInputSchema.safeParse(validInput({ warranty: "  2 years  " }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.warranty, "2 years");
  const tooLong = productInputSchema.safeParse(validInput({ warranty: "x".repeat(201) }));
  assert.equal(tooLong.success, false);
});

test("warranty and specifications default when absent", () => {
  const parsed = productInputSchema.safeParse(validInput());
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.warranty, "");
  assert.deepEqual(parsed.data.specifications, []);
});

test("specifications accept trimmed key/value pairs", () => {
  const parsed = productInputSchema.safeParse(
    validInput({
      specifications: [
        { key: "  Display  ", value: '  6.3" OLED  ' },
        { key: "Battery", value: "5,000 mAh" },
      ],
    }),
  );
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.specifications, [
    { key: "Display", value: '6.3" OLED' },
    { key: "Battery", value: "5,000 mAh" },
  ]);
});

test("specifications reject a key over 80 or a value over 200 characters", () => {
  assert.equal(
    productInputSchema.safeParse(
      validInput({ specifications: [{ key: "k".repeat(81), value: "v" }] }),
    ).success,
    false,
  );
  assert.equal(
    productInputSchema.safeParse(
      validInput({ specifications: [{ key: "k", value: "v".repeat(201) }] }),
    ).success,
    false,
  );
});

test("specifications reject an empty key", () => {
  assert.equal(
    productInputSchema.safeParse(validInput({ specifications: [{ key: "   ", value: "v" }] }))
      .success,
    false,
  );
});

test("specifications reject duplicate keys, even with different case or spacing", () => {
  assert.equal(
    productInputSchema.safeParse(
      validInput({
        specifications: [
          { key: "Display", value: "OLED" },
          { key: "display", value: "LCD" },
        ],
      }),
    ).success,
    false,
  );
  assert.equal(
    productInputSchema.safeParse(
      validInput({
        specifications: [
          { key: "Display", value: "OLED" },
          { key: "  Display ", value: "LCD" },
        ],
      }),
    ).success,
    false,
  );
});

test("specifications reject more than 30 entries", () => {
  const specs = Array.from({ length: 31 }, (_, i) => ({ key: `Spec ${i}`, value: "v" }));
  assert.equal(productInputSchema.safeParse(validInput({ specifications: specs })).success, false);
  const thirty = Array.from({ length: 30 }, (_, i) => ({ key: `Spec ${i}`, value: "v" }));
  assert.equal(productInputSchema.safeParse(validInput({ specifications: thirty })).success, true);
});
