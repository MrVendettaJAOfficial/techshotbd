# TechShot

A marketplace for physical and digital products in Bangladesh — a Daraz-style online shop, rebuilt to the TechShot design. Built with **Next.js 14 (App Router) + TypeScript + Supabase**. Prices are in **Bangladeshi Taka (BDT)** throughout, and all money is stored as integer **poisha** (100 poisha = ৳1).

> **Design source:** the TechShot Figma design — https://www.figma.com/design/isIx9OQrre05slUwhfrfe2/Untitled — 5 screens at 1440px (Homepage, Product listing, Product detail, Cart, Checkout), dark navy theme with blue/orange accents, solid colours only. The PNG exports of those screens in `../hidden_files/` (outside this repo) are the visual reference for the build. The plan and architecture document for this build is the `techshot-marketplace-plan-architecture` artifact.

## Localisation decisions (Bangladesh)

The Figma design was drawn with Indian copy and prices. The build localises it:

- **Currency:** prices shown in the design in INR were converted **1:1 numeric to BDT** (the same number, now Taka) and formatted with `formatBDT` from `lib/theme.ts`.
- **Places:** Bengaluru copy replaced with **Dhaka / Chattogram**, and delivery areas use Bangladesh **divisions and districts**. No PIN code is used anywhere.
- **Payments:** UPI, RuPay and GST were removed. Payment methods are **bKash, Nagad, card, EMI, and cash on delivery (COD)**.
- **Pricing rules** (see `lib/pricing.ts`, `lib/theme.ts`):
  - Free standard delivery on orders of **৳999 or more**; otherwise standard delivery is **৳60**. An empty cart costs no delivery.
  - Express delivery is a flat **৳499**.
  - Coupon **FIRST2000**: **৳2,000 off** orders of **৳50,000 or more**.
  - Totals are never negative.
- **Design rules:** solid colours only — no gradients, no emoji. Theme tokens live in `lib/theme.ts` (`ink / surface / panel / border / brand / accent / success / muted / text`).

## Single-seller store

TechShot has **one seller: the owner (MD Joynal Abedin)**. There are no seller accounts, no seller sign-up, no `/seller` route (it returns 404), and no seller approval flow.

- **Sign-up** creates a customer account only. The sign-up form has no account-type choice; `lib/auth.ts` and `lib/profile-rules.ts` accept only role `"customer"` (a `"seller"` value is rejected by the sign-up schema and sanitized to `"customer"` by `sanitizeProfileRole`), and the profile trigger in `supabase/migrations/0002_profile_trigger.sql` only ever creates `"customer"` rows. Admin is still granted manually in the database only.
- **Products** are store-owned (`products.seller_id` is always null) and are managed only in **`/admin`** by the owner. Product server actions (`lib/products/actions.ts`) require role `admin`; customers cannot manage products.
- **Legacy, kept in the database (not dropped):** the `seller_profiles` table and its RLS policies in `supabase/migrations/0001_initial_schema.sql` / `supabase/policies.sql` are untouched — nothing in the app reads or writes that table any more. If the live TechshotBD project was set up before this change, re-run `supabase/migrations/0002_profile_trigger.sql` in the SQL Editor (it drops/recreates the trigger) and convert any pre-existing seller profiles with `update public.profiles set role = 'customer' where role = 'seller';` — the trigger backfill only inserts missing rows and never changes existing ones.

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with values from YOUR OWN Supabase project (see below).
npm run dev
```

Then open http://localhost:3000.

### Supabase

The live project **TechshotBD** already exists and its database is already set up (schema, RLS policies and seed data applied). If you are setting up from scratch:

1. Create a Supabase project you own (https://supabase.com/dashboard). Do not use anyone else's project or keys.
2. In the Supabase **SQL editor**, apply the files in order:
   1. `supabase/migrations/0001_initial_schema.sql`
   2. `supabase/policies.sql`
   3. `supabase/seed.sql`
   4. `supabase/migrations/0002_profile_trigger.sql` — creates the
      `profiles` row automatically when a user signs up (see "Supabase
      Auth" below). **If your project was set up before this file
      existed, run it now too** — it also backfills profiles rows for
      users who signed up earlier and whose `profiles` table is empty.
   5. `supabase/migrations/0003_order_items_variant.sql` — records
      which variant row each order line decremented (cancel / refund
      stock restore).
   6. `supabase/migrations/0004_drop_seller_order_policy.sql` — drops
      the legacy `orders_select_seller` policy. Without it, any
      authenticated SELECT on `orders` fails with "infinite recursion
      detected in policy for relation orders" (the policy read
      `order_items` while `order_items_select_buyer` reads `orders`),
      so a signed-in customer's `/orders` page showed "No orders yet"
      in a fresh browser even though their orders existed.
   7. `supabase/migrations/0005_product_variant_image.sql` — adds
      `image_path` to `product_variants` (one photo per colour /
      storage variant; see "Colour-variant photos" below). **Not yet
      applied live** — run it in the SQL Editor like 0002–0004.
3. Set in `.env.local` (from your project's Settings, API Keys — use the publishable and secret keys):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never import it in browser code)
   - `TEST_PAYMENT_SIGNING_SECRET` (test payment adapter only; see below)
   - `NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`)

### Scripts

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start the development server                  |
| `npm run build`   | Production build                              |
| `npm run start`   | Serve the production build                    |
| `npm run lint`    | Lint                                          |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm test`        | `node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs` (pricing, payments, cart, catalogue, product actions, profile creation). The loader lets tests import the real TypeScript modules instead of stubs — see `tests/ts-hooks.mjs`. |

