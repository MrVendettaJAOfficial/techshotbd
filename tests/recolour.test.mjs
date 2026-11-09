// Recolour + mobile drawers + animations + image-400 fix + branded
// placeholder tests — TechShot.
//
// 2026-11-09: the whole site moved from the Figma blue/orange
// palette to the owner's logo colours (navy #00162E, green #0F9A70,
// off-white #F1F7FE, slate #283246), the mobile nav and shop filters
// moved into slide-in drawers, motion was added with a
// prefers-reduced-motion escape, the slug-guess image fallback was
// removed (it 400'd for the subscription products, whose files were
// never uploaded), and products without a photo now show the
// TechShot logo instead of an initial letter.
//
// 2026-11-09 (light theme): the site flipped to navy blue and
// white, like the logo — white page backgrounds, dark navy text,
// navy header/footer and navy primary buttons. Green #0F9A70 is
// now a SECONDARY accent only (logo, success states, small
// highlights); it is no longer the primary button/link colour.
// The header cart button and announcement bar stay green because
// they sit directly on the navy header (navy-on-navy would be
// unreadable); the homepage feature icon tile and the filter count
// badge stay green as small highlights. The full green and the
// light green fail AA as text on white, so green text on light is
// always the darker tint brandDark #0B7A55, and brandLight #4CC9A4
// is a navy-only token now.
//
// These tests pin the rules down in source: the token values and
// their Tailwind mappings, the WCAG contrast calls (computed here,
// not guessed), no leftover blue anywhere, orange only where it
// means a deal or a discount, the placeholder everywhere a thumbnail
// appears, and the drawers' wiring. The browser behaviour itself is
// covered by tests/e2e/recolour-mobile.mjs.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function sourceFiles(relDir) {
  const base = fileURLToPath(new URL(`../${relDir}`, import.meta.url));
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

