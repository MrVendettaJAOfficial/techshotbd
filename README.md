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
| `npm test`        | `node --test tests/*.test.mjs` (pricing, payments, catalogue, product actions, profile creation) |

## Test payment instructions (TEST MODE)

Checkout uses a **test payment adapter only** (`lib/payments/test-adapter.ts`, behind the `PaymentAdapter` interface in `lib/payments/index.ts`). No real money moves, and the adapter never collects or stores real card or bank details.

1. Set `TEST_PAYMENT_SIGNING_SECRET` in `.env.local` to any random value.
2. Place an order and choose card, bKash, Nagad or EMI. You are redirected to `/checkout/test-pay`.
3. On the test payment page, pick the outcome:
   - **Paid** — the order is marked paid. Use test card **4242 4242 4242 4242** (any future expiry, any CVC) where a card number is asked for.
   - **Failed** — the payment fails; the order stays unpaid and can be retried.
   - **Cancelled** — the payment is cancelled; the order stays unpaid.
4. COD needs no payment step: the order is placed as cash on delivery.
5. Callbacks are verified with HMAC-SHA-256 over `"<orderId>:<status>"` using `TEST_PAYMENT_SIGNING_SECRET`; a bad signature is rejected (`valid: false`). Refunds in test mode always return `{ ok: true }` because there is no real money to move.

To plug in a real gateway later (bKash, Nagad, or a card gateway), implement the same `PaymentAdapter` interface and wire it in where `testAdapter` is used today. Checkout code does not change — only the adapter.

## Automatic sync — add a product, it appears on the site

The storefront reads its catalogue **live from Supabase** on every page load (`lib/supabase/catalog.ts`; homepage, `/shop` and `/product/[slug]` are dynamic server components). There is no build step between a product change and the public site:

- **Add** a product in `/seller` (your own products) or `/admin` (any product) and it appears on the homepage, `/shop` and search on the next page load.
- **Edit** a product (price, stock, description, image) and the new values show on the next load.
- **Pause** a product and it disappears from the public site immediately; **activate** it and it comes back.
- **Delete** a product and its detail page returns 404.

How it works: product writes go through server actions (`lib/products/actions.ts`) that validate on the server, write to the `products` table, and call `revalidatePath` for `/`, `/shop` and `/product/<slug>`. Public reads filter `status = 'active'` in the query and again in code (`lib/catalog-rules.ts`), so draft/paused products never leak to visitors. A seller can only touch their own products; an admin can touch all of them (enforced in the server actions, since the service-role client bypasses RLS).

If Supabase is **not configured** (no env vars), the site falls back to the local seed catalogue (`lib/data/catalog.ts`) and localStorage cart/orders/auth so it can still be previewed — but product changes made in the dashboards will not persist or appear publicly until Supabase is connected. Set `.env.local` (below) to switch the live path on.

## Supabase Auth

Sign-in and sign-up use **Supabase Auth** (`lib/auth.ts`): email/password, http-only cookie session, profile row created on sign-up with role `customer` or `seller` (never `admin` — admin is granted manually in the database). Seller accounts need admin approval before they can publish products. Middleware (`middleware.ts`) refreshes the session from cookies and redirects unsigned users away from `/seller` and `/admin`, and non-admins away from `/admin`. There is no demo admin account and no demo sign-in button.

**How the profiles row is created** (fixed 2026-11-08 — a profile used to be lost when email confirmation was on, because sign-up then returns no session): the row is now created in three independent ways, all using the same rules in `lib/profile-rules.ts` (role is `customer` or `seller` only, never `admin`; an existing row is never overwritten, so an admin can never be downgraded):
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

