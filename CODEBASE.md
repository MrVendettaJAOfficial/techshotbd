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
| `/` | `app/page.tsx` | Home: hero banner carousel, flash sale, product grid. STATIC — pre-rendered at build, no function run and no database read per visit; revalidated on demand by product / banner writes (see "Storefront speed" below) |
| `/shop` | `app/shop/page.tsx` | Product listing with filters. Still `force-dynamic` (filters via searchParams) but reads the catalogue from the shared data cache, not the database |
| `/product/[slug]` | `app/product/[slug]/page.tsx` | One product: gallery, variants, reviews. Still `force-dynamic`: the catalogue comes from the shared data cache, but the reviews list and the signed-in user's review eligibility are live per visit and never cached |
| `/cart` | `app/cart/page.tsx` | Cart page (thin composition; pieces in `components/cart/`) |
| `/checkout` | `app/checkout/page.tsx` + `CheckoutForm.tsx` | Checkout steps (form lives in `components/checkout/`) |
| `/checkout/confirmation` | `app/checkout/confirmation/page.tsx` | Order placed screen |
| `/checkout/test-pay` | `app/checkout/test-pay/page.tsx` | Test payment buttons (test mode only) |
| `/orders` | `app/orders/page.tsx` | Customer's orders, tabbed by status |
| `/orders/[id]` | `app/orders/[id]/page.tsx` | One order: tracker, items, cancel (pieces in `components/order-detail/`) |
| `/account` | `app/account/page.tsx` | Profile, addresses, orders, wishlist (pieces in `components/account/`) |
| `/admin` | `app/admin/page.tsx` + `AdminDashboard.tsx` | Admin tabs: Overview, Products, Banners, Orders, Messages, Users (pieces in `components/admin*/`) |
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
| `components/admin/` | Admin dashboard shell (`dashboard-shell.tsx`), banners (`banners-section.tsx`), messages/broadcasts (`messages-section.tsx`) and coupons (`coupons-section.tsx`) |
| `components/HeroCarousel.tsx` | Home hero banner carousel, IMAGE-ONLY since 2026-11-10: one full-bleed banner photo per slide (380px desktop / ~200px mobile), all slides stacked and crossfaded, auto-loop on every device (4.5s, paused on hover/focus/hidden tab/reduced-motion), any manual pick resets the timer, dots overlaid on a dark pill, arrows on hover (desktop only), swipe + keyboard. Headline survives only as alt text. |
| `components/admin-orders/` | Admin orders tab: `orders-list.tsx`, `status-controls.tsx` (status selector, Advance, Cancel, Refund) |
| `components/Header.tsx`, `Footer.tsx` | Site header (cart button + mini-cart) and footer |
| `components/Logo.tsx` | Brand wordmark: owner's real TS mark file (`public/images/techshot-logo.svg`) + "TechShot" in extra-bold Montserrat + green "BD", tagline; header hides the tagline on mobile, footer always shows it |
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
| `lib/banners.ts`, `lib/banners/process-banner-image.ts`, `lib/banners-server.ts` | Hero banners: pure rules (kind "promotion" / "offer", sort order) + the 1600 x 640 wide size (`BANNER_IMAGE_WIDTH_PX` / `BANNER_IMAGE_HEIGHT_PX`, one source of truth), sharp cover-crop to 1600 x 640 before Storage (never upscales), server actions for list/add/edit/toggle/delete/upload — staff only, any staff role (same rule as products). Stored headline is derived from the kind (alt text only); headline/subcopy/button columns are unused for visible rendering since the image-only redesign but kept in the DB. |
| `lib/hero-slides.ts` | Hero slides: banner → slide (`{ image, alt }`), top products → fallback slides (the home page never shows an empty hero) |
| `lib/products/process-image.ts` | Upload crop: sharp-crops an uploaded photo to the universal 1200x1200 square before Storage (photos smaller than 1200 in both dimensions are kept as-is, never upscaled) |
| `lib/products/validation/upload.ts` | `PRODUCT_IMAGE_SIZE_PX` (1200, the one universal size) + `PRODUCT_IMAGE_SIZE_NOTE` (the admin warning text, built from the constant) |
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
| `lib/pricing.ts`, `lib/theme.ts` | BDT prices / delivery rules, colours. Solid buttons are green (`brandDark #0B7A55`, hover `brandDarker #096B49`) — never white text on the full green `#0F9A70` (3.57:1, fails AA); see `tests/recolour.test.mjs` |
| `lib/storefront-cache.ts` | THE cache contract: the two tag names (`"catalog"`, `"banners"`) and the `revalidateCatalogCache()` / `revalidateBannersCache()` wrappers. Both tag names live here and nowhere else, so a reader and a writer can never disagree on the spelling |
| `lib/supabase/` | Supabase clients (`client.ts`, `server.ts` — incl. `createPublicClient()`, the cookie-less anon client the data cache reads through, since the cache forbids dynamic APIs), catalogue fetch (`catalog.ts` — `getCatalog()` reads through `unstable_cache` under the `"catalog"` tag, `getLiveCatalog(supabase)` takes the client; the local fallback is NEVER cached and a failed fetch throws so it is never cached), database types (`types.ts`) |
| `lib/demo-store.ts` | Local demo data used when Supabase is not configured |
| `middleware.ts` | Route guard: `/admin` needs a signed-in staff role. Matcher is `/admin/:path*` only — public shop pages never pay for a per-request `getUser()` |

## Storefront speed — the shared data cache (2026-11-11)