// Strip // line comments so prose in a header comment (which may
// name an old value for the record) cannot trip a code scan.
function codeOnly(src) {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
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

// ---------------------------------------------------------------------------
// Tokens: logo palette promoted to the site palette.
// ---------------------------------------------------------------------------

test("theme.ts promotes the logo tokens to the light site palette", () => {
  const theme = read("lib/theme.ts");
  assert.match(theme, /ink:\s*"#00162E"/);
  assert.match(theme, /inkLight:\s*"#0A2438"/);
  assert.match(theme, /surface:\s*"#FFFFFF"/);
  assert.match(theme, /panel:\s*"#F1F7FE"/);
  assert.match(theme, /card:\s*"#FFFFFF"/);
  assert.match(theme, /border:\s*"#D9E2EC"/);
  assert.match(theme, /brand:\s*"#0F9A70"/);
  assert.match(theme, /brandDark:\s*"#0B7A55"/);
  assert.match(theme, /brandDarker:\s*"#096B49"/);
  assert.match(theme, /brandLight:\s*"#4CC9A4"/);
  assert.match(theme, /accent:\s*"#f97316"/);
  assert.match(theme, /accentDark:\s*"#C2410C"/);
  assert.match(theme, /success:\s*"#0B7A55"/);
  assert.match(theme, /muted:\s*"#475569"/);
  assert.match(theme, /mutedLight:\s*"#5B6B7F"/);
  assert.match(theme, /mutedNavy:\s*"#8AA0B8"/);
  assert.match(theme, /text:\s*"#00162E"/);
  assert.match(theme, /logoGreen:\s*"#0F9A70"/);
  assert.match(theme, /logoNavy:\s*"#00162E"/);
  assert.match(theme, /logoWhite:\s*"#F1F7FE"/);
});

test("tailwind maps the new tokens to classes", () => {
  const config = read("tailwind.config.ts");
  for (const token of [
    "ink", "inkLight", "surface", "panel", "card", "border",
    "brand", "brandDark", "brandDarker", "brandLight",
    "accent", "accentDark", "accentDarker",
    "success", "muted", "mutedLight", "mutedNavy", "text",
  ]) {
    assert.match(config, new RegExp(`${token}:\\s*theme\\.colors\\.${token}`));
  }
});

// ---------------------------------------------------------------------------
// Contrast: the calls in lib/theme.ts, recomputed.
// ---------------------------------------------------------------------------

test("contrast: white text passes AA on navy, navy text passes AA on white", () => {
  // This is WHY primary buttons are bg-ink (navy) with white text.
  assert.ok(contrast("#FFFFFF", "#00162E") >= 4.5, "white on navy");
  assert.ok(contrast("#00162E", "#FFFFFF") >= 4.5, "navy text on white");
  assert.ok(contrast("#F1F7FE", "#00162E") >= 4.5, "off-white on navy");
  assert.ok(contrast("#FFFFFF", "#0A2438") >= 4.5, "white on inkLight (button hover)");
  assert.ok(contrast("#00162E", "#F1F7FE") >= 4.5, "navy text on panel");
});

test("contrast: the full green fails as text on white, the darker tint passes", () => {
  // This is WHY green text on light is always brandDark, never brand,
  // and why green is no longer the link colour (links are navy ink).
  assert.ok(contrast("#0F9A70", "#FFFFFF") < 4.5, "full green text on white must fail AA");
  assert.ok(contrast("#0F9A70", "#F1F7FE") < 4.5, "full green text on panel must fail AA");
  assert.ok(contrast("#0B7A55", "#FFFFFF") >= 4.5, "brandDark green text on white");
  assert.ok(contrast("#0B7A55", "#F1F7FE") >= 4.5, "brandDark green text on panel");
  assert.ok(contrast("#096B49", "#FFFFFF") >= 4.5, "brandDarker green text on white");
  // The full green still passes as text on navy, and as a border/tint
  // on light (3.57:1 clears the 3:1 non-text bar).
  assert.ok(contrast("#0F9A70", "#00162E") >= 4.5, "full green text on navy");
  assert.ok(contrast("#0F9A70", "#FFFFFF") >= 3, "full green border/tint on white");
});

test("contrast: brandLight is navy-only, mutedNavy is navy-only", () => {
  // brandLight on white fails, so it must never appear on a light
  // background; mutedNavy is the old muted, kept only for navy.
  assert.ok(contrast("#4CC9A4", "#FFFFFF") < 4.5, "brandLight on white must fail AA");
  assert.ok(contrast("#4CC9A4", "#00162E") >= 4.5, "brandLight text on navy");
  assert.ok(contrast("#8AA0B8", "#FFFFFF") < 4.5, "mutedNavy on white must fail AA");
  assert.ok(contrast("#8AA0B8", "#00162E") >= 4.5, "mutedNavy text on navy");
});

test("contrast: muted text passes AA on white and on panel", () => {
  assert.ok(contrast("#475569", "#FFFFFF") >= 4.5, "muted text on white");
  assert.ok(contrast("#475569", "#F1F7FE") >= 4.5, "muted text on panel");
  assert.ok(contrast("#5B6B7F", "#FFFFFF") >= 4.5, "mutedLight text on white");
  assert.ok(contrast("#5B6B7F", "#F1F7FE") >= 4.5, "mutedLight text on panel");
  assert.ok(contrast("#0B7A55", "#FFFFFF") >= 4.5, "success text on white");
  assert.ok(contrast("#0B7A55", "#F1F7FE") >= 4.5, "success text on panel");
});

test("contrast: white text passes AA on the darker deal orange, fails on the full orange", () => {
  // This is WHY solid orange badges use bg-accentDark, never bg-accent.
  assert.ok(contrast("#FFFFFF", "#f97316") < 4.5, "white on #f97316 must fail AA");
  assert.ok(contrast("#FFFFFF", "#C2410C") >= 4.5, "white on #C2410C must pass AA");
  assert.ok(contrast("#f97316", "#00162E") >= 4.5, "orange text on navy");
  // Orange text on light must be the darker tint, never the full orange.
  assert.ok(contrast("#f97316", "#FFFFFF") < 4.5, "orange text on white must fail AA");
  assert.ok(contrast("#C2410C", "#FFFFFF") >= 4.5, "accentDark text on white");
  assert.ok(contrast("#C2410C", "#F1F7FE") >= 4.5, "accentDark text on panel");
});

test("contrast: warning amber and error red text pass AA on light", () => {
  assert.ok(contrast("#B45309", "#FFFFFF") >= 4.5, "amber-700 warning text on white");
  assert.ok(contrast("#B45309", "#F1F7FE") >= 4.5, "amber-700 warning text on panel");
  assert.ok(contrast("#B91C1C", "#FFFFFF") >= 4.5, "red-700 error text on white");
  assert.ok(contrast("#B91C1C", "#F1F7FE") >= 4.5, "red-700 error text on panel");
  // Stars are graphics, not text: amber-600 clears the 3:1 non-text bar.
  assert.ok(contrast("#D97706", "#FFFFFF") >= 3, "amber-600 stars on white");
});

// ---------------------------------------------------------------------------
// Light theme: white page, navy chrome, navy primary buttons.
// ---------------------------------------------------------------------------

test("globals.css sets a light page: white background, navy text", () => {
  const css = read("app/globals.css");
  assert.match(css, /color-scheme: light;/);
  assert.match(css, /background-color: #ffffff;/);
  assert.match(css, /color: #00162e;/);
  assert.doesNotMatch(css, /color-scheme: dark;/);
});

test("layout body is the white surface, not navy", () => {
  assert.match(read("app/layout.tsx"), /className="min-h-screen bg-surface text-text antialiased"/);
  assert.doesNotMatch(read("app/layout.tsx"), /bg-ink text-text/);
});

test("header bar and footer are navy", () => {
  assert.match(read("components/Header.tsx"), /className="border-b border-border bg-ink"/);
  assert.match(read("components/Footer.tsx"), /<footer className="border-t border-border bg-ink">/);
  // Footer text on navy uses the navy tokens, not the light ones.
  assert.match(read("components/Footer.tsx"), /text-mutedNavy/);
  assert.doesNotMatch(codeOnly(read("components/Footer.tsx")), /text-muted"/);
});

test("primary buttons are navy: the shared Button primary variant", () => {
  assert.match(read("components/ui.tsx"), /primary: "bg-ink text-white hover:bg-inkLight disabled:bg-ink\/50"/);
});

test("green is not a resting link or button colour any more", () => {
  // No resting text-brand anywhere in app/ or components/: links are
  // navy ink now, green text on light is always brandDark.
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, /\btext-brand(?![A-Za-z])/, `${file} still uses green as a resting text colour`);
  }
  // And bg-brandDark survives only in the four documented keepers:
  // the header announcement bar + cart button (both sit on navy),
  // the homepage feature icon tile, the filter count badge, and the
  // generic brand Badge tone in ui.tsx (a small highlight).
  const allowed = new Set([
    "components/Header.tsx",
    "app/page.tsx",
    "components/FilterDrawer.tsx",
    "components/ui.tsx",
  ]);
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const rel = path.relative(fileURLToPath(new URL("../", import.meta.url)), file);
    const src = codeOnly(readFileSync(file, "utf8"));
    if (/\bbg-brandDark\b/.test(src)) {
      assert.ok(allowed.has(rel), `${rel} uses bg-brandDark outside the documented keepers`);
    }
  }
  assert.match(read("components/Header.tsx"), /bg-brandDark px-4 py-2 text-center/);
  assert.match(read("components/Header.tsx"), /rounded-xl bg-brandDark px-2\.5 py-2\.5/);
  assert.match(read("app/page.tsx"), /rounded-xl bg-brandDark text-white/);
  assert.match(read("components/FilterDrawer.tsx"), /rounded-full bg-brandDark px-1\.5/);
  assert.match(read("components/ui.tsx"), /brand: "bg-brandDark text-white border-brandDark"/);
});

test("no light-invisible tints remain in app/ or components/", () => {
  // The old light tints (red-400, amber-300, emerald-300, slate-300,
  // gray-300, brandLight as resting text) are unreadable on white.
  const pale = /text-red-400|border-red-400|text-red-300|text-amber-300|text-emerald-300|text-slate-300|text-gray-300|#f87171/;
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, pale, `${file} still has a light tint that fails on white`);
  }
  // The only brandLight text left is hover-only, on navy surfaces.
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    for (const hit of src.matchAll(/text-brandLight/g)) {
      const before = src.slice(Math.max(0, hit.index - 12), hit.index);
      assert.match(before, /hover:/, `${file} uses text-brandLight outside a navy hover`);
    }
  }
});

