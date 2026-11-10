// Green buttons + hero carousel + flash deals + multi-category tests — TechShot.
//
// 2026-11-10: the user asked for green buttons and highlights
// throughout the site, no duplicate links in the navbar/footer,
// minimal borders on every card, a restrained admin-managed hero
// banner carousel, a fixed flash-deal section, and products in
// multiple categories (ticking "Flash deals" puts a product in the
// flash section). This file pins those rules down in source:
// green is the button/link colour (never white text on the full
// green), the navbar is the only place for category links, every
// card surface carries the 1px border, the carousel falls back to
// product slides when no banner is active, banner photos crop to
// the wide 1600 x 640 strip, flash deals come from the Flash deals
// category OR the legacy flag, and the product form writes the
// join table (migrations 0011 + 0012 — written, NOT applied live).
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  BANNER_CTA_LABEL_MAX,
  BANNER_HEADLINE_MAX,
  BANNER_IMAGE_HEIGHT_PX,
  BANNER_IMAGE_SIZE_NOTE,
  BANNER_IMAGE_WIDTH_PX,
  bannerImageSrc,
  sortBanners,
  validateBannerInput,
} from "../lib/banners.ts";
import { processBannerImage } from "../lib/banners/process-banner-image.ts";
import {
  bannerToSlide,
  fallbackSlides,
  productToFallbackSlide,
} from "../lib/hero-slides.ts";
import { canManageBanners } from "../lib/roles.ts";
import {
  FLASH_DEALS_SLUG,
  categorySlugsForRow,
  earliestFlashEndsAt,
  isFlashDealRow,
  mapDbProductToCatalog,
  relatedProducts,
} from "../lib/catalog-rules.ts";
import { PRODUCTS, CATEGORIES } from "../lib/data/catalog.ts";
import { productInputSchema } from "../lib/products/validation/schema.ts";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFileSync(path.join(SOURCE_ROOT, rel), "utf8");

// Strip // line comments so prose in a header comment (which may
// name an old value for the record) cannot trip a code scan.
function codeOnly(src) {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function sourceFiles(relDir) {
  const base = path.join(SOURCE_ROOT, relDir);
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?)$/.test(entry)) out.push(full);
    }
  })(base);
  return out;
}

// WCAG relative luminance + contrast ratio, same maths as the
// contrast calls recorded in lib/theme.ts.
function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

async function makeImage(width, height, format) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 120, b: 90 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

async function dimensions(buffer) {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

// ---------------------------------------------------------------------------
// Green buttons + highlights.
// ---------------------------------------------------------------------------

test("green buttons: solid buttons are brandDark, never white on full green", () => {
  // The shared Button primary variant (components/ui.tsx).
  assert.match(
    readSource("components/ui.tsx"),
    /primary: "bg-brandDark text-white hover:bg-brandDarker disabled:bg-brandDark\/50"/,
  );
  // White text on brandDark passes AA; white text on the full green
  // fails, so no solid button ever uses bg-brand.
  assert.ok(contrast("#FFFFFF", "#0B7A55") >= 4.5, "white on brandDark button");
  assert.ok(contrast("#FFFFFF", "#096B49") >= 4.5, "white on brandDarker hover");
  assert.ok(contrast("#FFFFFF", "#0F9A70") < 4.5, "white on full green fails");
  // No element may carry both the bare bg-brand token and
  // text-white in one static className literal (the tint bg-brand/15
  // with brandDark text is fine, and stays — it is a highlight, not
  // a button).
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/className="([^"]+)"/g)) {
      const tokens = m[1].split(/\s+/);
      assert.ok(
        !(tokens.includes("bg-brand") && tokens.includes("text-white")),
        `${file} puts white text on the full green: ${m[1]}`,
      );
    }
    assert.doesNotMatch(src, /"bg-brand text-white/, `${file} has a full-green button`);
  }
});

