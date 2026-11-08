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

## Supabase Auth

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

- **Live verification against the TechshotBD project has not been done yet.** The live code path (Supabase catalogue, Auth, cart/orders) is tested with unit tests and a mocked Supabase (see "End-to-end checks" above), because no Supabase keys were available to the build. To verify: set `.env.local` from your Supabase project (Settings, API Keys — use the publishable and secret keys), run `npm run dev`, add a test product in `/admin` and check it appears on `/shop`, then delete it and check it disappears.
- **Product photos are not in this repo.** The Figma product photos (JPEGs) could not be pushed as binary files, so `public/images/products/` ships empty. After cloning, copy the product photos into `public/images/products/` (filenames in `lib/data/catalog.ts`) or upload them to Supabase Storage and update the catalogue image paths. Until then every product card shows a solid-colour card with the product's initial letter (`components/ProductImage.tsx`) — the storefront works either way. The product form also accepts an image URL or Storage path per product.
- **No Vercel deploy.** To deploy: import this repo into Vercel, set the same environment variables there, and deploy. No deploy URL exists yet.
- **No real payment gateway.** Only the test adapter described above. A real gateway needs its own adapter, merchant credentials, and webhook verification — none of that is configured.
- **No real order fulfilment.** Orders are stored in Supabase (or locally when unconfigured); there is no warehouse, courier, or email/SMS notification integration yet. Admin order status changes ARE live, though: in `/admin`, Advance / Cancel / Refund call admin-only server actions (`lib/orders/actions.ts`) that validate the transition (pending_payment → confirmed → processing → shipped → delivered; cancel only from pending_payment / confirmed; refund only from a paid order), write an `audit_log` row and revalidate the customer order pages — so a status change in `/admin` moves the order on the customer's order page too. Admin coupons are still stored locally in the demo store, not in Supabase.

## Security notes

- **No secrets in this repo.** `.env.local` is git-ignored; `.env.example` contains only empty placeholders. Never commit a real key.
- **Row Level Security is default-deny.** `supabase/migrations/0001_initial_schema.sql` enables RLS on every table; with no policy, a row is invisible. `supabase/policies.sql` grants: visitors read active products/categories only; customers touch only their own data; admins get full access through `is_admin()`. The `admin` role can never be set from sign-up. `payments` and `audit_log` have no non-admin policy at all. Note: `supabase/policies.sql` still contains the old seller product/order policies from before the single-seller change — they are legacy, the app never relies on them (product writes are admin-only server actions), and they were not re-applied as part of that change.
- **Service-role key is server-only.** It bypasses RLS and must never be imported in browser code, returned in an API response, or logged.
- **Totals are computed server-side from database prices** (`lib/pricing.ts`); a total sent by the browser is never trusted.
- **Error pages are generic.** `app/error.tsx` shows "Something went wrong." with a random reference code — no stack trace, SQL, or table names.
- **Security headers** (including a Content Security Policy) are set in `next.config.mjs`. The CSP `connect-src` allows the hosted `*.supabase.co` origins plus exactly the Supabase origin the app is configured with (`NEXT_PUBLIC_SUPABASE_URL`) when it is not a `*.supabase.co` host — that is what lets the browser reach a local mock Supabase or a self-hosted instance; with a hosted URL the header is unchanged.
- **Middleware enforces auth** (`middleware.ts`): it refreshes the Supabase session from cookies and redirects unsigned users away from `/admin`, and non-admins away from `/admin`. When Supabase is not configured it passes requests through (the site still previews on the local fallback catalogue).

## Project structure

```
app/
  (storefront)        Home page
  shop/               Product listing, search, category filters
  product/[slug]/     Product detail
  cart/               Cart
  checkout/           Checkout, test payment page
  orders/             Order list and detail
  account/            Customer account
  auth/               Sign in, sign up, auth callback
  admin/              Admin dashboard (product moderation, orders, coupons, users)
  error.tsx           Generic error boundary
  loading.tsx         Loading skeleton
  not-found.tsx       404 page
components/
  ui.tsx              Shared primitives: Button, Card, Badge, Input, Select, Field, EmptyState, SectionHeading
  Stars.tsx           Rating stars
  ProductCard.tsx     Product card
  ProductManager.tsx  Admin product form + list (server actions)
  Header.tsx / Footer.tsx
lib/
  theme.ts            Design tokens, formatBDT, pricing constants
  data/catalog.ts     Local seed catalogue (fallback when Supabase is not configured)
  catalog-rules.ts    Pure catalogue visibility/mapping rules (public = active only)
  supabase/catalog.ts Live catalogue reads from Supabase
  products/           Product server actions, validation, server reads
  cart-store.ts       Cart state (Supabase when signed in, localStorage fallback)
  checkout-store.ts   Cart/checkout/orders/account state: listOrders, updateOrderStatus
  cart-server.ts      Server cart sync (Supabase carts/cart_items)
  orders-server.ts    Server order creation from live DB prices, order status, reviews
  auth-server.ts      Server auth helpers (profile, listUsers, code exchange)
  account-server.ts   Server account data (profile, addresses, orders, wishlist)
  profile-rules.ts    Pure profile creation rules (role never admin, never overwrite)
  account-rules.ts    Pure account mapping/merge/validation rules (DB <-> browser shapes)
  pricing.ts          Delivery + coupon + totals (pure functions, poisha)
  payments/           PaymentAdapter interface + test adapter
  supabase/           Supabase browser/server clients and types
  auth.ts             Supabase Auth (email/password, cookie session)
  demo-store.ts       Legacy local demo data (admin coupons, order-status overrides) — being retired
supabase/
  migrations/0001_initial_schema.sql
  migrations/0002_profile_trigger.sql  Creates profiles rows on sign-up + backfills missing ones
  policies.sql        Row Level Security policies
  seed.sql            Categories, products, FIRST2000 coupon
tests/
  ts-hooks.mjs        Module hooks so node --test can import the real TS modules
  register-ts-loader.mjs  Registers ts-hooks.mjs (see package.json "test")
  pricing.test.mjs    Pricing rule-table tests (node:test)
  payments.test.mjs   Test-payment adapter tests (node:test, real adapter)
  cart.test.mjs       Cart pricing rules: live slugs, variants, totals (node:test)
  catalog.test.mjs    Live-catalogue visibility rules (add/delete/pause, DB prices)
  products-actions.test.mjs  Product slug/validation helpers
  profile.test.mjs    Profile creation rules (sign-in creates a missing profile, never admin, never overwrite)
  account.test.mjs    Account dashboard rules (address/wishlist mapping, order merge, sign-in banner + dashboard wiring)
  e2e/                Mock Supabase + Playwright click-through (see "End-to-end checks")
middleware.ts         Supabase session + role check for /admin
```

## Contributing

Keep the rules that define this project: solid colours only, no gradients, no emoji, BDT and Bangladesh localisation, no database or codebase details leaked to the user, and no real credentials in the repo.