## End-to-end checks (mock Supabase, no real keys)

`tests/e2e/` holds a mock Supabase server (Auth + PostgREST subset, seeded with the exact rows from `supabase/seed.sql`) and a Playwright click-through script, so the Supabase-configured path can be exercised end to end without real keys:

```bash
# 1. Mock Supabase on :3101
node tests/e2e/mock-supabase.mjs
# 2. In another shell, build + serve the app pointed at the mock
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
SUPABASE_SERVICE_ROLE_KEY=mock-service-key npm run build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
# 3. In a third shell (needs a Chromium: npx playwright install chromium)
BASE_URL=http://127.0.0.1:3100 node tests/e2e/smoke.mjs
```

The script signs in, checks the "Signed in successfully" banner and the name / email / role / sign-out button on `/account`, adds a live-slug product to the cart, checks the badge/cart/totals, checks out with the test card, pays successfully and confirms the order is paid and listed in `/account` order history, then repeats with a failed payment (order stays unpaid, retry works) and with COD (no payment step). Run it with `TEST_PAYMENT_SIGNING_SECRET` set as well to also exercise the signed `/api/payments/callback` path. Without any env vars the same script covers the localStorage fallback path (and checks the signed-out `/account` prompt).

To exercise the admin orders flow against the mock instead, start the mock with `MOCK_ADMIN=1` (it seeds the signed-in user as admin), sign in, place a COD order, then open `/admin`: the order is listed from the live database and Advance moves it confirmed → processing → shipped → delivered, with the customer order page moving too.

`/orders` lists the signed-in user's live Supabase orders, not just the browser's copy: `tests/e2e/orders-fresh-browser.mjs` places a COD order, then opens `/orders` in a fresh browser profile (empty localStorage) and checks the order is listed there and that `/orders/<id>` shows it with its live status. In fallback mode (no env vars) the same script checks a guest COD order is still listed from localStorage.

The 2026-11-08 gstack review fixes are covered by `tests/e2e/review-fixes.mjs` (same mock + `MOCK_ADMIN=1` setup, run after the app is built against the mock): a realistic double-click of Advance moves one step only and the button disables while the action runs, then two clicks dispatched synchronously in one task also move one step only (the synchronous in-flight ref guard in `AdminDashboard.tsx` — React state alone cannot stop the second click, and the server's conditional update cannot either, because "advance from the new status" is legal once the first advance lands); a customer cancel cancels the live order, restores stock, writes a customer-cancel audit row and shows the stock-released confirmation; an admin Refund calls the test adapter first and appends a refunded payments row while the paid row stays paid; a failed test payment followed by a successful retry leaves two payments rows; and a fresh browser lists live orders with live status. Stock is read from the variant row the order actually decremented (the iPhone's Natural Titanium variant — see the comment on `iphoneStock()`): since the mock gained variant rows, checkout decrements the variant row, not the product row.

The mini-cart drawer, colour-variant photos and per-route skeletons are covered by one combined run, `tests/e2e/mini-cart-variant-photos.mjs` (same mock setup, no admin mode needed): variant photos (Black Titanium switches the gallery to the variant image and back), the drawer (opens without navigating or losing scroll, quantity +/- updates the header count, Escape / overlay / X close it with focus back on the cart button, "View full cart" and "Checkout" land on `/cart` / `/checkout`, mobile size, empty state), and skeletons (the matching skeleton appears before the content on `/shop`, a product page and `/`, then is replaced). The mock's Black Titanium photo is a stand-in (the Sony headphones shot), labelled as such — no real colour photo exists yet. The skeleton section sets a 2s delay on the mock first (test-only endpoint `GET /__test/delay?ms=N`, cleared afterwards) because a skeleton only renders while the page waits on data and the mock answers in milliseconds; the product skeleton is checked via client-side navigation from `/shop`, since on a cold load `generateMetadata` blocks the shell (see "Loading skeletons").

Product photos resolving to Supabase Storage are covered by `tests/e2e/storage-images.mjs` (same mock setup, no admin mode needed): the server-rendered `/shop` HTML contains a Storage photo URL, loading `/shop` in a real browser shows no remotePatterns / invalid-src / CSP image error, and the rendered `<img>` elements point at the Storage URL rather than a local path. The mock serves no Storage objects, so a successful photo load cannot be proven here — the live load is verified after deploy.

## Test payment instructions (TEST MODE)

Checkout uses a **test payment adapter only** (`lib/payments/test-adapter.ts`, behind the `PaymentAdapter` interface in `lib/payments/index.ts`). No real money moves, and the adapter never collects or stores real card or bank details.