test("drawer Flash deals link uses the darker orange on white", () => {
  assert.match(read("components/MobileNavDrawer.tsx"), /text-accentDark/);
  assert.doesNotMatch(codeOnly(read("components/MobileNavDrawer.tsx")), /\btext-accent(?![A-Za-z])/);
});

// ---------------------------------------------------------------------------
// No leftover blue anywhere in the rendered code.
// ---------------------------------------------------------------------------

test("no blue classes or old blue hex remain in app/ or components/", () => {
  const blue = /#3b82f6|#2f6fe0|#b7d4ff|#172f55|blue-500|blue-600|blue-200|blue-300|accent-blue|#5bd4a0|#080d18|#0b1120|#0f172a|#151f33|#2a364c/;
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, blue, `${file} still has blue`);
  }
});

test("no hard-coded old hex remains in the theme-adjacent files", () => {
  for (const rel of ["app/globals.css", "app/icon.svg"]) {
    assert.doesNotMatch(read(rel), /#3b82f6|#0b1120|#151f33/);
  }
});

// ---------------------------------------------------------------------------
// Orange only where it means a deal or a discount.
// ---------------------------------------------------------------------------

test("orange is used only in deal/discount contexts", () => {
  // Every remaining orange class must live in one of these files,
  // each of which uses it only for a deal: the homepage flash-deal
  // section, the header Flash deals link, the FIRST2000 coupon box
  // on the product page, or the generic accent Button/Badge variant
  // (kept for deal use; no call site uses it for anything else).
  // TEST MODE badges/banners are amber (warning), submit buttons
  // are green, status chips are green/neutral/amber.
  const allowed = new Set([
    "app/page.tsx",
    "components/Header.tsx",
    "components/MobileNavDrawer.tsx",
    "components/product-gallery/product-detail.tsx",
    "components/ui.tsx",
  ]);
  const orange = /\bbg-accent(?![A-Za-z])|\btext-accent(?![A-Za-z])|\bborder-accent(?![A-Za-z])|\borange-(?:300|500|600)\b/;
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const rel = path.relative(fileURLToPath(new URL("../", import.meta.url)), file);
    const src = codeOnly(readFileSync(file, "utf8"));
    if (orange.test(src)) {
      assert.ok(allowed.has(rel), `${rel} uses orange outside a deal context`);
    }
  }
  // And the deal spots really are there.
  assert.match(read("components/MobileNavDrawer.tsx"), /Flash deals/);
  assert.match(read("app/page.tsx"), /Flash deals/);
  assert.match(read("components/product-gallery/product-detail.tsx"), /FIRST2000/);
});