- **Live verification against the TechshotBD project has not been done yet.** The live code path (Supabase catalogue, Auth, cart/orders) is tested with unit tests and a mocked client only, because no Supabase keys were available to the build. To verify: set `.env.local` from your Supabase project (Settings, API Keys — use the publishable and secret keys), run `npm run dev`, add a test product in `/admin` and check it appears on `/shop`, then delete it and check it disappears.
- **Product photos are not in this repo.** The Figma product photos (JPEGs) could not be pushed as binary files, so `public/images/products/` ships empty. After cloning, copy the product photos into `public/images/products/` (filenames in `lib/data/catalog.ts`) or upload them to Supabase Storage and update the catalogue image paths. Until then every product card shows a solid-colour card with the product's initial letter (`components/ProductImage.tsx`) — the storefront works either way. The product form also accepts an image URL or Storage path per product.
- **No Vercel deploy.** To deploy: import this repo into Vercel, set the same environment variables there, and deploy. No deploy URL exists yet.
- **No real payment gateway.** Only the test adapter described above. A real gateway needs its own adapter, merchant credentials, and webhook verification — none of that is configured.
- **No real order fulfilment.** Orders are stored in Supabase (or locally when unconfigured); there is no warehouse, courier, or email/SMS notification integration yet.

## Security notes

- **No secrets in this repo.** `.env.local` is git-ignored; `.env.example` contains only empty placeholders. Never commit a real key.
- **Row Level Security is default-deny.** `supabase/migrations/0001_initial_schema.sql` enables RLS on every table; with no policy, a row is invisible. `supabase/policies.sql` grants: visitors read active products/categories only; customers touch only their own data; sellers touch only their own products and order items; admins get full access through `is_admin()`. The `admin` role can never be set from sign-up. `payments` and `audit_log` have no non-admin policy at all.
- **Service-role key is server-only.** It bypasses RLS and must never be imported in browser code, returned in an API response, or logged.
- **Totals are computed server-side from database prices** (`lib/pricing.ts`); a total sent by the browser is never trusted.
- **Error pages are generic.** `app/error.tsx` shows "Something went wrong." with a random reference code — no stack trace, SQL, or table names.
- **Security headers** (including a Content Security Policy) are set in `next.config.mjs`.
- **Middleware enforces auth** (`middleware.ts`): it refreshes the Supabase session from cookies and redirects unsigned users away from `/seller` and `/admin`, and non-admins away from `/admin`. When Supabase is not configured it passes requests through (the site still previews on the local fallback catalogue).

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
  seller/             Seller dashboard (products, orders, approval gate)
  admin/              Admin dashboard (approvals, moderation, orders, coupons, users)
  error.tsx           Generic error boundary
  loading.tsx         Loading skeleton
  not-found.tsx       404 page
components/
  ui.tsx              Shared primitives: Button, Card, Badge, Input, Select, Field, EmptyState, SectionHeading
  Stars.tsx           Rating stars
  ProductCard.tsx     Product card
  ProductManager.tsx  Seller/admin product form + list (server actions)
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
  profile-rules.ts    Pure profile creation rules (role never admin, never overwrite)
  pricing.ts          Delivery + coupon + totals (pure functions, poisha)
  payments/           PaymentAdapter interface + test adapter
  supabase/           Supabase browser/server clients and types
  auth.ts             Supabase Auth (email/password, cookie session)
  demo-store.ts       Legacy local demo data (seller approvals, admin coupons) — being retired
supabase/
  migrations/0001_initial_schema.sql
  migrations/0002_profile_trigger.sql  Creates profiles rows on sign-up + backfills missing ones
  policies.sql        Row Level Security policies
  seed.sql            Categories, products, FIRST2000 coupon
tests/
  pricing.test.mjs    Pricing rule-table tests (node:test)
  payments.test.mjs   Test-payment adapter contract tests (node:test)
  catalog.test.mjs    Live-catalogue visibility rules (add/delete/pause, DB prices)
  products-actions.test.mjs  Product slug/validation helpers
  profile.test.mjs    Profile creation rules (sign-in creates a missing profile, never admin, never overwrite)
middleware.ts         Supabase session + role check for /seller and /admin
```

## Contributing

Keep the rules that define this project: solid colours only, no gradients, no emoji, BDT and Bangladesh localisation, no database or codebase details leaked to the user, and no real credentials in the repo.
