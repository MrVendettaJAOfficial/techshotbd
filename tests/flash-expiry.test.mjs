// Flash-expiry tests — TechShot.
//
// Covers audit run-1 LOW 12 (techshot:seed:flash-deal-never-expires):
// isFlashDealRow used to return true on the is_flash_deal flag or
// Flash-deals category membership alone, never reading
// flash_ends_at — so the seeded iPhone stayed a flash deal forever
// after its 7-day window passed. The check is now gated on expiry:
// a set flash_ends_at in the past ends the deal on both paths
// (flag and category membership), NULL means no expiry, and an
// unparseable value is treated as no expiry (never hide a live
// deal over a bad date). earliestFlashEndsAt follows automatically
// — it only counts rows isFlashDealRow accepts — so the home-page
// countdown never counts down to an expired deal, and the
// storefront-cache fallback (FLASH_DEAL_ENDS_AT in
// lib/supabase/catalog.ts, used only when no live flash deal
// carries an end time) is untouched.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  earliestFlashEndsAt,
  isFlashDealRow,
  mapDbProductToCatalog,
} from "../lib/catalog-rules.ts";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFileSync(path.join(SOURCE_ROOT, rel), "utf8");

const PAST = new Date(Date.now() - 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function row(overrides = {}) {
  return {
    id: "prod-1",
    category_id: "cat-smartphones",
    category_slug: "smartphones",
    category_slugs: ["smartphones"],
    title: "Apple iPhone 16 Pro 256GB Natural Titanium",
    slug: "apple-iphone-16-pro-256gb-natural-titanium",
    description: "iPhone.",
    price_poisha: 11990000,
    compare_at_poisha: 12990000,
    stock: 12,
    status: "active",
    is_flash_deal: false,
    flash_ends_at: null,
    product_images: [],
    product_variants: [],
    ...overrides,
  };
}

test("expired flag deal is not a flash deal", () => {
  assert.equal(
    isFlashDealRow(row({ is_flash_deal: true, flash_ends_at: PAST })),
    false,
  );
});

test("expired category deal is not a flash deal either", () => {
  assert.equal(
    isFlashDealRow(
      row({
        is_flash_deal: false,
        category_slugs: ["smartphones", "flash-deals"],
        flash_ends_at: PAST,
      }),
    ),
    false,
  );
});

test("live flag deal (future expiry) is still a flash deal", () => {
  assert.equal(
    isFlashDealRow(row({ is_flash_deal: true, flash_ends_at: FUTURE })),
    true,
  );
});

test("live category deal (future expiry) is still a flash deal", () => {
  assert.equal(
    isFlashDealRow(
      row({
        is_flash_deal: false,
        category_slugs: ["smartphones", "flash-deals"],
        flash_ends_at: FUTURE,
      }),
    ),
    true,
  );
});

test("NULL expiry means no expiry: flag and category deals stay live", () => {
  assert.equal(isFlashDealRow(row({ is_flash_deal: true, flash_ends_at: null })), true);
  assert.equal(
    isFlashDealRow(
      row({
        is_flash_deal: false,
        category_slugs: ["smartphones", "flash-deals"],
        flash_ends_at: null,
      }),
    ),
    true,
  );
});

test("missing expiry field is no expiry; an unparseable date is no expiry", () => {
  const noField = row({ is_flash_deal: true });
  delete noField.flash_ends_at;
  assert.equal(isFlashDealRow(noField), true);
  assert.equal(
    isFlashDealRow(row({ is_flash_deal: true, flash_ends_at: "not-a-date" })),
    true,
  );
});

test("neither flag nor membership is still not a flash deal, expired or not", () => {
  assert.equal(isFlashDealRow(row({ flash_ends_at: FUTURE })), false);
  assert.equal(isFlashDealRow(row({ flash_ends_at: PAST })), false);
});

test("mapping: an expired flash deal maps with flash false and no FLASH DEAL badge", () => {
  const mapped = mapDbProductToCatalog(row({ is_flash_deal: true, flash_ends_at: PAST }));
  assert.equal(mapped.flash, false);
  assert.equal(mapped.badge, undefined);
  const live = mapDbProductToCatalog(row({ is_flash_deal: true, flash_ends_at: FUTURE }));
  assert.equal(live.flash, true);
  assert.equal(live.badge, "FLASH DEAL");
});

test("earliestFlashEndsAt skips expired deals and still finds the earliest live one", () => {
  const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [
    row({ is_flash_deal: true, flash_ends_at: PAST }),
    row({ slug: "other-flash", is_flash_deal: true, flash_ends_at: threeDays }),
    row({ slug: "later-flash", is_flash_deal: true, flash_ends_at: FUTURE }),
    row({ slug: "not-flash", is_flash_deal: false, flash_ends_at: FUTURE }),
  ];
  // The earliest live end is the 3-day one, not the expired one.
  assert.equal(earliestFlashEndsAt(rows)?.toISOString(), threeDays);
});

test("earliestFlashEndsAt is undefined when every flash deal expired", () => {
  assert.equal(
    earliestFlashEndsAt([row({ is_flash_deal: true, flash_ends_at: PAST })]),
    undefined,
  );
  assert.equal(earliestFlashEndsAt([]), undefined);
});

test("storefront-cache fallback is untouched: no live end time still falls back to FLASH_DEAL_ENDS_AT", () => {
  const catalog = readSource("lib/supabase/catalog.ts");
  assert.match(
    catalog,
    /flashEndsAt: earliestFlashEndsAt\(publicRows\) \?\? FLASH_DEAL_ENDS_AT/,
  );
});