test("stars stay amber (rating convention), not orange or green", () => {
  // Amber-600, not amber-400: the lighter star fails the 3:1
  // non-text bar on white (1.7:1); amber-600 is 3.19:1.
  assert.match(read("components/ProductCard.tsx"), /fill-amber-600 text-amber-600/);
  assert.match(read("components/Stars.tsx"), /fill-amber-600 text-amber-600/);
  assert.doesNotMatch(codeOnly(read("components/Stars.tsx")), /accent/);
});

// ---------------------------------------------------------------------------
// Branded placeholder: the logo, everywhere a thumbnail appears.
// ---------------------------------------------------------------------------

test("ProductPlaceholder exists, reuses the logo mark, flat colours only", () => {
  assert.equal(existsSync(new URL("../components/ProductPlaceholder.tsx", import.meta.url)), true);
  const placeholder = read("components/ProductPlaceholder.tsx");
  assert.match(placeholder, /import \{ LogoMark \} from "\.\/Logo"/);
  assert.match(placeholder, /<LogoMark/);
  assert.match(placeholder, /bg-logoNavy/);
  assert.match(placeholder, /data-testid="product-placeholder"/);
  assert.doesNotMatch(codeOnly(placeholder), /gradient/i);
  assert.doesNotMatch(placeholder, /charAt\(0\)/);
});

test("ProductImage renders the placeholder for an empty or failed src", () => {
  const image = read("components/ProductImage.tsx");
  assert.match(image, /import ProductPlaceholder from "\.\/ProductPlaceholder"/);
  assert.match(image, /if \(!src\?\.trim\(\) \|\| failed\)/);
  assert.match(image, /<ProductPlaceholder/);
  assert.doesNotMatch(codeOnly(image), /charAt\(0\)/);
  assert.doesNotMatch(codeOnly(image), /#151f33|#3b82f6/);
});

test("no bare-initial or question-mark thumbnail fallback remains", () => {
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = codeOnly(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, /charAt\(0\)/, `${file} still shows an initial`);
  }
  assert.doesNotMatch(
    codeOnly(read("components/MiniCartDrawer.tsx")),
    /^\s*\?\s*$/m,
  );
});

