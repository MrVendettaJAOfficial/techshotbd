// Mock Supabase (Auth + PostgREST subset) for TechShot local verification.
// Serves the exact rows from supabase/seed.sql so the "Supabase configured"
// path can be exercised end to end without real keys. Run it, then run the
// app pointed at it (see the README, "End-to-end checks"), then run
// tests/e2e/smoke.mjs.
//
// Tables: categories, products, product_images, product_variants,
// profiles, addresses, wishlists, carts, cart_items, orders,
// order_items, coupons, payments. Auth: any password grant succeeds
// as user-1 (customer); GET /auth/v1/user accepts any Bearer token.
// RLS is intentionally permissive here — the
// real RLS policies are verified by reading supabase/policies.sql, not by
// this mock.
// Port: 3101 by default (MOCK_SUPABASE_PORT overrides).
//
// Admin mode: MOCK_ADMIN=1 seeds user-1's profile with role "admin",
// so the /admin orders flow (list + Advance / Cancel / Refund server
// actions) can be exercised end to end. The app never overwrites an
// existing profiles row on sign-in, so the seeded admin role survives
// sign-in (see lib/auth-server.ts ensureProfile).
import http from "node:http";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 3101);
let seq = 0;

// Test-only latency (ms) applied to every mock response. Set at
// startup with MOCK_DELAY_MS, or at runtime with
// GET /__test/delay?ms=N (ms=0 clears it). The skeleton Playwright
// check uses it to simulate a slow data fetch — a loading.tsx
// skeleton only renders while the page is waiting on data, and the
// mock answers in milliseconds, so without an artificial delay the
// page resolves before the shell flushes and no skeleton ever
// appears. Test tooling only; never present in the app or production.
let testDelayMs = Math.max(0, Number(process.env.MOCK_DELAY_MS ?? 0) || 0);
const nid = (p) => `${p}-${++seq}-${Date.now().toString(36)}`;

const CATS = [
  ["smartphones", "Smartphones", 1],
  ["laptops", "Laptops", 2],
  ["audio", "Audio", 3],
  ["wearables", "Wearables", 4],
  ["cameras", "Cameras", 5],
  ["gaming", "Gaming", 6],
  ["accessories", "Accessories", 7],
  ["smart-home", "Smart Home", 8],
  ["subscriptions", "Subscriptions", 9],
].map(([slug, name, order]) => ({
  id: `cat-${slug}`, slug, name, sort_order: order, is_active: true,
}));
const catId = (slug) => `cat-${slug}`;

const PRODUCTS = [
  ["Apple iPhone 16 Pro 256GB Natural Titanium", "apple-iphone-16-pro-256gb-natural-titanium", "smartphones", 11990000, 12990000, 12, 4.9, 1248, true],
  ["Sony WH-1000XM5 Wireless Noise Cancelling Headphones", "sony-wh-1000xm5", "audio", 2499000, 2999000, 30, 4.8, 2100, false],
  ['MacBook Air 13" M3', "macbook-air-13-m3", "laptops", 9990000, 11490000, 8, 4.9, 860, false],
  ["Samsung Galaxy Watch7", "samsung-galaxy-watch7", "wearables", 2699900, 3299900, 25, 4.7, 640, false],
  ["Samsung Galaxy S24 Ultra", "samsung-galaxy-s24-ultra", "smartphones", 10999900, 12999900, 15, 4.8, 1500, false],
  ["Sony Alpha ZV-E10 II", "sony-alpha-zv-e10-ii", "cameras", 9499000, 10499900, 6, 4.8, 320, false],
  ["PlayStation DualSense Wireless Controller", "playstation-dualsense", "gaming", 549000, 639000, 40, 4.9, 3100, false],
  ["JBL Flip 6 Portable Bluetooth Speaker", "jbl-flip-6", "audio", 899900, 1199900, 35, 4.7, 980, false],
  ["Anker 737 Power Bank 24,000mAh", "anker-737-power-bank", "accessories", 1299900, 1699900, 50, 4.8, 740, false],
  ["Netflix Premium — 1 Month", "netflix-premium-1-month", "subscriptions", 64900, null, 999, 4.8, 412, false],
  ["Amazon Prime — 1 Year", "amazon-prime-1-year", "subscriptions", 149900, null, 999, 4.7, 298, false],
  ["YouTube Premium — 1 Month", "youtube-premium-1-month", "subscriptions", 14900, null, 999, 4.8, 531, false],
].map(([title, slug, cat, price, compare, stock, rating, reviews, flash], i) => ({
  id: `prod-${slug}`,
  category_id: catId(cat),
  title, slug,
  description: `${title}. Official warranty in Bangladesh.`,
  price_poisha: price,
  compare_at_poisha: compare,
  stock,
  status: "active",
  search_text: slug.replace(/-/g, " "),
  rating, review_count: reviews,
  is_flash_deal: flash,
  flash_ends_at: flash ? new Date(Date.now() + 7 * 864e5).toISOString() : null,
  seller_id: null,
  created_at: new Date(Date.now() - (12 - i) * 864e5).toISOString(),
  updated_at: new Date().toISOString(),
}));