The shop was slow because every visit re-ran the server and re-fetched
the whole catalogue live from Supabase (Singapore) from a Vercel
function (US by default on Hobby): home 5 REST calls, shop 4,
a product page 8 — on every visit, for 12 products. The fix is one
shared cache, not per-page tricks:

- **Readers:** `getCatalog()` (`lib/supabase/catalog.ts`) and the
  active banners (`listActiveBanners()` in `lib/banners-server.ts`)
  read through Next.js `unstable_cache` under the tags `"catalog"` /
  `"banners"` (the tag names live only in `lib/storefront-cache.ts`).
  Home, shop, product pages, flash deals and related products all
  read through the same cached copy. Repeat visits issue zero
  catalogue queries; the first visit after a write fetches it once
  (4 calls). A `Date` inside the cached value comes back as a string
  (`unstable_cache` serializes to JSON) — `getCatalog()` revives
  `flashEndsAt` to a `Date` on read.
- **Writers (the purge):** every write that changes
  catalogue-visible data calls `revalidateTag` for the tag, on top
  of the `revalidatePath` calls that were already there: product
  create / update / pause / delete (`lib/products/actions/shared.ts`
  `revalidateProductPages`), banner create / update / hide / show /
  delete (`lib/banners-server.ts`), order placement (stock down) and
  order cancel / refund / returned (stock restored). So an admin edit
  shows on the storefront immediately, including on the static home page.
  Review submission is the DELIBERATE exception: it must NOT purge —
  a server action that revalidates makes the client refresh the
  current route, and that refresh remounts the review form, wiping
  the thank-you notice and the just-written review and resetting
  the gallery tab to Description (see `lib/reviews.ts` and the
  form's header comment). The rating aggregate refreshes on the
  next product / order / banner write instead; the reviews list
  itself is live per visit, and the form shows the new review from
  local state immediately. Pinned by
  `tests/storefront-cache.test.mjs`.
- **Home is static** (`app/page.tsx` has no `force-dynamic` any
  more): it is pre-rendered at build and revalidated on demand by
  the writes above. Shop and product pages stay `force-dynamic`;
  only their catalogue read is cached.
- **Never cached (always live):** cart, checkout, account, orders,
  inbox, admin lists (`fetchAllProducts`), the reviews list, and
  review-write eligibility (`getCurrentUser`). Per-user data never
  goes through the cache.
- **Client router cache:** `next.config.mjs` sets
  `experimental.staleTimes.static: 30` — without it, a shopper
  already browsing would keep seeing the previous static home page
  for up to 5 minutes (Next 14's default) after an admin edit on
  client-side navigation. 30s keeps the window short while
  prefetch still helps; full loads are always fresh.
- **Limits to know:** there is no time-based expiry — data is fresh
  until a write purges it. A write that bypasses the app's server
  actions (a direct SQL edit in the Supabase dashboard) does NOT
  purge the tag, so the storefront keeps showing the old data until
  the next app write or server restart. `unstable_cache` is unstable
  API in Next 14.2.5, but it is the documented mechanism for this.

## Database — `supabase/`

| File | Job |
|---|---|
| `supabase/migrations/0001_initial_schema.sql` … `0013_*.sql` | Database changes, in order. Never edit an applied migration — add a new one. 0011 adds the `banners` table (hero slides) and 0012 adds the `product_categories` join table + the "Flash deals" category — both applied live 2026-11-10. 0013 adds the `kind` column to `banners` ("promotion" / "offer") — applied live 2026-11-11. 0010 widened products UPDATE to all staff (managers CAN edit products, 2026-11-10) and is applied live. |
| `supabase/policies.sql` | Row Level Security: who may read/write each table |
| `supabase/seed.sql` | Starting catalogue (12 products), categories, FIRST2000 coupon |

## Tests — `tests/`

- `tests/*.test.mjs` — unit tests, run with `npm test` (429 tests).
  Some tests read source files as text to pin a mechanism in place;
  when code moves, update the *read path* in the test, never weaken
  the assertion. `tests/storefront-cache.test.mjs` pins the data-cache
  contract (tags, purge call sites, static home, no per-user caching).
- `tests/e2e/` — Playwright browser tests against the mock Supabase
  (`mock-supabase.mjs`, port 3101): `smoke.mjs` (buy a product end to
  end), `roles-admin-tabs.mjs`, `mini-cart-variant-photos.mjs`,
  `gallery.mjs`, `review-fixes.mjs`, `storage-images.mjs`,
  `responsive-gallery.mjs`, `orders-fresh-browser.mjs`,
  `green-hero-flash.mjs` (green buttons, hero carousel, banner admin,
  flash deals, multi-category — at 1440 / 1280 / 390),
  `recolour-mobile.mjs`, `light-theme-auth-inbox.mjs`,
  `manager-edit-products.mjs`, `logo-header.mjs`, `image-size.mjs`,
  `hydration.mjs`, `admin-tabs-performance.mjs` (instant tab
  highlight + round-trip counts per admin tab),
  `storefront-cache.mjs` (repeat visits issue zero catalogue
  queries, admin edits show immediately, paused products hidden,
  banner add/delete, reviews stay live, no overflow at 1440 / 1280
  / 390 — run with a cold data cache: `rm -rf .next/cache/fetch-cache`
  before starting the app).
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
npm test          # unit tests (429)
npx tsc --noEmit  # types
npm run lint      # lint
npm run build     # production build — must pass; it catches things
                  # tsc cannot, e.g. "use server" re-export rules
```

For a browser check, run the mock Supabase and the app against it
(see README, "End-to-end checks"), then run a script in `tests/e2e/`.
