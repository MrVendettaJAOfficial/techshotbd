// Product form required price/stock tests — TechShot.
//
// Covers the 2026-11-16 fix for Ponytail review finding #9:
// components/product-manager/product-form.tsx sent
// Number(priceTaka) / Number(stock) to the server action, and
// Number("") is 0 while the server schema allows 0 — so a price
// or stock box cleared by mistake saved the product live at ৳0 /
// 0. The check belongs in the form (the server cannot tell an
// empty field from a deliberate ৳0), so the pure rule lives in
// components/product-manager/helpers.ts
// (validateRequiredPriceAndStock) and the form calls it before
// the server action.
//
// These tests import the REAL helper (components/product-manager/
// helpers.ts) under the TS loader, and assert the form wires it
// in before any save. What is proven here:
//   - an empty or whitespace-only price is rejected with the
//     form's error message;
//   - an empty or whitespace-only stock is rejected the same way;
//   - price is checked before stock (the first empty field wins);
//   - a deliberately typed "0" for price and stock is allowed —
//     an explicit zero still saves as ৳0 / 0;
//   - the form calls the validator in handleSubmit before
//     createProduct / updateProduct.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRequiredPriceAndStock } from "../components/product-manager/helpers.ts";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const formSource = readFileSync(path.join(SOURCE_ROOT, "components/product-manager/product-form.tsx"), "utf8");

test("an empty price is rejected", () => {
  assert.equal(validateRequiredPriceAndStock("", "5"), "Enter a price (৳) before saving.");
});

test("a whitespace-only price is rejected", () => {
  assert.equal(validateRequiredPriceAndStock("   ", "5"), "Enter a price (৳) before saving.");
});

test("an empty stock is rejected", () => {
  assert.equal(validateRequiredPriceAndStock("1499", ""), "Enter the stock quantity before saving.");
});

test("a whitespace-only stock is rejected", () => {
  assert.equal(validateRequiredPriceAndStock("1499", "  "), "Enter the stock quantity before saving.");
});

test("price is checked before stock", () => {
  assert.equal(validateRequiredPriceAndStock("", ""), "Enter a price (৳) before saving.");
});

test("a deliberately typed 0 for price and stock is allowed", () => {
  assert.equal(validateRequiredPriceAndStock("0", "0"), null);
});

test("ordinary values pass", () => {
  assert.equal(validateRequiredPriceAndStock("1499", "25"), null);
});

test("the form calls the validator in handleSubmit before any save", () => {
  const submit = formSource.slice(formSource.indexOf("async function handleSubmit"));
  const checkAt = submit.indexOf("validateRequiredPriceAndStock(priceTaka, stock)");
  assert.notEqual(checkAt, -1, "handleSubmit must call validateRequiredPriceAndStock");
  const createAt = submit.indexOf("createProduct(input)");
  const updateAt = submit.indexOf("updateProduct(editingId, input)");
  assert.ok(checkAt < createAt, "the price/stock check must run before createProduct");
  assert.ok(checkAt < updateAt, "the price/stock check must run before updateProduct");
  assert.match(submit, /if \(requiredError\) \{\s*setFormError\(requiredError\);\s*return;\s*\}/);
});