1. Set `TEST_PAYMENT_SIGNING_SECRET` in `.env.local` to any random value.
2. Place an order and choose card, bKash, Nagad or EMI. You are redirected to `/checkout/test-pay`.
3. On the test payment page, pick the outcome:
   - **Paid** — the order is marked paid. Use test card **4242 4242 4242 4242** (any future expiry, any CVC) where a card number is asked for.
   - **Failed** — the payment fails; the order stays unpaid and can be retried from the order page (**Retry payment**), which takes you back to the test payment page.
   - **Cancelled** — the payment is cancelled; the order stays unpaid.
4. COD needs no payment step: the order is placed as cash on delivery.
5. Callbacks are verified with HMAC-SHA-256 over `"<orderId>:<status>"` using `TEST_PAYMENT_SIGNING_SECRET`; a bad signature is rejected (`valid: false`). Refunds in test mode always return `{ ok: true }` because there is no real money to move.

### What happens when `TEST_PAYMENT_SIGNING_SECRET` is not set

A missing secret **must not silently break checkout**, so the two payment entry points behave differently on purpose — do not "unify" them:

- **The test payment page (`/checkout/test-pay`) still works locally.** Its server action signs and verifies the simulated callback itself; when there is no secret to sign with, signing throws and the action accepts the chosen outcome directly. That fallback is safe *only* there, because the page is a local simulation with no external caller to protect against — the outcome comes from a button the shopper clicks in their own browser, and the order it applies to is the one checkout just created in the same server process. See the comment on `testPayAction` in `app/checkout/test-pay/page.tsx`.
- **The public callback route (`POST /api/payments/callback`) fails closed.** Without a secret no signature can be verified, so every callback returns `400 "Invalid callback"` and no order status changes. This is deliberate: that route is the trust boundary for an external gateway, and accepting an unsigned callback would let anyone mark any order paid. Set `TEST_PAYMENT_SIGNING_SECRET` in `.env.local` before exercising this endpoint (or before wiring a real gateway to it).
- **A paid order shows as paid even when the payment completes by callback.** The callback updates the server-side order record, not the copy in the shopper's browser — so the order pages reconcile a still-pending browser copy against the server (`getOrderStatusFromServer` in `lib/orders-server.ts`) and adopt the server status. Without that, an order paid through the callback would say "Pending payment" forever in the browser.

To plug in a real gateway later (bKash, Nagad, or a card gateway), implement the same `PaymentAdapter` interface and wire it in where `testAdapter` is used today. Checkout code does not change — only the adapter.

## Cart — live database and local fallback

The cart works the same way for guests and signed-in users, with or without Supabase:

- **Supabase configured:** the cart is also kept in the `carts` / `cart_items` tables for signed-in users (server actions in `lib/cart-server.ts`). On sign-in the server cart is loaded — a non-empty server cart replaces the local one, an empty one means the guest cart is uploaded. Quantity changes are persisted line by line; a failed sync never breaks the local cart (it is the source of truth for the shopper). RLS (`supabase/policies.sql`: `carts_owner_all`, `cart_items_owner_all`) lets a signed-in user touch only their own cart.
- **Supabase not configured (or guest checkout):** the cart is a localStorage cart (`techshot-cart-v1`, owned by `lib/cart-store.ts`). Nothing is lost and nothing is blocked.

**Slugs — the rule that makes both modes agree.** The live database uses longer slugs than the seed catalogue for some products (live `apple-iphone-16-pro-256gb-natural-titanium` vs seed `apple-iphone-16-pro`; live `netflix-premium-1-month` vs seed `netflix-premium`). Cart lines are priced by resolving the cart slug to a product with the exact slug first, then the local/live slug that is a `<slug>-…` prefix of it (`getProductForCartSlug` in `lib/data/catalog.ts`, the same rule in `lib/cart-server.ts` and `lib/orders-server.ts`). Cart lines are priced from the **live database** when Supabase is configured (`getPricedCartLines` in `lib/cart-server.ts`, used by the cart page, the checkout form and the checkout action), and from the seed catalogue otherwise (`resolveCartLines` in `lib/orders.ts`). A product added in the admin therefore shows a price and a working checkout even though it has no seed counterpart. Variant labels are compared space- and case-insensitively (`variantMatchesOption` in `lib/catalog-rules.ts`), so a live label like `256GB Natural Titanium` matches the seed storage option `256 GB` and gets the right price delta.

**Known limitation — variant choice across devices.** The seed data has no `product_variants` rows, so a storage/colour choice (e.g. 512 GB) is stored in the server cart only as a price snapshot, not as a variant row: after signing in on another device the line comes back with the product's default variant. Quantities, prices and totals are still correct. Products created in `/admin` with variants do keep their variant through the server cart, because those rows exist.

## Automatic sync — add a product, it appears on the site

The storefront reads its catalogue **live from Supabase** on every page load (`lib/supabase/catalog.ts`; homepage, `/shop` and `/product/[slug]` are dynamic server components). There is no build step between a product change and the public site:

- **Add** a product in `/admin` and it appears on the homepage, `/shop` and search on the next page load.
- **Edit** a product (price, stock, description, image) and the new values show on the next load.
- **Pause** a product and it disappears from the public site immediately; **activate** it and it comes back.
- **Delete** a product and its detail page returns 404.