const ADMIN_MODE = process.env.MOCK_ADMIN === "1";

const db = {
  categories: CATS,
  products: PRODUCTS,
  product_images: [],
  product_variants: [
    // Variant-photo test rows for the iPhone (migration 0005):
    // "Natural Titanium" has no photo (gallery falls back to the
    // product photo); "Black Titanium" has a photo. The photo is a
    // STAND-IN ONLY — it is the Sony headphones shot
    // (sony-wh-1000xm5.jpg), chosen deliberately so nobody mistakes
    // it for a real Black Titanium iPhone photo. No real per-colour
    // photos exist yet. The Playwright check
    // (tests/e2e/mini-cart-variant-photos.mjs) uses these rows to
    // prove the gallery switches to the variant photo when one is
    // set and falls back when it is not. All other products have no
    // variant rows, exactly like the live seed.
    {
      id: "var-iphone-natural-titanium",
      product_id: "prod-apple-iphone-16-pro-256gb-natural-titanium",
      name: "Natural Titanium",
      price_override_poisha: null,
      stock: 12,
      image_path: null,
    },
    {
      id: "var-iphone-black-titanium",
      product_id: "prod-apple-iphone-16-pro-256gb-natural-titanium",
      name: "Black Titanium",
      price_override_poisha: null,
      stock: 12,
      image_path: "sony-wh-1000xm5.jpg",
    },
  ],
  profiles: ADMIN_MODE
    ? [
        {
          id: "user-1",
          role: "admin",
          display_name: "Test Admin",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]
    : [],
  addresses: [],
  wishlists: [],
  carts: [],
  cart_items: [],
  orders: [],
  order_items: [],
  coupons: [
    { id: "coupon-first2000", code: "FIRST2000", type: "fixed", value_poisha: 200000, min_spend_poisha: 5000000, usage_limit: null, used_count: 0, expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), is_active: true },
  ],
  payments: [],
  reviews: [],
  audit_log: [],
};

const USER = {
  id: "user-1",
  email: "test@example.com",
  user_metadata: { display_name: "Test User" },
  created_at: new Date().toISOString(),
};

function send(res, status, body) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    // Real Supabase sends CORS headers; the browser client calls Auth
    // and REST directly, so the mock must too (including the preflight).
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "*",
    "Access-Control-Expose-Headers": "content-range",
  });
  res.end(payload);
}

// Parse PostgREST filters from query params.
function parseFilters(searchParams) {
  const filters = [];
  let order = null;
  let limit = null;
  let offset = 0;
  for (const [key, value] of searchParams.entries()) {
    if (key === "select" || key === "on_conflict") continue;
    if (key === "order") {
      const [col, dir] = value.split(".");
      order = { col, dir: dir === "desc" ? -1 : 1 };
      continue;
    }
    if (key === "limit") { limit = parseInt(value, 10); continue; }
    if (key === "offset") { offset = parseInt(value, 10) || 0; continue; }
    const m = value.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.*)$/s);
    if (m) filters.push({ col: key, op: m[1], raw: m[2] });
  }
  return { filters, order, limit, offset };
}