test("green highlights: links and green text on light are brandDark", () => {
  assert.ok(contrast("#0B7A55", "#FFFFFF") >= 4.5, "brandDark link text on white");
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, /\btext-brand(?![A-Za-z])/, `${file} uses full green as resting text`);
  }
  // The theme says so too.
  assert.match(readSource("lib/theme.ts"), /Primary buttons are bg-brandDark with white text/);
  assert.match(readSource("lib/theme.ts"), /no solid button ever uses bg-brand/);
});

test("navy stays chrome-only: header and footer backgrounds, not buttons", () => {
  assert.match(readSource("components/Header.tsx"), /className="border-b border-border bg-ink"/);
  assert.match(readSource("components/Footer.tsx"), /<footer className="border-t border-border bg-ink">/);
  assert.doesNotMatch(
    codeOnly(readSource("components/ui.tsx")),
    /primary: "bg-ink/,
  );
});

// ---------------------------------------------------------------------------
// No duplicate links in the navbar / footer chrome.
// ---------------------------------------------------------------------------

function navLinks() {
  // The NAV_LINKS array in components/MobileNavDrawer.tsx drives
  // both the header nav row and the mobile drawer.
  const src = readSource("components/MobileNavDrawer.tsx");
  const block = src.slice(src.indexOf("export const NAV_LINKS"), src.indexOf("];", src.indexOf("export const NAV_LINKS")));
  const hrefs = [...block.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  const labels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  return { hrefs, labels };
}

function footerLinks() {
  const src = readSource("components/Footer.tsx");
  const hrefs = [];
  for (const name of ["HELP_LINKS", "TECHSHOT_LINKS"]) {
    const start = src.indexOf(`const ${name}`);
    if (start === -1) continue;
    const block = src.slice(start, src.indexOf("];", start));
    for (const m of block.matchAll(/href: "([^"]+)"/g)) hrefs.push(m[1]);
  }
  return hrefs;
}

test("nav/footer duplicate audit: each destination is linked once in the chrome", () => {
  const nav = navLinks();
  const footer = footerLinks();
  // No destination twice inside the navbar itself.
  assert.equal(new Set(nav.hrefs).size, nav.hrefs.length, `navbar links repeat: ${nav.hrefs}`);
  // The removed duplicate: "Shop all" linked to /shop, the same
  // destination as "All categories" — it is gone from the navbar.
  assert.ok(!nav.labels.includes("Shop all"), "navbar still has the duplicate Shop all link");
  assert.ok(nav.labels.includes("All categories"), "navbar lost All categories");
  assert.ok(nav.labels.includes("Flash deals"), "navbar lost Flash deals");
  // No destination in both the navbar and the footer.
  const shared = nav.hrefs.filter((href) => footer.includes(href));
  assert.deepEqual(shared, [], `linked in both navbar and footer: ${shared}`);
  // The footer keeps only what the navbar does NOT carry: account /
  // orders / cart / checkout + admin. The old Discover group (Shop
  // all, Smartphones, Laptops, Audio, Gaming, Flash deals) is gone.
  assert.ok(!readSource("components/Footer.tsx").includes("DISCOVER_LINKS"), "footer still has the Discover group");
  for (const href of ["/account", "/orders", "/cart", "/checkout", "/admin"]) {
    assert.ok(footer.includes(href), `footer lost ${href}`);
  }
});

// ---------------------------------------------------------------------------
// Minimal card borders: every card surface carries the 1px border.
// ---------------------------------------------------------------------------

test("card borders: every card surface has the 1px border-border", () => {
  // Each file below renders a card surface: it must carry the
  // border class itself, or render the shared Card from ui.tsx
  // (which carries it) — never a bare bg-panel/bg-card surface.
  const cardFiles = [
    "components/ProductCard.tsx",
    "components/ui.tsx",
    "app/page.tsx",
    "components/order-detail/timeline.tsx",
    "components/order-detail/items.tsx",
    "components/account/orders-section.tsx",
    "components/account/addresses-section.tsx",
    "components/admin-orders/orders-list.tsx",
    "app/cart/page.tsx",
    "components/cart/cart-summary.tsx",
    "components/checkout/address-step.tsx",
    "components/checkout/checkout-form.tsx",
    "components/AdminUsers.tsx",
    "components/admin/banners-section.tsx",
    "components/admin/messages-section.tsx",
    "components/product-manager/product-list.tsx",
    "components/product-manager/product-form.tsx",
  ];
  for (const rel of cardFiles) {
    const src = codeOnly(readSource(rel));
    const hasBorder = src.includes("border-border") || src.includes("<Card");
    assert.ok(hasBorder, `${rel} renders a card without the 1px border or the shared Card`);
  }
  // The shared Card itself pins the border.
  assert.match(readSource("components/ui.tsx"), /rounded-2xl border border-border bg-panel/);
  // Flash cards use the same ProductCard (220px thumbs), so their
  // border comes from ProductCard.
  assert.match(readSource("components/ProductCard.tsx"), /border border-border/);
});

// ---------------------------------------------------------------------------
// Hero carousel + fallback slides.
// ---------------------------------------------------------------------------

test("hero carousel exists with the gallery's behaviour and a restrained height", () => {
  assert.equal(readSource("components/HeroCarousel.tsx").includes("export function HeroCarousel"), true);
  const carousel = readSource("components/HeroCarousel.tsx");
  // Same carousel language as the gallery: auto-slide on desktop
  // only, pause on hover/focus/hidden/reduced-motion, arrows on
  // hover, dots + counter, swipe on touch, keyboard arrows.
  assert.match(carousel, /GALLERY_AUTO_SLIDE_MS/);
  assert.match(carousel, /canHover/);
  assert.match(carousel, /prefers-reduced-motion/);
  assert.match(carousel, /swipeDirection/);
  assert.match(carousel, /data-testid="hero-prev"/);
  assert.match(carousel, /data-testid="hero-next"/);
  assert.match(carousel, /hero-dot-/);
  assert.match(carousel, /data-testid="hero-counter"/);
  assert.match(carousel, /data-testid="hero-cta"/);
  // Restrained: 380px tall on desktop, never full-viewport.
  assert.match(carousel, /lg:h-\[380px\]/);
  assert.doesNotMatch(carousel, /h-screen|min-h-screen/);
  // A slide with no image shows the logo placeholder, never blank.
  assert.match(carousel, /<ProductPlaceholder/);
  // The home page renders the carousel, not the old static hero.
  const page = readSource("app/page.tsx");
  assert.match(page, /<HeroCarousel slides=\{heroSlides\} \/>/);
  assert.doesNotMatch(page, /01 \/ 03/);
  assert.match(page, /listActiveBanners/);
  assert.match(page, /fallbackSlides/);
});

test("fallback slides come from the top three products", () => {
  const slides = fallbackSlides(PRODUCTS, (slug) => slug);
  assert.equal(slides.length, 3);
  assert.equal(slides[0].headline, PRODUCTS[0].title);
  assert.equal(slides[0].ctaHref, `/product/${PRODUCTS[0].slug}`);
  assert.equal(slides[0].ctaLabel, "Shop now");
  assert.ok(slides[0].priceChip?.includes("৳"), "fallback slide carries a price chip");
  const single = productToFallbackSlide(PRODUCTS[0], "Smartphones");
  assert.equal(single.eyebrow, "Smartphones");
  assert.equal(single.image, PRODUCTS[0].image);
});

test("banner slides carry the banner's own text and link", () => {
  const slide = bannerToSlide(
    {
      id: "b1",
      imagePath: "banner-sale.jpg",
      headline: "Eid Mega Sale",
      subcopy: "Up to 40% off",
      ctaLabel: "Shop the sale",
      ctaHref: "/shop?category=gaming",
      sortOrder: 0,
      active: true,
      createdAt: "2026-11-10T00:00:00.000Z",
    },
  );
  assert.equal(slide.headline, "Eid Mega Sale");
  assert.equal(slide.subcopy, "Up to 40% off");
  assert.equal(slide.ctaLabel, "Shop the sale");
  assert.equal(slide.ctaHref, "/shop?category=gaming");
  assert.equal(slide.eyebrow, "TechShot");
  assert.equal(slide.priceChip, undefined);
});

// ---------------------------------------------------------------------------
// Banners: rules, sizes, crop, permissions.
// ---------------------------------------------------------------------------

test("banner rules: validation, limits and the safe link rule", () => {
  assert.equal(BANNER_HEADLINE_MAX, 120);
  assert.equal(BANNER_CTA_LABEL_MAX, 40);
  const ok = validateBannerInput({
    imagePath: "",
    headline: "Eid Mega Sale",
    subcopy: "Up to 40% off",
    ctaLabel: "Shop now",
    ctaHref: "/shop",
    sortOrder: 0,
    active: true,
  });
  assert.equal(ok.ok, true);
  // An empty link defaults to /shop; an empty image is fine (the
  // carousel shows the logo placeholder).
  if (ok.ok) assert.equal(ok.value.ctaHref, "/shop");
  assert.equal(validateBannerInput({ imagePath: "", headline: "", subcopy: "", ctaLabel: "", ctaHref: "/shop", sortOrder: 0, active: true }).ok, false);
  assert.equal(validateBannerInput({ imagePath: "", headline: "x".repeat(121), subcopy: "", ctaLabel: "", ctaHref: "/shop", sortOrder: 0, active: true }).ok, false);
  assert.equal(validateBannerInput({ imagePath: "", headline: "Sale", subcopy: "", ctaLabel: "", ctaHref: "https://evil.example", sortOrder: 0, active: true }).ok, false);
  assert.equal(validateBannerInput({ imagePath: "", headline: "Sale", subcopy: "", ctaLabel: "", ctaHref: "//evil.example", sortOrder: 0, active: true }).ok, false);
  assert.equal(validateBannerInput({ imagePath: "", headline: "Sale", subcopy: "", ctaLabel: "", ctaHref: "/shop", sortOrder: -1, active: true }).ok, false);
  // Sort order is lowest first, ties by created_at.
  const sorted = sortBanners([
    { id: "a", imagePath: "", headline: "B", subcopy: "", ctaLabel: "", ctaHref: "/shop", sortOrder: 1, active: true, createdAt: "2026-11-10T00:00:00.000Z" },
    { id: "b", imagePath: "", headline: "A", subcopy: "", ctaLabel: "", ctaHref: "/shop", sortOrder: 0, active: true, createdAt: "2026-11-10T00:00:00.000Z" },
  ]);
  assert.deepEqual(sorted.map((b) => b.id), ["b", "a"]);
  // No photo resolves to "" (the placeholder), a filename to a URL.
  assert.equal(bannerImageSrc({ imagePath: "" }), "");
  assert.ok(bannerImageSrc({ imagePath: "banner-sale.jpg" }).endsWith("banner-sale.jpg"));
});

test("banner image size is 1600 x 640 (wide, not the product square)", () => {
  assert.equal(BANNER_IMAGE_WIDTH_PX, 1600);
  assert.equal(BANNER_IMAGE_HEIGHT_PX, 640);
  assert.equal(
    BANNER_IMAGE_SIZE_NOTE,
    "Recommended size: 1600 x 640 px (wide). Larger images are cropped to this size automatically.",
  );
  // 1600 / 640 are defined in exactly one place each (the
  // constants): the crop, the note and the form all read the
  // constants, so the display size, the upload crop and the admin
  // warning can never drift apart. (The JSDoc above the constants
  // names the size in words — that prose is not a definition.)
  assert.equal(
    (readSource("lib/banners.ts").match(/export const BANNER_IMAGE_WIDTH_PX = 1600;/g) ?? []).length,
    1,
  );
  assert.equal(
    (readSource("lib/banners.ts").match(/export const BANNER_IMAGE_HEIGHT_PX = 640;/g) ?? []).length,
    1,
  );
  assert.match(readSource("lib/banners.ts"), /BANNER_IMAGE_SIZE_NOTE = `Recommended size: \$\{BANNER_IMAGE_WIDTH_PX\} x \$\{BANNER_IMAGE_HEIGHT_PX\}/);
  assert.match(readSource("components/admin/banners-section.tsx"), /BANNER_IMAGE_SIZE_NOTE/);
  assert.match(readSource("components/admin/banners-section.tsx"), /data-testid="banner-image-size-note"/);
});

test("banner photo crop: larger photos come out exactly 1600 x 640, small ones are kept", async () => {
  const wide = await processBannerImage(await makeImage(2000, 1000, "jpeg"), "image/jpeg");
  assert.deepEqual(await dimensions(wide.buffer), { width: 1600, height: 640, format: "jpeg" });
  assert.equal(wide.contentType, "image/jpeg");
  const tall = await processBannerImage(await makeImage(800, 2000, "png"), "image/png");
  assert.deepEqual(await dimensions(tall.buffer), { width: 1600, height: 640, format: "png" });
  // Smaller than the target in BOTH dimensions: kept as-is, never upscaled.
  const small = await makeImage(400, 200, "jpeg");
  const kept = await processBannerImage(small, "image/jpeg");
  assert.equal(kept.buffer.equals(small), true);
  assert.deepEqual(await dimensions(kept.buffer), { width: 400, height: 200, format: "jpeg" });
  // Unknown content types are rejected.
  await assert.rejects(processBannerImage(await makeImage(100, 100, "jpeg"), "image/gif"));
});

test("banner permissions: any staff role may manage banners, customers may not", () => {
  assert.equal(canManageBanners("admin"), true);
  assert.equal(canManageBanners("co_admin"), true);
  assert.equal(canManageBanners("manager"), true);
  assert.equal(canManageBanners("customer"), false);
  assert.equal(canManageBanners(null), false);
  assert.match(readSource("lib/banners-server.ts"), /canManageBanners/);
  assert.match(readSource("components/admin/banners-section.tsx"), /canManage/);
});

// ---------------------------------------------------------------------------
// Flash deals + multi-category.
// ---------------------------------------------------------------------------

test("flash deals: category membership OR the legacy flag", () => {
  assert.equal(FLASH_DEALS_SLUG, "flash-deals");
  // Tagged by category only (flag false): still a flash deal.
  assert.equal(
    isFlashDealRow({ category_slug: "audio", category_slugs: ["audio", "flash-deals"], is_flash_deal: false }),
    true,
  );
  // Flagged only (no join rows): still a flash deal (backwards compat).
  assert.equal(
    isFlashDealRow({ category_slug: "smartphones", category_slugs: ["smartphones"], is_flash_deal: true }),
    true,
  );
  // Neither: not a flash deal.
  assert.equal(
    isFlashDealRow({ category_slug: "audio", category_slugs: ["audio"], is_flash_deal: false }),
    false,
  );
});

test("flash section: the stock line is said once, not twice", () => {
  // ProductCard already renders "Selling fast · N left" under the
  // price when stock is 12 or fewer — the flash section's cell
  // must not repeat that sentence below the card, or every
  // low-stock flash product shows it twice. The cell keeps only
  // the visual stock meter (h-2 bar), pinned to the cell bottom
  // by the flex column so the meters line up across the row.
  const page = readSource("app/page.tsx");
  const flashCell = page.split("flashProducts.map((product) => (")[1].split("))}")[0];
  // No rendered stock sentence in the cell (the comment above the
  // cell may name the phrase in words — that is not rendered text,
  // so this matches the template expression, not the phrase).
  assert.doesNotMatch(flashCell, /Selling fast · \{product\.stock\}/);
  assert.match(flashCell, /h-2 overflow-hidden rounded-full bg-border/);
  assert.match(flashCell, /flex h-full flex-col/);
  assert.match(readSource("components/ProductCard.tsx"), /Selling fast · \{product\.stock\} left/);
});

test("mapping: categorySlugs put the primary first and keep flash-by-category", () => {
  const row = {
    id: "prod-1",
    category_id: "cat-audio",
    category_slug: "audio",
    category_slugs: ["audio", "flash-deals"],
    title: "Sony WH-1000XM5",
    slug: "sony-wh-1000xm5",
    description: "Headphones.",
    price_poisha: 2499000,
    compare_at_poisha: 2999000,
    stock: 18,
    status: "active",
    is_flash_deal: false,
    flash_ends_at: null,
    product_images: [],
    product_variants: [],
  };
  const mapped = mapDbProductToCatalog(row);
  assert.deepEqual(mapped.categorySlugs, ["audio", "flash-deals"]);
  assert.equal(mapped.category, "audio");
  assert.equal(mapped.flash, true);
  assert.equal(mapped.badge, "FLASH DEAL");
  // No join rows: exactly the primary.
  const plain = mapDbProductToCatalog({ ...row, category_slugs: [], is_flash_deal: false });
  assert.deepEqual(plain.categorySlugs, ["audio"]);
  assert.equal(plain.flash, false);
  // Duplicate slugs are deduplicated, primary stays first.
  assert.deepEqual(categorySlugsForRow({ category_slug: "audio", category_slugs: ["flash-deals", "audio"] }), [
    "audio",
    "flash-deals",
  ]);
});

test("earliestFlashEndsAt counts a flash deal tagged by category", () => {
  const ends = earliestFlashEndsAt([
    {
      category_slug: "audio",
      category_slugs: ["audio", "flash-deals"],
      is_flash_deal: false,
      flash_ends_at: "2026-11-17T00:00:00.000Z",
    },
  ]);
  assert.equal(ends?.toISOString(), "2026-11-17T00:00:00.000Z");
  assert.equal(
    earliestFlashEndsAt([
      { category_slug: "audio", category_slugs: ["audio"], is_flash_deal: false, flash_ends_at: "2026-11-17T00:00:00.000Z" },
    ]),
    undefined,
  );
});

test("related products share ANY category, not just the primary", () => {
  const products = [
    { slug: "a", category: "audio", categorySlugs: ["audio", "flash-deals"] },
    { slug: "b", category: "gaming", categorySlugs: ["gaming", "flash-deals"] },
    { slug: "c", category: "laptops", categorySlugs: ["laptops"] },
  ];
  const related = relatedProducts(products, products[0], 2);
  // b shares flash-deals with a, so it comes before c.
  assert.deepEqual(related.map((p) => p.slug), ["b", "c"]);
});

test("seed catalogue: Flash deals category exists, the three flash products carry it", () => {
  assert.ok(CATEGORIES.some((c) => c.slug === "flash-deals" && c.name === "Flash deals"));
  const flash = PRODUCTS.filter((p) => p.flash);
  assert.equal(flash.length, 3);
  for (const product of flash) {
    assert.ok(product.categorySlugs.includes("flash-deals"), `${product.slug} is missing flash-deals`);
    assert.equal(product.categorySlugs[0], product.category);
  }
  for (const product of PRODUCTS) {
    assert.ok(product.categorySlugs.length >= 1, `${product.slug} has no category`);
    assert.equal(product.categorySlugs[0], product.category, `${product.slug} primary is not first`);
  }
});

test("product input schema: categorySlugs is optional, multi-value, slug-shaped", () => {
  const base = {
    title: "Test Product",
    categorySlug: "audio",
    priceTaka: 100,
    stock: 5,
    status: "active",
  };
  const parsed = productInputSchema.safeParse({ ...base, categorySlugs: ["audio", "flash-deals"] });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data.categorySlugs, ["audio", "flash-deals"]);
  // Missing entirely: defaults to [] (primary category only).
  const plain = productInputSchema.safeParse(base);
  assert.equal(plain.success, true);
  if (plain.success) assert.deepEqual(plain.data.categorySlugs, []);
  // A bad slug is rejected; the primary is still required.
  assert.equal(productInputSchema.safeParse({ ...base, categorySlugs: ["Audio!"] }).success, false);
  assert.equal(productInputSchema.safeParse({ ...base, categorySlug: "" }).success, false);
});

test("product form: checkboxes, not a single select — Flash deals is a tick", () => {
  const form = readSource("components/product-manager/product-form.tsx");
  assert.match(form, /category-checkbox-/);
  assert.match(form, /data-testid=\{`category-checkbox-\$\{category\.slug\}`\}/);
  assert.match(form, /Ticking “Flash deals” puts it in the/);
  assert.doesNotMatch(form, /id="product-category"/);
  assert.match(form, /categorySlugs\[0\] \?\? ""/);
  // The list shows all categories for the product, not just the primary.
  assert.match(readSource("components/product-manager/product-list.tsx"), /categoryNames\.join\(", "\)/);
});

test("shop filter matches any of a product's categories", () => {
  const shop = readSource("app/shop/page.tsx");
  assert.match(shop, /\(p\.categorySlugs \?\? \[p\.category\]\)\.includes\(category\)/);
  assert.doesNotMatch(shop, /p\.category !== category/);
  // The flash-deal cards are ProductCard (220px thumbs) with the
  // stock bar pinned to the bottom of the cell, so the text lines
  // up across the row.
  const page = readSource("app/page.tsx");
  assert.match(page, /className="flex h-full flex-col"/);
  assert.match(page, /<div className="flex-1">\s*<ProductCard product=\{product\} \/>/);
});

// ---------------------------------------------------------------------------
// Migrations 0011 + 0012: written, mirrored, NOT applied live.
// ---------------------------------------------------------------------------

test("migrations 0011 and 0012 exist and are marked NOT applied live", () => {
  for (const rel of [
    "supabase/migrations/0011_banners.sql",
    "supabase/migrations/0012_product_categories.sql",
  ]) {
    const sql = readSource(rel);
    assert.match(sql, /NOT APPLIED LIVE YET/);
    assert.match(sql, /create table if not exists public\./);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /drop policy if exists/);
  }
  const banners = readSource("supabase/migrations/0011_banners.sql");
  assert.match(banners, /headline text not null check/);
  assert.match(banners, /cta_href text not null default '\/shop' check \(cta_href like '\/%'\)/);
  assert.match(banners, /banners_select_active/);
  assert.match(banners, /banners_staff_insert/);
  const joins = readSource("supabase/migrations/0012_product_categories.sql");
  assert.match(joins, /primary key \(product_id, category_id\)/);
  assert.match(joins, /on delete cascade/);
  assert.match(joins, /'Flash deals', 'flash-deals', 10, true/);
  assert.match(joins, /p\.is_flash_deal = true/);
  // Mirrored in policies.sql (fresh-install mirror).
  const policies = readSource("supabase/policies.sql");
  assert.match(policies, /banners_select_active/);
  assert.match(policies, /product_categories_select_public/);
  assert.match(policies, /0011_banners, 0012_product_categories/);
  // Seed: the Flash deals category + the flash membership (the
  // iPhone is the seed's one flagged flash deal).
  const seed = readSource("supabase/seed.sql");
  assert.match(seed, /'Flash deals',\s+'flash-deals', 10, true/);
  assert.match(seed, /insert into public\.product_categories/);
  // The mock serves both tables (banners empty on purpose — the
  // home page falls back until the admin adds one).
  const mock = readSource("tests/e2e/mock-supabase.mjs");
  assert.match(mock, /banners: \[\]/);
  assert.match(mock, /product_categories: \[/);
  assert.match(mock, /"flash-deals", "Flash deals", 10/);
  // The loader and the admin queries tolerate the missing tables
  // (they do not exist live until the migrations are applied).
  assert.match(readSource("lib/supabase/catalog.ts"), /fetchProductCategorySlugs/);
  assert.match(readSource("lib/products/queries.ts"), /No join table yet: every product keeps its primary only/);
});

test("Card forwards data-testid to its root element", () => {
  // The admin banners list puts data-testid="banner-item" on a
  // Card; the old Card dropped every prop except className, so the
  // list rendered with no banner-item testid at all (the save
  // worked — the row was in the database — but the e2e selector
  // found nothing).
  const ui = readSource("components/ui.tsx");
  assert.match(ui, /"data-testid": testId/);
  assert.match(ui, /<div data-testid=\{testId\}/);
});