How it works: product writes go through server actions (`lib/products/actions.ts`) that validate on the server, write to the `products` table, and call `revalidatePath` for `/`, `/shop` and `/product/<slug>`. Public reads filter `status = 'active'` in the query and again in code (`lib/catalog-rules.ts`), so draft/paused products never leak to visitors. Only an admin can write products (enforced in the server actions, since the service-role client bypasses RLS); every product is store-owned (`seller_id` is always null).

If Supabase is **not configured** (no env vars), the site falls back to the local seed catalogue (`lib/data/catalog.ts`) and localStorage cart/orders/auth so it can still be previewed — but product changes made in the dashboards will not persist or appear publicly until Supabase is connected. Set `.env.local` (below) to switch the live path on.

## Mini-cart drawer

Clicking the cart icon in the header opens a slide-over mini cart (`components/MiniCartDrawer.tsx`) instead of navigating away — the page behind stays exactly where it was, with its scroll position intact. The drawer shows every line (thumbnail, title, variant, quantity +/-, line price, remove), the subtotal and the free-delivery hint (free over ৳999 — how much more is needed, or "You've got free delivery"), plus "View full cart" (→ `/cart`) and "Checkout" (→ `/checkout`); both close the panel. The empty state says "Your cart is empty" with a "Continue shopping" button that just closes it. Close with the X button, the dimmed overlay, or Escape; focus moves into the panel on open and back to the cart button on close (`role="dialog"`). Mobile: full-height, near-full-width; desktop: fixed right-side panel.

Quantities go through the **same cart store** as everything else (`useCart` / `usePricedCartLines` in `lib/cart-store.ts`) — there is no second cart state, so the header count, the drawer and `/cart` always agree. `/cart` itself is untouched.

## Colour-variant photos

Selecting a colour (or storage option) switches the gallery photo to that variant's photo when one is set, and falls back to the product photo when it is not (`components/ProductGallery.tsx`, `resolveVariantImage` in `lib/catalog-rules.ts`).

- **Schema:** `supabase/migrations/0005_product_variant_image.sql` adds `image_path` to `product_variants` — one photo per variant, sitting next to the variant it belongs to (the admin already edits variants as rows), rather than a `variant_id` on `product_images`. The value is a Storage filename / legacy local path / https URL, resolved through the same helper as product images (`lib/storage-images.ts`) into the public `product-images` bucket. No new bucket; RLS unchanged (a column, not a new table). **Apply migration 0005 live in the SQL Editor** — until then the column does not exist and no variant photo can be set.
- **Admin:** the Variants field in `/admin` accepts an optional fourth segment — `Name:price:stock:image`, e.g. `Black Titanium::5:iphone-black.jpg` (empty price keeps the base price; segments after the third are rejoined so https URLs survive). The image is validated with the same `isSafeImagePath` rule as product images, and the product list shows "· photo set" when a variant has one.
- **Real per-colour photos are still needed from the owner.** No per-colour photos exist yet: the 14 photos in Storage are per-product shots (plus 3 extra iPhone angles — angles, not colours). Every variant starts with no photo and the gallery falls back, so the shop looks exactly as before until real photos are uploaded and set per variant. The switching itself is proven by the Playwright check below, which uses an existing Storage file as a stand-in variant image — the stand-in is labelled as such in the mock and is not a real colour photo.

## Loading skeletons

Every route has its own `loading.tsx` that mirrors the real page layout, so navigation shows the matching skeleton instantly instead of a blank page: home (hero + product grid), `/shop` (filters + 9-card grid), `/product/[slug]` (gallery + info column + selectors), `/account` (user card + profile form + sections), `/admin` (form card + product rows + sections). Solid colours, `animate-pulse`, `bg-panel` — the same pattern as before, just per-route instead of one generic skeleton for everything. The cart drawer needs no skeleton: its content is synchronous from the cart store, so it opens instantly with the lines already in it.

One honest limitation, found while verifying: on a **cold load** (typing a product URL directly), the product skeleton does not appear — `generateMetadata` blocks the document shell on the same catalogue fetch the page needs, so the shell cannot flush until the data is ready. On **in-app navigation** (clicking a product card from `/shop` or home) the router shows the product skeleton for the whole fetch, which is the common case. The skeleton file stays for that reason; removing the product's `<title>` metadata to chase a cold-load skeleton would trade real SEO for nothing.

## Performance — what was slow, and what changed (2026-11-09)

Measured locally against the mock Supabase (no real keys), before and after. The production timings below are medians of 5 (curl TTFB) and Playwright `networkidle` loads; the mock's photos are tiny, so the mock cannot show the real-photo cost — the per-image numbers use the real JPEGs in `public/images/products/`.

