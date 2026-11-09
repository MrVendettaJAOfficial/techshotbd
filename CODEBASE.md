# TechShot — Codebase Map

A beginner's guide to where everything lives in this project. Read this
first when you are new here: it tells you which file does which job, so
you never have to search the whole tree to find something.

## The rules this codebase follows

1. **One file, one job.** A file does one thing. When a file grows past
   ~300 lines or starts doing a second job, it is split into focused
   modules in a folder named after it (for example,
   `components/ProductGallery.tsx` is a thin barrel; the real code lives
   in `components/product-gallery/`).
2. **Every file has a header.** The first lines of every file say what
   the file does. If a file has no header, that is a bug — add one.
3. **Barrels keep old imports working.** When code moves into a folder,
   the original file stays behind as a thin re-export barrel, so
   `import ... from "@/lib/orders-server"` still works. The barrel's
   comment says where the code moved to.
4. **Server actions live where they are defined.** A file with
   `"use server"` may only export async functions. Barrels therefore
   never carry `"use server"` — the directive lives in the files where
   the actions are defined, and the barrel only re-exports them.
5. **No behaviour change by moving code.** Splitting a file must not
   change what the app does. The test suite (`npm test`) and the
   production build (`npm run build`) are the proof.

## The big picture

```
TechShot (Next.js 14 + TypeScript + Supabase)
├── app/          Pages and routes — what the user visits
├── components/   Reusable UI pieces the pages are built from
├── lib/          Business logic — no screens, just rules and data
├── supabase/     Database: migrations, policies, seed data
├── tests/        Unit tests (tests/*.test.mjs) + browser tests (tests/e2e/)
├── middleware.ts Route guard — who may open /admin
└── next.config.mjs  Images, security headers, build settings
```

Supabase is the backend: Postgres tables, Auth (sign-in), and the
public `product-images` Storage bucket for product photos. The shop is
single-seller — the owner is the only seller, products are managed in
`/admin`, and payments are test-only (bKash / Nagad / card test + COD).

## Pages — `app/`

Each folder is a route. `page.tsx` is the page itself; `loading.tsx`
is the skeleton shown while it loads.

| Route | File | Job |
|---|---|---|
| `/` | `app/page.tsx` | Home: hero, flash sale, product grid |
| `/shop` | `app/shop/page.tsx` | Product listing with filters |
| `/product/[slug]` | `app/product/[slug]/page.tsx` | One product: gallery, variants, reviews |
| `/cart` | `app/cart/page.tsx` | Cart page (thin composition; pieces in `components/cart/`) |
| `/checkout` | `app/checkout/page.tsx` + `CheckoutForm.tsx` | Checkout steps (form lives in `components/checkout/`) |
| `/checkout/confirmation` | `app/checkout/confirmation/page.tsx` | Order placed screen |
| `/checkout/test-pay` | `app/checkout/test-pay/page.tsx` | Test payment buttons (test mode only) |
| `/orders` | `app/orders/page.tsx` | Customer's orders, tabbed by status |
| `/orders/[id]` | `app/orders/[id]/page.tsx` | One order: tracker, items, cancel (pieces in `components/order-detail/`) |
| `/account` | `app/account/page.tsx` | Profile, addresses, orders, wishlist (pieces in `components/account/`) |
| `/admin` | `app/admin/page.tsx` + `AdminDashboard.tsx` | Admin tabs: Overview, Products, Orders, Users (pieces in `components/admin*/`) |
| `/auth/*` | `app/auth/sign-in`, `sign-up`, `callback` | Sign-in, sign-up, OAuth callback |
| `/api/payments/callback` | `app/api/payments/callback/route.ts` | Signed test-payment callback |

## UI pieces — `components/`

| Folder / file | Job |
|---|---|
| `components/product-gallery/` | Product photos: `gallery.tsx` (slider + thumbnails), `photo-viewer.tsx` (fullscreen zoom, pinch/swipe), `product-detail.tsx` (price, variants, add to cart), `review-form.tsx` (write a review) |
| `components/product-manager/` | Admin product form (`product-form.tsx`), product list (`product-list.tsx`), shared bits (`helpers.ts`) |
| `components/cart/` | Cart page pieces: `cart-summary.tsx` (totals + checkout link), `coupon-box.tsx` |
| `components/checkout/` | Checkout steps: `checkout-form.tsx`, `address-step.tsx`, `payment-step.tsx` |
| `components/order-detail/` | Order page pieces: `summary.tsx`, `timeline.tsx`, `items.tsx` |
| `components/account/` | Account page pieces: `profile-section.tsx`, `addresses-section.tsx`, `orders-section.tsx`, `wishlist-section.tsx` |
| `components/admin/` | Admin dashboard shell (`dashboard-shell.tsx`) and coupons (`coupons-section.tsx`) |
| `components/admin-orders/` | Admin orders tab: `orders-list.tsx`, `status-controls.tsx` (status selector, Advance, Cancel, Refund) |
| `components/Header.tsx`, `Footer.tsx` | Site header (cart button + mini-cart) and footer |
| `components/Logo.tsx` | Brand wordmark (code-built, no image): TS monogram, "TechShot" in extra-bold Montserrat + green "BD", tagline; header hides the tagline on mobile, footer always shows it |
| `components/MiniCartDrawer.tsx` | Slide-over mini cart |
| `components/ProductCard.tsx`, `ProductImage.tsx`, `Stars.tsx` | Product card, photo with fallback, star rating |
| `components/AdminStats.tsx`, `AdminUsers.tsx`, `TabBar.tsx` | Admin stats cards, users tab, tab bar |
| `components/ui.tsx`, `admin-helpers.ts` | Shared buttons/inputs and small admin helpers |
| `components/FlashCountdown.tsx`, `NewsletterForm.tsx` | Flash-sale countdown, newsletter form |

