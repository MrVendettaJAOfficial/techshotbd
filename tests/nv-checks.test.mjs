// Needs-validation source pins — TechShot audit run-1, Group D (NV 1-9, 12).
//
// These tests pin, in source, the exact claims behind each verdict in
// the Group D report. They are source assertions, not live proofs:
// the RLS / race items (NV 1, 4-9) can only be settled against a real
// Postgres / the live Supabase project, and each of those is reported
// as NEEDS A LIVE CHECK with the exact check to run. What IS pinned
// here is that the code the verdicts rest on still says what the
// report says it says — so a later edit that silently changes one of
// these premises fails loudly instead of silently invalidating the
// verdict.
//
// NV 13 (HSTS) has its own behavioural test: tests/hsts-headers.test.mjs.
// NV 3's upload guard is additionally pinned by the pre-existing test
// "#9 cart is owner-tagged and filtered on render, never deleted on
// sign-out" in tests/auth-account-security.test.mjs.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function policyBlock(policies, name) {
  const start = policies.indexOf(`create policy "${name}"`);
  assert.ok(start > -1, `policy ${name} exists in policies.sql`);
  const end = policies.indexOf(";", start);
  return policies.slice(start, end);
}

// ---------------------------------------------------------------------------
// NV 1 — two defaults: clear-then-set with no DB uniqueness enforcement.
// ---------------------------------------------------------------------------

test("NV 1: saveAccountAddress still clears then sets the default in two separate statements", () => {
  const account = read("lib/account-server.ts");
  // Clear step: separate UPDATE setting is_default=false on the caller's rows.
  assert.match(
    account,
    /\.from\("addresses"\)\s*\.update\(\{ is_default: false \}\)\s*\.eq\("user_id", userId\)/s,
    "saveAccountAddress clears the default flag in a separate statement",
  );
  // No transaction wraps the two statements (no PostgREST rpc / tx helper).
  assert.equal(
    /\.from\("addresses"\)[\s\S]{0,400}rpc\(/.test(account),
    false,
    "no rpc/transaction call wraps the address default switch",
  );
});

test("NV 1: no partial unique index enforces a single default address", () => {
  const migration1 = read("supabase/migrations/0001_initial_schema.sql");
  assert.match(
    migration1,
    /is_default boolean not null default false/,
    "addresses.is_default is a plain boolean",
  );
  assert.match(
    migration1,
    /create index addresses_user_id_idx on public\.addresses \(user_id\);/,
    "the only addresses index is the plain user_id index",
  );
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) =>
    f.endsWith(".sql"),
  );
  for (const file of migrations) {
    const sql = read(`supabase/migrations/${file}`);
    assert.equal(
      /create unique index[^;]*addresses[^;]*where is_default/i.test(sql),
      false,
      `${file}: no partial unique index on addresses(is_default)`,
    );
    assert.equal(
      /create unique index[^;]*\(user_id\)[^;]*where is_default/i.test(sql),
      false,
      `${file}: no partial unique index on (user_id) where is_default`,
    );
  }
});

// ---------------------------------------------------------------------------
// NV 2 — legacy implicit-flow fragment tokens adopted by the callback.
// ---------------------------------------------------------------------------