**What was actually slow:**
1. **Image optimisation, cold.** `next/image` with the built-in squoosh optimiser (no `sharp` installed) took **1.4–2.5s per real photo** on a cold cache (iPhone 59 KB: 2.50s, Sony 43 KB: 1.66s, MacBook 73 KB: 1.38s) — and the default `minimumCacheTTL` is 60s, so a photo was re-optimised on the first visit after a minute of quiet. Nine cards on `/shop` is **13–22s of optimisation work** on a cold cache. The build log itself warned that sharp is "strongly recommended".
2. **Dev-mode compile.** `npm run dev` compiles each page on first hit: `/` 9.3s, `/shop` 6.1s, `/product` 1.7s, `/account` 0.68s, `/admin` 0.78s cold (warm: 40–150ms) — unchanged by these fixes, because it is inherent to dev mode, not a code problem.
3. **Serial Supabase round trips.** A product page fetched the catalogue three times per visit (product, related, metadata — up to 6 round trips); `/account` ran 6–7 serial queries; `/admin` about 10; and `getUser()` was re-validated on every call inside a request. Against the real project from Bangladesh (each round trip ~100–300ms to ap-southeast-1) that is 1–2s on `/account` alone, more on `/admin`. The middleware auth gate was **not** the cause: it only runs on `/admin`.

**What changed:**
- **`sharp` installed** (`npm install sharp`) and **`images.minimumCacheTTL` set to 86400 (1 day)** in `next.config.mjs`. Cold optimise of the same real photos is now **0.03–0.24s** (iPhone 0.236s on the very first request, which loads the native module once; Sony 0.034s, MacBook 0.031s; warm 2–3ms) — a cold `/shop` is ~0.3–0.5s of optimisation instead of 13–22s. Caveat: a photo re-uploaded under the **same** Storage filename takes up to a day to show the new optimised image; a new filename busts the cache immediately (the URL is the cache key).
- **Product page: one catalogue fetch per visit.** Product, related products and metadata all resolve from a single `getCatalog()` call, itself per-request cached with React `cache()` (`lib/supabase/catalog.ts`). The old per-product / per-related helpers are removed. Cost: 2 round trips (categories + products, in parallel) instead of up to 6.
- **Parallelised:** `getAccountData()` (`lib/account-server.ts`) fetches addresses / wishlist / orders with `Promise.all`; `fetchAllProducts()` / `loadExtras()` (`lib/products/queries.ts`) fetch categories + extras and images + variants in parallel.
- **`getUser()` deduped per request** with React `cache()` in `lib/auth-server.ts`, `lib/orders-server.ts` and `lib/cart-server.ts` — one Auth validation per request instead of one per call.
- **Nothing safe or fresh was weakened:** the middleware gate still runs on `/admin`, RLS is untouched, `force-dynamic` is kept where freshness matters, and every cache is per-request only — prices and stock re-fetch on every visit.

**Before / after (production, mock Supabase, localhost):**

| Route | TTFB before | TTFB after | Full load before | Full load after |
| --- | --- | --- | --- | --- |
| `/` | 22.9 ms | 39 ms | DCL ~475 ms / idle ~1.4 s | DCL 451 ms / idle 1.46 s |
| `/shop` | 22.4 ms | 31 ms | idle ~1.1 s | idle 0.92 s |
| `/product/[slug]` | 17.6 ms | 24 ms | idle ~0.74 s | idle 0.80 s |
| `/account` | 2.7 ms | 3.5 ms | content 121–147 ms (signed in) | (unchanged — data loads client-side after mount) |
| `/admin` | 3.8 ms | 3.6 ms | content 549 ms (admin) | (unchanged — guest is a 307 redirect) |
| `/seller` | 12.7 ms | 12.3 ms | 404 | 404 |

TTFB and full-load times against the mock are essentially unchanged — they were already fast, and the mock's tiny images never showed the real-photo cost. The measurable wins are the cold image optimisation (above) and the round-trip reduction, which only show up against the real project and real photos. The user's reported 30s loads (10–20s on profile/admin) are most plausibly dev-mode compile + squoosh cold optimisation of real photos + serial round trips to ap-southeast-1 — the mock cannot reproduce his exact 30s, and this README does not claim it does.

**Dev vs production:** use the production build for local use — `npm run build && npm run start` — not `npm run dev`, whose first-hit compile (9.5s for `/`) is the main thing that makes the site feel slow locally. Never run `dev` and `start` from the same checkout without rebuilding in between: they fight over `.next` (starting dev deletes `BUILD_ID` and breaks the running production server).

Sign-in and sign-up use **Supabase Auth** (`lib/auth.ts`): email/password, http-only cookie session, profile row created on sign-up with role `customer` (never `admin` — admin is granted manually in the database). There are no seller accounts: TechShot is a single-seller store (see below). Middleware (`middleware.ts`) refreshes the session from cookies and redirects unsigned users away from `/admin`, and non-admins away from `/admin`. There is no demo admin account and no demo sign-in button.

**Sign-in success + the account dashboard.** After a successful sign-in, sign-up, or email confirmation the user lands on `/account?signed_in=1` and sees a visible **"Signed in successfully"** banner (not just a console log). `/account` shows the signed-in user's name, email and role, saved addresses, order history and wishlist, plus a **Sign out** button. When Supabase is configured those sections read from Supabase (`lib/account-server.ts` `getAccountData`: the `profiles` row, `addresses`, `orders`/`order_items` and `wishlists` with their products, all owner-only under RLS); when it is not configured — or nobody is signed in — the page falls back to the browser-local data in `lib/checkout-store`. If the signed-in user's profiles row is still missing (signed up before migration 0002 was applied), `/account` creates it from the session metadata first (insert-only, never overwrites, never downgrades an admin), so the dashboard never renders empty for a signed-in user.

