// Product action helper tests — TechShot.
//
// HONEST SCOPE: lib/products/validation.ts is TypeScript and is
// written for the Next.js app, so this file cannot import it directly
// under `node --test` (Node cannot run .ts). These tests therefore
// test the RULES themselves, implemented here in plain JS from the
// same logic that lives in lib/products/validation.ts. The TypeScript
// implementation MUST match this rule table exactly:
//
//   - slugify: lowercase, non-alphanumerics become "-", runs collapse,
//     leading/trailing "-" trimmed, empty titles become "product".
//   - dedupeSlug: append -2, -3, ... until the slug is not taken.
//   - takaToPoisha: Math.round(taka * 100); 100 poisha = ৳1.
//   - isSafeImagePath: a "/..." storage path is safe; an https URL is
//     safe unless it points at Figma (Figma URLs are temporary and
//     must never be stored as product images); anything else is not.
//   - parseVariantsText: comma-separated "Name:priceTaka:stock";
//     price may be empty (use the product price), stock defaults to 0,
//     malformed entries throw a user-facing error.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

// Rule table, copied from lib/products/validation.ts (same logic, plain JS).
function slugify(title) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "product";
}

function dedupeSlug(base, taken) {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  let n = 2;
  while (takenSet.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function takaToPoisha(taka) {
  return Math.round(taka * 100);
}

function isSafeImagePath(value) {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return !trimmed.includes("..");
  if (/^https:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.toLowerCase().includes("figma")) return false;
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function parseVariantsText(text) {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const variants = [];
  for (const rawEntry of trimmed.split(",")) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    const parts = entry.split(":").map((part) => part.trim());
    const name = parts[0] ?? "";
    if (name === "") {
      throw new Error('Each variant needs a name, e.g. "128GB:89900:10".');
    }
    const priceRaw = parts[1] ?? "";
    const stockRaw = parts[2] ?? "";
    const variant = { name, stock: 0 };
    if (priceRaw !== "") {
      const price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Variant "${name}" has an invalid price. Prices must be ৳0 or more.`);
      }
      variant.priceTaka = price;
    }
    if (stockRaw !== "") {
      const stock = Number(stockRaw);
      if (!Number.isInteger(stock) || stock < 0) {
        throw new Error(`Variant "${name}" has an invalid stock. Stock must be a whole number, 0 or more.`);
      }
      variant.stock = stock;
    }
    variants.push(variant);
  }
  if (variants.length > 20) {
    throw new Error("A product can have at most 20 variants.");
  }
  return variants;
}

test("slugify lowercases and hyphenates a title", () => {
  assert.equal(slugify("Apple iPhone 16 Pro 256GB"), "apple-iphone-16-pro-256gb");
});

test("slugify collapses punctuation and trims dashes", () => {
  assert.equal(slugify("  Sony WH-1000XM5 — Headphones! "), "sony-wh-1000xm5-headphones");
});

test("slugify falls back to product for an empty title", () => {
  assert.equal(slugify("!!!"), "product");
  assert.equal(slugify(""), "product");
});

test("dedupeSlug keeps a free slug unchanged", () => {
  assert.equal(dedupeSlug("jbl-flip-6", ["anker-737-power-bank"]), "jbl-flip-6");
});

test("dedupeSlug appends -2, then -3, when taken", () => {
  assert.equal(dedupeSlug("jbl-flip-6", ["jbl-flip-6"]), "jbl-flip-6-2");
  assert.equal(dedupeSlug("jbl-flip-6", ["jbl-flip-6", "jbl-flip-6-2"]), "jbl-flip-6-3");
});

test("taka converts to poisha at 100 poisha per taka", () => {
  assert.equal(takaToPoisha(1499), 149900);
  assert.equal(takaToPoisha(0), 0);
  assert.equal(takaToPoisha(19.99), 1999);
});

test("a storage path is a safe image path", () => {
  assert.equal(isSafeImagePath("/images/products/jbl-flip-6.jpg"), true);
});

test("an https URL is a safe image path", () => {
  assert.equal(isSafeImagePath("https://example.com/images/jbl-flip-6.jpg"), true);
});

test("a Figma URL is never a safe image path", () => {
  assert.equal(isSafeImagePath("https://www.figma.com/design/abc/image.png"), false);
  assert.equal(isSafeImagePath("https://figma.com/file/xyz"), false);
  assert.equal(isSafeImagePath("https://cdn.figma.com/abc.jpg"), false);
});

test("relative, data and empty image paths are not safe", () => {
  assert.equal(isSafeImagePath("images/jbl-flip-6.jpg"), false);
  assert.equal(isSafeImagePath("data:image/png;base64,abc"), false);
  assert.equal(isSafeImagePath(""), false);
  assert.equal(isSafeImagePath("/images/../secret.jpg"), false);
});

test("parseVariantsText parses Name:price:stock entries", () => {
  assert.deepEqual(parseVariantsText("128GB:89900:10, 256GB:99900:5"), [
    { name: "128GB", priceTaka: 89900, stock: 10 },
    { name: "256GB", priceTaka: 99900, stock: 5 },
  ]);
});

test("parseVariantsText allows an empty price and defaults stock to 0", () => {
  assert.deepEqual(parseVariantsText("Red::20"), [{ name: "Red", stock: 20 }]);
  assert.deepEqual(parseVariantsText("Blue"), [{ name: "Blue", stock: 0 }]);
});

test("parseVariantsText returns an empty list for blank input", () => {
  assert.deepEqual(parseVariantsText(""), []);
  assert.deepEqual(parseVariantsText("   "), []);
});

test("parseVariantsText throws on a negative price or fractional stock", () => {
  assert.throws(() => parseVariantsText("128GB:-5:10"), /invalid price/);
  assert.throws(() => parseVariantsText("128GB:89900:1.5"), /invalid stock/);
  assert.throws(() => parseVariantsText("128GB:89900:-1"), /invalid stock/);
});