// ---------------------------------------------------------------------------
// Image-400 fix: no slug guess, seed has no subscription image rows.
// ---------------------------------------------------------------------------

test("mapping.ts has no slug fallback for product photos", () => {
  const mapping = read("lib/catalog/mapping.ts");
  assert.doesNotMatch(mapping, /\/images\/products\/\$\{row\.slug\}/);
  assert.match(mapping, /const image = resolvedImages\[0\] \?\? "";/);
  assert.match(mapping, /const gallery = \[\.\.\.new Set\(resolvedImages\)\];/);
});

test("seed.sql writes no image rows for the subscription products", () => {
  const seed = read("supabase/seed.sql");
  // Strip -- comments: the NOTE below the insert names the
  // subscriptions to explain why they are absent.
  const sql = seed
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const block = sql.slice(sql.indexOf("insert into public.product_images"));
  assert.doesNotMatch(block, /netflix-premium-1-month/);
  assert.doesNotMatch(block, /amazon-prime-1-year/);
  assert.doesNotMatch(block, /youtube-premium-1-month/);
  // The nine physical products still get their rows.
  for (const slug of [
    "apple-iphone-16-pro-256gb-natural-titanium",
    "sony-wh-1000xm5",
    "anker-737-power-bank",
  ]) {
    assert.match(block, new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the unconfigured seed catalogue leaves subscription images empty", () => {
  const seed = read("lib/data/catalog/seed-products.ts");
  assert.doesNotMatch(seed, /netflix-premium\.jpg|amazon-prime\.jpg|youtube-premium\.jpg/);
});

// ---------------------------------------------------------------------------
// Drawers: nav + filters.
// ---------------------------------------------------------------------------

test("mobile nav drawer exists with the category links and hamburger wiring", () => {
  assert.equal(existsSync(new URL("../components/MobileNavDrawer.tsx", import.meta.url)), true);
  const drawer = read("components/MobileNavDrawer.tsx");
  assert.match(drawer, /export const NAV_LINKS/);
  for (const label of ["Smartphones", "Laptops", "Audio", "Gaming", "Subscriptions", "Flash deals"]) {
    assert.match(drawer, new RegExp(label));
  }
  assert.match(drawer, /data-testid="mobile-nav-drawer"/);
  assert.match(drawer, /Escape/);
  const header = read("components/Header.tsx");
  assert.match(header, /data-testid="mobile-nav-button"/);
  assert.match(header, /<MobileNavDrawer/);
  // The horizontal nav row is hidden on mobile, shown from sm up.
  assert.match(header, /className="hidden overflow-x-auto border-t border-border sm:block"/);
});

test("filter drawer exists with a count badge and a single form", () => {
  assert.equal(existsSync(new URL("../components/FilterDrawer.tsx", import.meta.url)), true);
  const drawer = read("components/FilterDrawer.tsx");
  assert.match(drawer, /data-testid="filters-button"/);
  assert.match(drawer, /data-testid="filters-count"/);
  assert.match(drawer, /data-testid="filters-drawer"/);
  assert.match(drawer, /onSubmit=\{\(\) => setOpen\(false\)\}/);
  assert.match(drawer, /Escape/);
  const shop = read("app/shop/page.tsx");
  assert.match(shop, /<FilterDrawer activeCount=\{activeFilterCount\}>/);
  assert.match(shop, /activeFilterCount =/);
  // Exactly one <form in the shop page (no duplicate filter form).
  assert.equal((shop.match(/<form /g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// Animations: drawer motion + reduced-motion escape.
// ---------------------------------------------------------------------------

test("globals.css has drawer motion and a prefers-reduced-motion rule", () => {
  const css = read("app/globals.css");
  assert.match(css, /@keyframes drawer-in-left/);
  assert.match(css, /@keyframes drawer-in-right/);
  assert.match(css, /@keyframes fade-in/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration: 0\.01ms !important/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/i);
});

test("drawers animate in and cards lift on hover", () => {
  assert.match(read("components/MiniCartDrawer.tsx"), /animate-drawer-right/);
  assert.match(read("components/MiniCartDrawer.tsx"), /animate-fade-in/);
  assert.match(read("components/MobileNavDrawer.tsx"), /animate-drawer-left/);
  assert.match(read("components/ProductCard.tsx"), /hover:-translate-y-0\.5/);
});
