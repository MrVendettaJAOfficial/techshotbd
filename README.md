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

1. Create a Supabase project you own (https://supabase.com/dashboard). Do not use anyone else's project or keys.
2. In the Supabase **SQL editor**, apply the files in order:
   1. `supabase/migrations/0001_initial_schema.sql`
   2. `supabase/policies.sql`
   3. `supabase/seed.sql`
3. Set in `.env.local`:
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
| `npm test`        | `node --test tests/*.test.mjs` (pricing + test-payment contract tests) |

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

## Demo auth (before Supabase Auth is wired in)

Until Supabase Auth is connected, sign-in/sign-up use a **local demo store** (`lib/auth.ts`):

- Accounts live in the browser's localStorage only. Passwords are stored as salted SHA-256 hashes (WebCrypto), never in plain text.
- Sign-up offers **customer** or **seller** only. The `admin` role is never assignable from sign-up.
- Seller accounts need **admin approval** before they can publish products. Sign-up as a seller creates a pending approval, decided on `/admin`.
- Admin access is granted manually. In the demo, `/admin` offers a clearly labelled **"Sign in as demo admin"** button that creates a local-only admin session (no password). It is deleted when Supabase Auth lands.
- Demo seller/admin data (added products, pauses, approvals, coupons, order-status changes) lives in localStorage via `lib/demo-store.ts`. Seller-added products appear on the shop page in a "New from sellers" section (`components/SellerProductsSection.tsx`). Pauses/edits/removals of base-catalogue products apply in the seller and admin dashboards only; they will apply to the public shop once products come from Supabase instead of the local catalogue.

When Supabase is configured, `lib/auth.ts` is replaced by Supabase Auth and the demo store is deleted. The auth callback page (`app/auth/callback/page.tsx`) is a placeholder until then.

## What is NOT yet live

- **No real Supabase project is connected.** The storefront runs on the local seed catalogue (`lib/data/catalog.ts`) and browser localStorage (cart, checkout, orders, demo auth). To go live: create your own Supabase project, apply the SQL files above, set `.env.local`, and replace the local stores with Supabase queries.
- **Product photos are not in this repo.** The Figma product photos (JPEGs) could not be pushed as binary files, so `public/images/products/` ships empty. After cloning, copy the product photos into `public/images/products/` (filenames in `lib/data/catalog.ts`) or upload them to Supabase Storage and update the catalogue image paths. Until then every product card shows a solid-colour card with the product's initial letter (`components/ProductImage.tsx`) — the storefront works either way.
- **No Vercel deploy.** To deploy: import this repo into Vercel, set the same environment variables there, and deploy. No deploy URL exists yet.
- **No real payment gateway.** Only the test adapter described above. A real gateway needs its own adapter, merchant credentials, and webhook verification — none of that is configured.
- **No real order fulfilment.** Orders are stored locally; there is no warehouse, courier, or email/SMS notification integration yet.

## Security notes

- **No secrets in this repo.** `.env.local` is git-ignored; `.env.example` contains only empty placeholders. Never commit a real key.
- **Row Level Security is default-deny.** `supabase/migrations/0001_initial_schema.sql` enables RLS on every table; with no policy, a row is invisible. `supabase/policies.sql` grants: visitors read active products/categories only; customers touch only their own data; sellers touch only their own products and order items; admins get full access through `is_admin()`. The `admin` role can never be set from sign-up. `payments` and `audit_log` have no non-admin policy at all.
- **Service-role key is server-only.** It bypasses RLS and must never be imported in browser code, returned in an API response, or logged.
- **Totals are computed server-side from database prices** (`lib/pricing.ts`); a total sent by the browser is never trusted.
- **Error pages are generic.** `app/error.tsx` shows "Something went wrong." with a random reference code — no stack trace, SQL, or table names.
- **Security headers** (including a Content Security Policy) are set in `next.config.mjs`.
- **Middleware is a pass-through** (`middleware.ts`) because demo auth lives in localStorage, which middleware cannot read. Seller/admin pages enforce access in the browser with `useAuth`. When Supabase Auth is connected, middleware must be replaced with a real cookie-session check.

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
  SellerProductsSection.tsx  Seller-added products on the shop page (demo store)
  Header.tsx / Footer.tsx
lib/
  theme.ts            Design tokens, formatBDT, pricing constants
  data/catalog.ts     Local seed catalogue (replaced by Supabase queries when live)
  cart-store.ts       Cart state (localStorage)
  checkout-store.ts   Cart/checkout/orders/account state (localStorage): listOrders, updateOrderStatus
  pricing.ts          Delivery + coupon + totals (pure functions, poisha)
  payments/           PaymentAdapter interface + test adapter
  supabase/           Supabase browser/server clients and types
  auth.ts             DEMO auth store (localStorage; replaced by Supabase Auth)
  demo-store.ts       DEMO seller/admin stores (localStorage)
supabase/
  migrations/0001_initial_schema.sql
  policies.sql        Row Level Security policies
  seed.sql            Categories, products, FIRST2000 coupon
tests/
  pricing.test.mjs    Pricing rule-table tests (node:test)
  payments.test.mjs   Test-payment adapter contract tests (node:test)
middleware.ts         Pass-through (see Security notes)
```

## Contributing

Keep the rules that define this project: solid colours only, no gradients, no emoji, BDT and Bangladesh localisation, no database or codebase details leaked to the user, and no real credentials in the repo.