test("NV 2: the callback still adopts fragment tokens explicitly via setSession", () => {
  const callback = read("app/auth/callback/page.tsx");
  assert.match(
    callback,
    /parseRecoveryHash\(window\.location\.hash\)/,
    "callback parses the URL fragment for a legacy token",
  );
  assert.match(
    callback,
    /createClient\(\)\.auth\.setSession\(\{\s*access_token: params\.get\("access_token"\)/,
    "callback establishes the session explicitly from the fragment tokens",
  );
  // The browser client never disables URL session detection itself.
  const client = read("lib/supabase/client.ts");
  assert.equal(
    client.includes("detectSessionInUrl"),
    false,
    "lib/supabase/client.ts sets no detectSessionInUrl override",
  );
});

// ---------------------------------------------------------------------------
// NV 3 — stale cart uploaded into the next account (fixed by owner tagging).
// ---------------------------------------------------------------------------

test("NV 3: only the guest cart is ever uploaded into a newly signed-in account", () => {
  const cart = read("lib/cart-store.ts");
  // Render filter: another account's stored lines render as empty.
  assert.match(
    cart,
    /if \(\(stored\.userId \?\? null\) !== currentUserId\) return \[\];/,
    "resolveVisibleCart hides lines whose owner is not the viewer",
  );
  // Upload guard: a stored cart tagged with a user id uploads nothing.
  assert.match(
    cart,
    /const local = cartRef\.current\.userId === null \? cartRef\.current\.items : \[\];/,
    "sign-in upload takes the local lines only when the stored cart is the guest cart",
  );
  // Diff sync guard: nothing syncs until the cart belongs to this account.
  assert.match(
    cart,
    /if \(cart\.userId !== serverUserId\) return;/,
    "server sync is gated on the cart owner matching the signed-in user",
  );
  // Sign-out never deletes the cart (guest cart survives; tagging does the work).
  assert.equal(
    /removeItem\(STORAGE_KEY\)/.test(cart),
    false,
    "cart-store never removes the stored cart on sign-out",
  );
  // Mutations start from the visible cart, never another account's lines.
  assert.match(
    cart,
    /const base = prev\.userId === serverUserId \? prev\.items : \[\];/,
    "add starts from the viewer's own lines only",
  );
});

// ---------------------------------------------------------------------------
// NV 4 — two owners can demote/remove each other, leaving no owner.
// ---------------------------------------------------------------------------

test("NV 4: changeUserRole/removeUser guard only against self-action, with no last-admin count", () => {
  const adminUsers = read("lib/auth-server/admin-users.ts");
  assert.match(
    adminUsers,
    /if \(caller\.id === userId\) \{\s*return \{ ok: false, error: "You cannot change your own role\." \};\s*\}/,
    "changeUserRole rejects only self-demotion",
  );
  assert.match(
    adminUsers,
    /if \(caller\.id === userId\) \{\s*return \{ ok: false, error: "You cannot remove your own account\." \};\s*\}/,
    "removeUser rejects only self-removal",
  );
  // No count of remaining admins is ever read in this file.
  assert.equal(/\bcount\b/.test(adminUsers), false, "no admin count is read");
  // The role update itself is unconditional after the self-check.
  assert.match(
    adminUsers,
    /\.from\("profiles"\)\s*\.update\(\{ role \}\)\s*\.eq\("id", userId\)/s,
    "changeUserRole updates the role unconditionally",
  );
});

// ---------------------------------------------------------------------------
// NV 5 — direct PostgREST review insert/update bypasses the delivered-order rule.
// ---------------------------------------------------------------------------

test("NV 5: review insert/update policies check only user_id = auth.uid()", () => {
  const policies = read("supabase/policies.sql");
  const insert = policyBlock(policies, "reviews_insert_own");
  assert.match(insert, /with check \(user_id = auth\.uid\(\)\)/, "insert checks only the author");
  assert.equal(insert.includes("delivered"), false, "insert has no delivered-order predicate");
  assert.equal(insert.includes("orders"), false, "insert has no order linkage");
  const update = policyBlock(policies, "reviews_update_own");
  assert.match(update, /using \(user_id = auth\.uid\(\)\)/, "update checks only the author");
  assert.equal(update.includes("delivered"), false, "update has no delivered-order predicate");
  // RLS is on, so these policies — not any other layer — guard direct writes.
  assert.match(
    read("supabase/migrations/0001_initial_schema.sql"),
    /alter table public\.reviews enable row level security;/,
    "RLS is enabled on public.reviews",
  );
  // The app-side rule lives only in lib/reviews.ts, not in the policies.
  assert.match(
    read("lib/reviews.ts"),
    /\.eq\("status", "delivered"\)/,
    "submitReview requires a delivered order in app code",
  );
});

// ---------------------------------------------------------------------------
// NV 6 — direct PostgREST insert of a delivered order with arbitrary totals.
// ---------------------------------------------------------------------------

test("NV 6: order insert policies impose no status, totals or payment constraint", () => {
  const policies = read("supabase/policies.sql");
  const insert = policyBlock(policies, "orders_insert_own");
  assert.match(insert, /with check \(user_id = auth\.uid\(\)\)/, "order insert checks only the owner");
  assert.equal(insert.includes("status"), false, "order insert has no status constraint");
  assert.equal(insert.includes("total"), false, "order insert has no totals constraint");
  const items = policyBlock(policies, "order_items_insert_buyer");
  assert.match(items, /orders\.user_id = auth\.uid\(\)/, "order_items insert checks only order ownership");
  assert.equal(items.includes("price"), false, "order_items insert has no price constraint");
  // The app never uses these policies: real orders go through the service-role client.
  assert.match(
    read("lib/orders/server/create.ts"),
    /createAdminClient\(\)/,
    "legitimate order creation uses the service-role admin client",
  );
});

// ---------------------------------------------------------------------------
// NV 7 — residual multi-seller product policies let any customer insert products.
// ---------------------------------------------------------------------------

test("NV 7: residual seller-keyed product policies are still in policies.sql", () => {
  const policies = read("supabase/policies.sql");
  for (const name of [
    "products_insert_own",
    "products_update_own",
    "products_delete_own",
    "product_images_seller_all",
    "product_variants_seller_all",
    "order_items_select_seller",
  ]) {
    assert.ok(
      policies.includes(`create policy "${name}"`),
      `${name} still exists in policies.sql`,
    );
  }
  const insert = policyBlock(policies, "products_insert_own");
  assert.match(insert, /with check \(seller_id = auth\.uid\(\)\)/, "product insert checks only seller_id");
  assert.equal(insert.includes("is_staff"), false, "product insert has no staff-role check");
  // The 0004 precedent: orders_select_seller was dropped, not the product ones.
  assert.match(
    read("supabase/migrations/0004_drop_seller_order_policy.sql"),
    /drop policy if exists "orders_select_seller" on public\.orders;/,
    "migration 0004 dropped orders_select_seller",
  );
  assert.equal(
    policies.includes('create policy "orders_select_seller"'),
    false,
    "orders_select_seller was not re-added to policies.sql",
  );
  // The app rule contradicts the policies: products are always store-owned.
  // (The sentence wraps across two comment lines: "seller_id is
  // always null on / create, and updates never change it.")
  assert.match(
    read("lib/products/actions/shared.ts"),
    /seller_id is always null on/,
    "app rule: every product is store-owned",
  );
  assert.match(
    read("lib/products/actions/shared.ts"),
    /updates never change it/,
    "app rule: updates never change seller_id",
  );
});

// ---------------------------------------------------------------------------
// NV 8 — any signed-in user can self-verify a seller profile.
// ---------------------------------------------------------------------------

test("NV 8: seller_profiles policies let any user insert/update with is_verified freely settable", () => {
  const policies = read("supabase/policies.sql");
  const insert = policyBlock(policies, "seller_profiles_insert_own");
  assert.match(insert, /with check \(user_id = auth\.uid\(\)\)/, "insert checks only the owner");
  assert.equal(insert.includes("is_verified"), false, "insert does not constrain is_verified");
  const update = policyBlock(policies, "seller_profiles_update_own");
  assert.equal(update.includes("is_verified"), false, "update does not constrain is_verified");
  const select = policyBlock(policies, "seller_profiles_select_verified");
  assert.match(select, /using \(is_verified = true\)/, "public select exposes is_verified rows");
  assert.match(
    read("supabase/migrations/0001_initial_schema.sql"),
    /alter table public\.seller_profiles enable row level security;/,
    "RLS is enabled on public.seller_profiles",
  );
});

// ---------------------------------------------------------------------------
// NV 9 — no Storage policy for the product-images bucket exists in the repo.
// ---------------------------------------------------------------------------

test("NV 9: no Storage policy exists anywhere in supabase/policies.sql", () => {
  const policies = read("supabase/policies.sql");
  assert.equal(policies.toLowerCase().includes("storage"), false, "no storage mention in policies.sql");
  assert.equal(policies.includes("storage.objects"), false, "no storage.objects policy");
  // The bucket itself was created in the dashboard, not by any migration.
  assert.match(
    read("supabase/seed.sql"),
    /create the bucket in the dashboard/,
    "seed.sql says the product-images bucket was created in the dashboard",
  );
});

// ---------------------------------------------------------------------------
// NV 12 — no in-repo rate limiting on pre-auth flows.
// ---------------------------------------------------------------------------

test("NV 12: no in-repo rate limiting on sign-up, sign-in, password reset or the payment callback", () => {
  const auth = read("lib/auth.ts");
  assert.equal(/rate.?limit|throttl|captcha/i.test(auth), false, "lib/auth.ts has no rate-limit code");
  assert.match(auth, /supabase\.auth\.signUp\(/, "signUp calls Supabase Auth directly");
  assert.match(auth, /supabase\.auth\.signInWithPassword\(/, "signIn calls Supabase Auth directly");
  assert.match(auth, /resetPasswordForEmail\(/, "requestPasswordReset calls Supabase Auth directly");
  const callback = read("app/api/payments/callback/route.ts");
  assert.equal(
    /rate.?limit|throttl/i.test(callback),
    false,
    "the public payment callback has no in-repo rate limit",
  );
  const middleware = read("middleware.ts");
  assert.match(
    middleware,
    /matcher:\s*\["\/admin\/:path\*"\]/,
    "middleware only guards /admin — no rate limiting on auth or callback routes",
  );
  assert.equal(existsSync(path.join(ROOT, "vercel.json")), false, "no vercel.json (no edge rate-limit config)");
  assert.equal(
    existsSync(path.join(ROOT, "supabase/config.toml")),
    false,
    "no supabase/config.toml (no local Auth config)",
  );
});