## Business logic — `lib/`

| Folder / file | Job |
|---|---|
| `lib/catalog/` | Turning database rows into shop products: `db-types.ts` (row shapes), `brands-variants.ts` (brand / colour / storage names), `mapping.ts` (row → product), `specs-gallery.ts` (specs + gallery list) |
| `lib/catalog-rules.ts` | Barrel for `lib/catalog/` |
| `lib/data/catalog/` | Fallback catalogue used when Supabase is not configured: `seed-products.ts` (the products), `types.ts`, `helpers.ts` |
| `lib/products/actions/` | Product server actions: `upload.ts` (photo upload), `create-update.ts`, `manage.ts` (status, delete), `shared.ts` (staff gate, writers) |
| `lib/products/validation.ts` | Barrel for `lib/products/validation/` (`slug-money`, `image-paths`, `variants`, `upload`, `schema`) |
| `lib/products/queries.ts`, `types.ts` | Reading products for admin, product shapes |
| `lib/orders/server/` | Order server functions: `create.ts`, `list.ts`, `status.ts`, `callback.ts` (payment callbacks), `reviews.ts`, `shared.ts` |
| `lib/orders/actions/` | Order server actions: `status.ts` (Advance / set status), `cancel.ts` (customer cancel), `shared.ts` (conditional update, refund, stock restore, audit) |
| `lib/orders/checkout/` | Checkout maths: `totals.ts`, `coupons.ts`, `validation.ts` (stock + address), `memory-store.ts` (browser-only orders) |
| `lib/orders/` | `transitions.ts` (which status may follow which), `stock.ts` (stock guards) |
| `lib/orders-server.ts`, `lib/orders/actions.ts`, `lib/orders.ts` | Barrels for the three folders above |
| `lib/cart/server/` | Server cart: `lines.ts` (priced lines), `sync.ts` (sync / clear), `shared.ts` |
| `lib/cart-store.ts` | Browser cart store (client) |
| `lib/checkout/` | Checkout browser store: `types.ts`, `storage.ts` (localStorage), `validation.ts` |
| `lib/auth-server/` | Auth server actions: `session.ts` (current user, role), `profile.ts`, `admin-users.ts` (Owner-only role changes) |
| `lib/auth.ts` | Browser Supabase auth + context |
| `lib/roles.ts` | Roles: Owner / Co-admin / Manager / Customer and what each may do |
| `lib/reviews.ts` | Review rules (real reviews only; login + delivered order to write) |
| `lib/admin/stats.ts` | Overview numbers (products, orders, delivered, paid, returned…) |
| `lib/account-server.ts`, `lib/account-rules.ts`, `lib/profile-rules.ts` | Account dashboard actions and profile rules |
| `lib/payments/` | Payment adapter: `index.ts`, `test-adapter.ts` (test mode only) |
| `lib/gallery.ts` | Gallery helpers (auto-slide timing, swipe, pinch) |
| `lib/storage-images.ts` | Product photo URLs → public Storage bucket |
| `lib/pricing.ts`, `lib/theme.ts` | BDT prices / delivery rules, colours |
| `lib/supabase/` | Supabase clients (`client.ts`, `server.ts`), catalogue fetch (`catalog.ts`), database types (`types.ts`) |
| `lib/demo-store.ts` | Local demo data used when Supabase is not configured |
| `middleware.ts` | Route guard: `/admin` needs a signed-in staff role |

## Database — `supabase/`

| File | Job |
|---|---|
| `supabase/migrations/0001_initial_schema.sql` … `0008_*.sql` | Database changes, in order. Never edit an applied migration — add a new one. |
| `supabase/policies.sql` | Row Level Security: who may read/write each table |
| `supabase/seed.sql` | Starting catalogue (12 products), categories, FIRST2000 coupon |

## Tests — `tests/`

- `tests/*.test.mjs` — unit tests, run with `npm test` (281 tests).
  Some tests read source files as text to pin a mechanism in place;
  when code moves, update the *read path* in the test, never weaken
  the assertion.
- `tests/e2e/` — Playwright browser tests against the mock Supabase
  (`mock-supabase.mjs`, port 3101): `smoke.mjs` (buy a product end to
  end), `roles-admin-tabs.mjs`, `mini-cart-variant-photos.mjs`,
  `gallery.mjs`, `review-fixes.mjs`, `storage-images.mjs`,
  `responsive-gallery.mjs`, `orders-fresh-browser.mjs`.
- `tests/ts-hooks.mjs` — test loader: resolves the `@/` alias and
  extensionless imports. It only resolves real files, never
  directories (a same-named folder must not shadow its barrel file).

## The biggest files left (and why they stay whole)

- `components/product-manager/product-form.tsx` (~540 lines) — the
  whole admin product form: fields, photo list + upload, specs,
  variants. One form, one job; splitting it would scatter one form
  across files for no gain.
- `components/product-gallery/product-detail.tsx` (~500 lines) — the
  whole product detail section: selectors, price, tabs, reviews.
  One section, one job.
- `lib/orders/actions/shared.ts` (~380 lines) — the single engine
  behind every order status change (conditional update, refund,
  stock restore, audit). It is one engine on purpose: every status
  change must go through the same checks.
- `app/account/page.tsx` (~440 lines) — thin composition over the
  `components/account/` sections; it holds the page state and wiring.

## How to check your change

```bash
npm test          # unit tests (281)
npx tsc --noEmit  # types
npm run lint      # lint
npm run build     # production build — must pass; it catches things
                  # tsc cannot, e.g. "use server" re-export rules
```

For a browser check, run the mock Supabase and the app against it
(see README, "End-to-end checks"), then run a script in `tests/e2e/`.