**How the profiles row is created** (fixed 2026-11-08 — a profile used to be lost when email confirmation was on, because sign-up then returns no session): the row is now created in three independent ways, all using the same rules in `lib/profile-rules.ts` (role is always `customer`, never `admin`; an existing row is never overwritten, so an admin can never be downgraded):
1. a database trigger (`supabase/migrations/0002_profile_trigger.sql`) creates the row the moment the `auth.users` row is inserted, and backfills rows for users who signed up before the trigger existed;
2. `ensureCurrentUserProfile()` in `lib/auth-server.ts` creates a missing row on every password sign-in and on session load, from the signed-in user's own metadata;
3. sign-up still tries `ensureProfile()` immediately when a session exists (email confirmation off).

**Making yourself admin:** sign up and sign in once (that creates your profile row), then in the Supabase SQL Editor run, with your own email:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

If your profile row is still missing entirely (you signed up before migration 0002 was applied), create it as admin in one step instead:

```sql
insert into public.profiles (id, display_name, role)
values ((select id from auth.users where email = 'you@example.com'),
        'Your Name', 'admin')
on conflict (id) do update set role = 'admin';
```

Then sign out and sign in again and open `/admin`.

Cart and orders are stored in Supabase (`carts`/`cart_items`, `orders`/`order_items`) for signed-in users when Supabase is configured; totals are always recomputed server-side from live database prices and stock is decremented on order creation (with rollback on failure). Guests and unconfigured installs keep the previous localStorage behaviour. Reviews can only be written for products in a delivered order the reviewer owns.

## What is NOT yet live

- **Apply migration 0005 on the live project.** `supabase/migrations/0005_product_variant_image.sql` adds `image_path` to `product_variants`. Until it is applied, no variant photo can be set. Migrations 0002, 0003 and 0004 were applied live on 2026-11-08.
- **Real per-colour product photos are still needed from the owner.** The gallery switches the moment a variant photo is set (see "Colour-variant photos"), but no per-colour photos exist yet — the 14 Storage photos are per-product shots. Upload the colour photos to the `product-images` bucket and set each variant's image in `/admin`.
- **Apply migration 0004 on the live project.** `supabase/migrations/0004_drop_seller_order_policy.sql` drops the legacy `orders_select_seller` policy. Until it is applied, a signed-in customer's `/orders` page shows "No orders yet" in a fresh browser (and `/account` shows no live orders) because every authenticated SELECT on `orders` fails with "infinite recursion detected in policy for relation orders". Migrations 0002 and 0003 were applied live on 2026-11-08.
- **Live verification against the TechshotBD project (first run 2026-11-08).** Verified live with a test account: live catalogue (12 seeded products), sign-in + success banner + `/account` dashboard, profile auto-created by the 0002 trigger, admin grant, admin add/pause/delete product round-trip (new products appear on `/shop` page 2 / category / search — page 1 holds 9), card order with FIRST2000 (−৳2,000) and free delivery (order confirmed, payment row paid, stock decremented), COD order, admin double-click Advance moving exactly one step with exactly one audit row, customer cancel restoring stock with the stock message, admin refund keeping the paid row and adding a refunded row, no hydration errors and no favicon errors. Still to verify after migration 0004 is applied: `/orders` in a fresh browser listing the customer's live orders. Product photos are still missing (see below), so product pages log `/_next/image` 400 errors for the absent JPEGs.
- **Product photos live in Supabase Storage, not in this repo.** The product photos are in the public `product-images` bucket in Supabase Storage (upload the JPEGs there, flat at the bucket root, keeping their filenames). The storefront maps each product's stored image — a legacy local path `/images/products/<file>.jpg`, a bare filename such as `<slug>.jpg`, or a full https URL — to its public Storage URL (`lib/storage-images.ts`); `next.config.mjs` allows the Supabase host for `next/image` and the CSP `img-src`. The seed still writes the legacy local paths, so no migration is needed to switch existing rows to Storage. To add or replace a photo: upload the file to the bucket (same filename replaces it) or set the product's image in `/admin` to the Storage filename. The local `public/images/products/` files are only the fallback when Supabase is not configured — and a fresh clone has none (the JPEGs were never pushed as binaries), so an unconfigured preview shows initials too. The three subscription products have no photos in the set, so they show initials either way.
- **Favicon is an SVG, not an .ico.** `app/icon.svg` (navy square, orange bolt) is served as the favicon because the snapshot push is UTF-8 text only and cannot carry a binary `.ico` file.
- **No Vercel deploy.** To deploy: import this repo into Vercel, set the same environment variables there, and deploy. No deploy URL exists yet.
- **No real payment gateway.** Only the test adapter described above. A real gateway needs its own adapter, merchant credentials, and webhook verification — none of that is configured.
- **No real order fulfilment.** Orders are stored in Supabase (or locally when unconfigured); there is no warehouse, courier, or email/SMS notification integration yet. Admin order status changes ARE live, though: in `/admin`, Advance / Cancel / Refund call admin-only server actions (`lib/orders/actions.ts`) that validate the transition (pending_payment → confirmed → processing → shipped → delivered; cancel only from pending_payment / confirmed; refund only from a paid order), write an `audit_log` row and revalidate the customer order pages — so a status change in `/admin` moves the order on the customer's order page too. Since the 2026-11-08 review fixes: status updates are conditional on the current status (a lost race is rejected and the caller is told to reload), and a double-clicked Advance is stopped in the admin dashboard by a synchronous in-flight guard — the second click in the same task never reaches the server, and the button disables while the action runs (the conditional update alone cannot stop it, because "advance from the new status" is legal once the first advance lands); cancel / refund restore stock (a refund from delivered is a returns flow: stock back AND test-adapter refund first), a refund calls the payment adapter before any row changes, customers cancel their own live orders through an owner-checked server action (the stock-released message appears only after the server confirms, and the outcome is stored with the browser copy of the order so the confirmation survives the page refresh the cancel triggers), payment attempts are append-only rows (a failed retry never overwrites a paid record), callbacks carry a timestamp + nonce and replays are rejected, and the admin users list no longer sends emails to the browser. Admin coupons are still stored locally in the demo store, not in Supabase. What the database does NOT store (so the order pages cannot show it from live orders): the delivery method is inferred from the delivery charge (express is exactly ৳499), savings are 0 (compare-at prices are not stored on order items) and the coupon code is empty (only the discount amount is stored).