function matchRow(row, f) {
  const v = row[f.col];
  // URLSearchParams already percent-decodes query values; do NOT
  // decodeURIComponent again — a value ending in "%" (a PostgREST
  // `like` pattern such as "apple-iphone-16-pro-%") would throw
  // URIError and kill the server.
  const raw = f.raw;
  switch (f.op) {
    case "eq": return String(v ?? "") === raw;
    case "neq": return String(v ?? "") !== raw;
    case "gt": return Number(v) > Number(raw);
    case "gte": return Number(v) >= Number(raw);
    case "lt": return Number(v) < Number(raw);
    case "lte": return Number(v) <= Number(raw);
    case "like":
    case "ilike": {
      const re = new RegExp("^" + raw.replace(/%/g, ".*").replace(/_/g, ".") + "$", f.op === "ilike" ? "i" : "");
      return re.test(String(v ?? ""));
    }
    case "is": return raw === "null" ? v == null : String(v) === raw;
    case "in": {
      const list = raw.replace(/^\(|\)$/g, "").split(",");
      return list.includes(String(v ?? ""));
    }
    default: return true;
  }
}

function applyQuery(rows, searchParams) {
  const { filters, order, limit, offset } = parseFilters(searchParams);
  let out = rows.filter((r) => filters.every((f) => matchRow(r, f)));
  if (order) {
    out = [...out].sort((a, b) => {
      const av = a[order.col], bv = b[order.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * order.dir;
    });
  }
  if (offset) out = out.slice(offset);
  if (limit != null) out = out.slice(0, limit);
  return out;
}

// Attach embedded relations requested in select=...
function attachEmbeds(table, rows, select) {
  if (!select) return rows;
  const has = (name) => select.includes(name + "(") || select.includes(name + "(*)");
  return rows.map((row) => {
    const out = { ...row };
    if (table === "products") {
      if (has("product_images")) {
        out.product_images = db.product_images
          .filter((i) => i.product_id === row.id)
          .map((i) => ({ storage_path: i.storage_path, alt_text: i.alt_text, sort_order: i.sort_order }));
      }
      if (has("product_variants")) {
        out.product_variants = db.product_variants
          .filter((v) => v.product_id === row.id)
          .map((v) => ({ name: v.name, price_override_poisha: v.price_override_poisha, stock: v.stock, image_path: v.image_path ?? null }));
      }
    }
    if (table === "wishlists" && has("products")) {
      const p = db.products.find((x) => x.id === row.product_id);
      out.products = p
        ? { title: p.title, slug: p.slug, price_poisha: p.price_poisha, compare_at_poisha: p.compare_at_poisha }
        : null;
    }
    if (table === "cart_items") {
      if (has("products")) {
        const p = db.products.find((x) => x.id === row.product_id);
        out.products = p ? { slug: p.slug } : null;
      }
      if (has("product_variants")) {
        const v = db.product_variants.find((x) => x.id === row.variant_id);
        out.product_variants = v ? { name: v.name } : null;
      }
    }
    if (table === "orders" && has("order_items")) {
      out.order_items = db.order_items
        .filter((i) => i.order_id === row.id)
        .map((i) => {
          const p = db.products.find((x) => x.id === i.product_id);
          return { ...i, products: p ? { slug: p.slug } : null };
        });
    }
    if (table === "order_items" && has("products")) {
      const p = db.products.find((x) => x.id === row.product_id);
      out.products = p ? { slug: p.slug } : null;
    }
    return out;
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    // One bad request must never kill the mock mid-run.
    console.error("mock error:", error instanceof Error ? error.message : error);
    if (!res.headersSent) send(res, 500, { message: "mock: internal error" });
    else res.end();
  }
});

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  console.log(`${req.method} ${path}${url.search}`);

  // Test-only latency control (see testDelayMs above). This endpoint
  // itself is never delayed.
  if (path === "/__test/delay") {
    testDelayMs = Math.max(0, Number(url.searchParams.get("ms") ?? 0) || 0);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ delayMs: testDelayMs }));
    return;
  }
  if (testDelayMs > 0) await new Promise((r) => setTimeout(r, testDelayMs));

  // CORS preflight for browser calls (Auth + REST).
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "*",
    });
    res.end();
    return;
  }

  // --- Storage (public product-images bucket) ---
  // The real bucket serves the product photos; the mock serves a
  // solid 120x120 PNG for any file under it, so a browser check can
  // prove a photo URL resolves and loads (the variant-photo
  // Playwright check asserts the gallery's <img> actually shows the
  // variant file). 120x120, not 1x1: headless Chromium reports
  // naturalWidth 0 for a 1x1 image loaded via srcset even though it
  // loads fine, which makes a load assertion meaningless.
  // Filenames with ".." are rejected, like the real bucket.
  if (path.startsWith("/storage/v1/object/public/product-images/")) {
    const file = path.slice("/storage/v1/object/public/product-images/".length);
    if (!file || file.includes("..")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "mock storage: bad file" }));
      return;
    }
    // Solid 120x120 PNG in the card colour (#151f33). Generated
    // with Python (zlib + struct, correct CRCs) — a hand-written
    // 1x1 base64 PNG turned out to have a bad IDAT CRC, which
    // Chromium refuses to decode.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAABLUlEQVR4nO3RMQ0AIADAMExwIwL/2kAGyejRf8nGXPvQNV4HYDAGY/CnDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7guAu9464TroPW9gAAAABJRU5ErkJggg==",
      "base64",
    );
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": png.length,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(png);
    return;
  }

  // --- Auth ---
  if (path.startsWith("/auth/v1/")) {
    if (path === "/auth/v1/token") {
      const body = await readBody(req);
      const email = body.email || USER.email;
      const user = { ...USER, email };
      return send(res, 200, {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }
    if (path === "/auth/v1/signup") {
      const body = await readBody(req);
      const user = { ...USER, email: body.email || USER.email, user_metadata: body.data || {} };
      return send(res, 200, {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }
    if (path === "/auth/v1/user") {
      const auth = req.headers.authorization || "";
      if (!auth.startsWith("Bearer ") || auth.slice(7).length < 4) {
        return send(res, 401, { msg: "invalid token" });
      }
      return send(res, 200, USER);
    }
    if (path === "/auth/v1/logout") {
      await readBody(req);
      return send(res, 204, "");
    }
    return send(res, 404, { msg: "mock auth: not implemented " + path });
  }

  // --- REST ---
  const m = path.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (m) {
    const table = m[1];
    const rows = db[table];
    if (!rows) return send(res, 404, { message: `mock: unknown table ${table}` });
    const objectAccept = (req.headers.accept || "").includes("application/vnd.pgrst.object+json");
    const select = url.searchParams.get("select");

    if (req.method === "GET") {
      const out = attachEmbeds(table, applyQuery(rows, url.searchParams), select);
      if (objectAccept) {
        if (out.length === 0) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        return send(res, 200, out[0]);
      }
      return send(res, 200, out);
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const items = Array.isArray(body) ? body : [body];
      const now = new Date().toISOString();
      // Real PostgREST honours on_conflict: with
      // Prefer: resolution=ignore-duplicates (how the app upserts
      // profiles rows — see lib/auth-server.ts ensureProfile) a row
      // whose conflict columns already exist is skipped, never
      // overwritten, so a seeded admin role can never be downgraded
      // to customer. Without ignore-duplicates the existing row is
      // updated instead. Either way no duplicate row is ever created:
      // .maybeSingle() callers (middleware's admin check, the admin
      // orders list) would otherwise get a 406 for two rows.
      const onConflict = url.searchParams.get("on_conflict");
      const ignoreDuplicates = (req.headers.prefer || "").includes(
        "resolution=ignore-duplicates",
      );
      const inserted = items.map((it) => {
        if (onConflict) {
          const cols = onConflict.split(",");
          const existing = rows.find((r) =>
            cols.every((c) => String(r[c] ?? "") === String(it[c] ?? "")),
          );
          if (existing) {
            if (!ignoreDuplicates) {
              Object.assign(existing, it, { updated_at: now });
            }
            return existing;
          }
        }
        const row = { ...it, id: it.id || nid(table.slice(0, 4)), created_at: it.created_at || now, updated_at: now };
        rows.push(row);
        return row;
      });
      const out = attachEmbeds(table, inserted, select);
      if (objectAccept) return send(res, 201, out[0]);
      return send(res, 201, out);
    }
    if (req.method === "PATCH") {
      const body = await readBody(req);
      const targets = applyQuery(rows, url.searchParams);
      for (const row of targets) Object.assign(row, body, { updated_at: new Date().toISOString() });
      const out = attachEmbeds(table, targets, select);
      if (objectAccept) {
        if (out.length === 0) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        return send(res, 200, out[0]);
      }
      return send(res, 200, out);
    }
    if (req.method === "DELETE") {
      const targets = applyQuery(rows, url.searchParams);
      for (const row of targets) {
        const i = rows.indexOf(row);
        if (i >= 0) rows.splice(i, 1);
      }
      return send(res, 200, []);
    }
    return send(res, 405, { message: "mock: method not allowed" });
  }

  return send(res, 404, { msg: "mock: not found " + path });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Supabase listening on http://127.0.0.1:${PORT}`);
});