## Security notes

- **No secrets in this repo.** `.env.local` is git-ignored; `.env.example` contains only empty placeholders. Never commit a real key.
- **Row Level Security is default-deny.** `supabase/migrations/0001_initial_schema.sql` enables RLS on every table; with no policy, a row is invisible. `supabase/policies.sql` grants: visitors read active products/categories only; customers touch only their own data; admins get full access through `is_admin()`. The `admin` role can never be set from sign-up. `payments` and `audit_log` have no non-admin policy at all. The legacy `orders_select_seller` policy was removed in migration 0004 — it read `order_items` while `order_items_select_buyer` reads `orders`, which made every authenticated SELECT on `orders` fail with infinite recursion; never re-add a policy on `orders` that reads `order_items`. Other old seller product policies remain in the file as legacy; the app never relies on them (product writes are admin-only server actions).
- **Service-role key is server-only.** It bypasses RLS and must never be imported in browser code, returned in an API response, or logged.
- **Totals are computed server-side from database prices** (`lib/pricing.ts`); a total sent by the browser is never trusted.
- **Error pages are generic.** `app/error.tsx` shows "Something went wrong." with a random reference code — no stack trace, SQL, or table names.
- **Security headers** (including a Content Security Policy) are set in `next.config.mjs`. The CSP `connect-src` allows the hosted `*.supabase.co` origins plus exactly the Supabase origin the app is configured with (`NEXT_PUBLIC_SUPABASE_URL`) when it is not a `*.supabase.co` host — that is what lets the browser reach a local mock Supabase or a self-hosted instance; with a hosted URL the header is unchanged. `script-src` adds `'unsafe-eval'` in development only: Next.js dev mode evaluates modules with eval, and without it every page throws EvalError and client-side JavaScript (including sign-in) silently stops working in `npm run dev`; production builds never use eval, so the production header stays strict.
- **Middleware enforces auth** (`middleware.ts`): it refreshes the Supabase session from cookies and redirects unsigned users away from `/admin`, and non-admins away from `/admin`. When Supabase is not configured it passes requests through (the site still previews on the local fallback catalogue).

## Project structure

How the code is organised (2026-11-09 cleanup) — the full map lives in
[`CODEBASE.md`](./CODEBASE.md), read that first when you are new here.

Rules: **one file, one job** (a file past ~300 lines or doing a second
job is split into focused modules in a folder named after it);
**every file carries a short header** saying what it does; when code
moves, the original file stays as a thin re-export **barrel** so every
existing import path keeps working. Server actions keep `"use server"`
in the files where they are defined — never in a barrel (Next.js
forbids re-exports from a `"use server"` file, so a barrel with the
directive fails the production build).

```
app/
  (storefront)        Home page
  shop/               Product listing, search, category filters
  product/[slug]/     Product detail
  cart/               Cart page (thin composition; pieces in components/cart/)
  checkout/           Checkout, test payment page (form in components/checkout/)
  orders/             Order list and detail (pieces in components/order-detail/)
  account/            Customer account (pieces in components/account/)
  auth/               Sign in, sign up, auth callback
  admin/              Admin dashboard tabs: Overview, Products, Orders, Users
  error.tsx           Generic error boundary
  loading.tsx         Loading skeleton (home; also the fallback for routes without their own file)
  shop/loading.tsx    Shop skeleton (filters + grid)
  product/[slug]/loading.tsx  Product skeleton (gallery + info column)
  account/loading.tsx Account skeleton
  admin/loading.tsx   Admin skeleton
  not-found.tsx       404 page
components/
  ui.tsx              Shared primitives: Button, Card, Badge, Input, Select, Field, EmptyState, SectionHeading
  Stars.tsx           Rating stars
  ProductCard.tsx     Product card
  MiniCartDrawer.tsx  Slide-over mini cart (header cart button; same cart store as /cart)
  product-gallery/    Product photos: gallery (slider), photo-viewer (fullscreen zoom), product-detail, review-form
  product-manager/    Admin product form + list + helpers (ProductManager.tsx is the barrel)
  cart/               Cart page pieces: cart-summary, coupon-box
  checkout/           Checkout steps: checkout-form, address-step, payment-step
  order-detail/       Order page pieces: summary, timeline, items
  account/            Account page pieces: profile, addresses, orders, wishlist
  admin/              Admin dashboard shell + coupons section
  admin-orders/       Admin orders tab: orders-list, status-controls
  Header.tsx / Footer.tsx
lib/
  theme.ts            Design tokens, formatBDT, pricing constants
  data/catalog/       Local seed catalogue (fallback when Supabase is not configured)
  catalog/            Pure catalogue rules: db-types, brands-variants, mapping, specs-gallery
  supabase/catalog.ts Live catalogue reads from Supabase
  products/           Product server actions (upload, create-update, manage), validation, server reads
  cart-store.ts       Cart state (Supabase when signed in, localStorage fallback)
  checkout/           Checkout browser store: types, storage (localStorage), validation
  cart/server/        Server cart sync (Supabase carts/cart_items)
  orders/server/      Server order creation from live DB prices, order status, callbacks, reviews
  orders/actions/     Order server actions: status (Advance / set), cancel, shared engine
  orders/checkout/    Checkout maths: totals, coupons, validation, in-memory order store
  orders/             transitions.ts (legal status moves), stock.ts (stock guards)
  auth-server/        Server auth helpers: session, profile, admin-users
  account-server.ts   Server account data (profile, addresses, orders, wishlist)
  profile-rules.ts    Pure profile creation rules (role never admin, never overwrite)
  account-rules.ts    Pure account mapping/merge/validation rules (DB <-> browser shapes)
  roles.ts            Roles: Owner / Co-admin / Manager / Customer and what each may do
  reviews.ts          Review rules (real reviews only; login + delivered order to write)
  admin/stats.ts      Admin overview numbers
  pricing.ts          Delivery + coupon + totals (pure functions, poisha)
  payments/           PaymentAdapter interface + test adapter
  supabase/           Supabase browser/server clients and types
  auth.ts             Supabase Auth (email/password, cookie session)
  demo-store.ts       Legacy local demo data (admin coupons, order-status overrides) — being retired
supabase/
  migrations/0001_initial_schema.sql
  migrations/0002_profile_trigger.sql  Creates profiles rows on sign-up + backfills missing ones
  migrations/0003_order_items_variant.sql  Records which variant row each order line decremented (cancel / refund stock restore)
  migrations/0004_drop_seller_order_policy.sql  Drops orders_select_seller (fixed RLS infinite recursion)
  migrations/0005_product_variant_image.sql  Adds image_path to product_variants (one photo per variant)
  migrations/0006_roles.sql  Roles: co_admin + manager (Owner stays role "admin")
  migrations/0007_order_returned.sql  Adds "returned" order status (customer did not take the order)
  migrations/0008_product_warranty_specs.sql  Adds warranty + specifications to products
  policies.sql        Row Level Security policies
  seed.sql            Categories, products, FIRST2000 coupon
tests/
  ts-hooks.mjs        Module hooks so node --test can import the real TS modules (resolves real files only, never directories)
  register-ts-loader.mjs  Registers ts-hooks.mjs (see package.json "test")
  pricing.test.mjs    Pricing rule-table tests (node:test)
  payments.test.mjs   Test-payment adapter tests (node:test, real adapter)
  cart.test.mjs       Cart pricing rules: live slugs, variants, totals (node:test)
  catalog.test.mjs    Live-catalogue visibility rules (add/delete/pause, DB prices)
  mini-cart.test.mjs  Mini-cart drawer: shared store, dialog, lines, subtotal, free-delivery hint
  variant-images.test.mjs  Per-variant photos: resolution, mapping, admin format, migration 0005
  skeletons.test.mjs  Per-route loading.tsx files exist and match their page layouts
  performance.test.mjs  Single catalogue fetch, parallel queries, getUser dedupe, sharp + cache TTL
  products-actions.test.mjs  Product slug/validation helpers
  profile.test.mjs    Profile creation rules (sign-in creates a missing profile, never admin, never overwrite)
  account.test.mjs    Account dashboard rules (address/wishlist mapping, order merge, sign-in banner + dashboard wiring)
  roles.test.mjs      Roles + admin tabs + order-status rules (node:test)
  order-status.test.mjs  Order status transitions incl. returned, manual set
  gallery.test.mjs    Gallery slider / viewer / multi-photo rules
  e2e/                Mock Supabase + Playwright click-through (see "End-to-end checks")
middleware.ts         Supabase session + role check for /admin
CODEBASE.md           Beginner's map of the whole codebase: rules, folders, where to find things
```

## Contributing

Keep the rules that define this project: solid colours only, no gradients, no emoji, BDT and Bangladesh localisation, no database or codebase details leaked to the user, and no real credentials in the repo.
