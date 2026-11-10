// Profile dropdown + inbox tests — TechShot.
//
// The dropdown is a React component (components/ProfileMenu.tsx)
// and the inbox is a page (app/inbox/page.tsx), so `node --test`
// cannot mount them. What IS proven here, following the repo's
// source-level test pattern (see tests/mini-cart.test.mjs):
//   - the dropdown lists exactly the five signed-in entries with
//     their destinations and lucide icons, plus Sign out, and the
//     two signed-out entries, with the required accessible
//     structure (role="menu", aria-haspopup/expanded, Escape to
//     close, overlay click to close, focus into the menu on open
//     and back to the trigger on close);
//   - the header renders the dropdown instead of the old plain
//     profile Link, the wishlist heart is untouched, and the
//     header gets auth state because app/layout.tsx wraps it in
//     AuthProvider;
//   - the inbox derives its entries ONLY from the customer's own
//     orders (lib/inbox.ts buildInboxEntries, imported directly —
//     the real rules, not a copy): one "placed" entry per order,
//     one "status" entry only when updated_at is later than
//     created_at, newest first, nothing invented; and the page
//     reads those orders through listSupabaseOrders (owner RLS),
//     never audit_log, with the account page's sign-in prompt for
//     signed-out visitors and a real empty state.
//
// What is NOT proven here: the click-through itself (menu opening
// on profile-icon click, sign-out landing on /, an inbox entry
// landing on its order page, the 390px layout). That is for the
// Playwright run in the later verification phase.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildInboxEntries,
  inboxStatusLabel,
  mergeInboxItems,
  parseOrderStatusAudit,
} from "../lib/inbox.ts";
import {
  announcementKindLabel,
  validateAnnouncementInput,
} from "../lib/announcements.ts";
import { canSendBroadcasts } from "../lib/roles.ts";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function makeOrder(overrides = {}) {
  return {
    id: "order-1",
    orderNumber: "TS-1001",
    items: [
      {
        productId: "phone",
        title: "Test Phone",
        price_poisha: 5000000,
        mrp_poisha: 5500000,
        quantity: 1,
      },
      {
        productId: "case",
        title: "Test Case",
        price_poisha: 50000,
        mrp_poisha: 50000,
        quantity: 2,
      },
    ],
    address: {
      id: "addr_1",
      firstName: "Test",
      lastName: "User",
      email: "",
      mobile: "",
      address: "",
      area: "",
      division: "",
      district: "",
      city: "",
      isDefault: false,
    },
    delivery: "standard",
    paymentMethod: "cod",
    subtotal_poisha: 5100000,
    savings_poisha: 0,
    couponCode: null,
    couponDiscount_poisha: 0,
    deliveryFee_poisha: 0,
    total_poisha: 5100000,
    status: "confirmed",
    paymentStatus: "unpaid",
    testMode: false,
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Inbox derivation (lib/inbox.ts — the real rules, imported directly)
// ---------------------------------------------------------------------------

test("inbox: no orders means no entries — nothing invented", () => {
  assert.deepEqual(buildInboxEntries([]), []);
});

test("inbox: an unchanged order yields exactly one placed entry", () => {
  const entries = buildInboxEntries([makeOrder()]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "placed");
  assert.equal(entries[0].id, "order-1:placed");
  assert.equal(entries[0].orderId, "order-1");
  assert.equal(entries[0].orderNumber, "TS-1001");
  assert.equal(entries[0].title, "Order TS-1001 placed");
  assert.equal(entries[0].at, "2026-11-09T10:00:00.000Z");
  assert.equal(entries[0].total_poisha, 5100000);
  assert.equal(entries[0].itemCount, 2);
  // No welcome / promo / sample entry is ever produced.
  assert.equal(entries.some((e) => /welcome|offer|discount|promo/i.test(e.title)), false);
});

test("inbox: a later updated_at yields a second status entry, newest first", () => {
  const entries = buildInboxEntries([
    makeOrder({ status: "shipped", updatedAt: "2026-11-10T09:30:00.000Z" }),
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "status");
  assert.equal(entries[0].id, "order-1:status");
  assert.equal(entries[0].title, "Order TS-1001 — Shipped");
  assert.equal(entries[0].at, "2026-11-10T09:30:00.000Z");
  assert.equal(entries[1].kind, "placed");
  // The status entry reports only the current status as of the
  // change — it does not claim an earlier transition.
  assert.match(entries[0].detail, /now shipped/i);
});

test("inbox: updated_at equal to created_at is not a status change", () => {
  // Same instant (or an earlier updated_at, e.g. clock skew) must
  // not invent a second entry.
  assert.equal(buildInboxEntries([makeOrder()]).length, 1);
  assert.equal(
    buildInboxEntries([
      makeOrder({ updatedAt: "2026-11-09T09:59:00.000Z" }),
    ]).length,
    1,
  );
});

test("inbox: entries across orders sort newest first", () => {
  const entries = buildInboxEntries([
    makeOrder({ id: "order-old", orderNumber: "TS-1000", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z" }),
    makeOrder({
      id: "order-new",
      orderNumber: "TS-1002",
      status: "delivered",
      createdAt: "2026-11-08T10:00:00.000Z",
      updatedAt: "2026-11-09T12:00:00.000Z",
    }),
  ]);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["order-new:status", "order-new:placed", "order-old:placed"],
  );
});

test("inbox: status labels cover every order status", () => {
  for (const [status, label] of [
    ["pending_payment", "Pending payment"],
    ["confirmed", "Confirmed"],
    ["processing", "Processing"],
    ["shipped", "Shipped"],
    ["delivered", "Delivered"],
    ["cancelled", "Cancelled"],
    ["refunded", "Refunded"],
    ["returned", "Returned"],
  ]) {
    assert.equal(inboxStatusLabel(status), label);
  }
  // Unknown statuses fall through to the raw value, never blank.
  assert.equal(inboxStatusLabel("mystery"), "mystery");
});

test("inbox: the derivation never queries a table itself", () => {
  const inbox = read("lib/inbox.ts");
  // Pure derivation only: no Supabase query, no fetch, no storage.
  // The audit_log read lives in lib/inbox-server.ts (server action,
  // scoped to the caller's own order ids); this file only parses
  // the rows it is handed, and says so in its header.
  assert.equal(/\.from\("audit_log"\)/.test(inbox), false);
  assert.equal(/\.from\("orders"\)/.test(inbox), false);
  assert.equal(/fetch\(/.test(inbox), false);
  assert.equal(/localStorage/.test(inbox), false);
  assert.match(inbox, /admin-only/);
  assert.match(inbox, /under RLS/);
  assert.match(inbox, /no read\/unread storage/);
});

// ---------------------------------------------------------------------------
// Profile dropdown (components/ProfileMenu.tsx)
// ---------------------------------------------------------------------------

test("dropdown: the five signed-in entries with destinations and icons", () => {
  const menu = read("components/ProfileMenu.tsx");
  for (const [href, label, icon] of [
    ["/account", "Profile", "User"],
    ["/orders", "Orders", "Package"],
    ["/inbox", "Inbox", "Inbox"],
    ["/account#wishlist", "Wishlist", "Heart"],
    ["/account#security", "Settings", "Settings"],
  ]) {
    assert.ok(menu.includes(`href: "${href}"`), `missing href ${href}`);
    assert.ok(menu.includes(`label: "${label}"`), `missing label ${label}`);
    assert.ok(menu.includes(`Icon: ${icon}`), `missing icon ${icon}`);
  }
  // Each entry renders its own lucide icon — no emoji anywhere
  // (em dashes / ellipsis in comments and copy are typography,
  // not emoji, so they are stripped before the check).
  assert.match(menu, /<entry\.Icon size=\{18\}/);
  assert.equal(/[^\x00-\x7F]/.test(menu.replace(/[—…]/g, "")), false);
});

test("dropdown: signed-in shows the five entries plus Sign out; signed-out shows Sign in + Create account", () => {
  const menu = read("components/ProfileMenu.tsx");
  assert.match(menu, /useAuth\(\)/);
  assert.match(menu, /signOutUser\(\)/);
  assert.match(menu, /Sign out/);
  assert.match(menu, /LogOut/);
  assert.match(menu, /href="\/auth\/sign-in"/);
  assert.match(menu, /Sign in/);
  assert.match(menu, /LogIn/);
  assert.match(menu, /href="\/auth\/sign-up"/);
  assert.match(menu, /Create account/);
  assert.match(menu, /UserPlus/);
  // Sign out uses the existing auth sign-out, then leaves the page.
  assert.match(menu, /signOutUser\(\);\s*\n\s*setOpen\(false\);/);
  assert.match(menu, /router\.push\("\/"\)/);
  // While auth is loading the menu does not flash signed-out
  // entries at a signed-in user.
  assert.match(menu, /Loading your account…/);
  // The signed-in header shows who is signed in.
  assert.match(menu, /user\.displayName/);
  assert.match(menu, /user\.email/);
});

test("dropdown: accessible menu — roles, aria, Escape, outside tap, focus", () => {
  const menu = read("components/ProfileMenu.tsx");
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded={open}/);
  assert.match(menu, /aria-controls="profile-menu"/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /data-testid="profile-menu-button"/);
  // Escape closes.
  assert.match(menu, /e\.key === "Escape"/);
  assert.match(menu, /addEventListener\("keydown"/);
  // Clicking outside the panel closes (transparent overlay).
  assert.match(menu, /data-testid="profile-menu-overlay"/);
  assert.match(menu, /fixed inset-0 z-40/);
  // Focus moves into the menu on open and back to the trigger on close.
  assert.match(menu, /itemRefs\.current\[0\]\?\.focus\(\)/);
  assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
  // Link taps close the menu.
  assert.match(menu, /onClick={\(\) => setOpen\(false\)}/);
  // Arrow-key navigation between items.
  assert.match(menu, /ArrowDown/);
  assert.match(menu, /ArrowUp/);
  // Mobile: the panel stays inside a 390px viewport.
  assert.match(menu, /absolute right-0 z-50/);
  assert.match(menu, /max-w-\[calc\(100vw-2rem\)\]/);
  // It is a dropdown panel, not a navigation: no router.push to a
  // menu destination, no dialog role.
  assert.equal(/role="dialog"/.test(menu), false);
  assert.equal(/router\.push\("\/account"\)/.test(menu), false);
});

// ---------------------------------------------------------------------------
// Header wiring + AuthProvider in the layout
// ---------------------------------------------------------------------------

test("header renders the dropdown instead of the plain profile link", () => {
  const header = read("components/Header.tsx");
  assert.match(header, /import ProfileMenu from "\.\/ProfileMenu"/);
  assert.match(header, /<ProfileMenu \/>/);
  // The old plain profile Link is gone — the only remaining
  // href="/account" in the header is the wishlist heart.
  assert.equal((header.match(/href="\/account"/g) ?? []).length, 1);
  assert.match(header, /aria-label="Wishlist"/);
  // The wishlist heart and everything else are untouched.
  assert.match(header, /<Heart size=\{20\} \/>/);
  assert.match(header, /<MiniCartDrawer/);
  assert.match(header, /<MobileNavDrawer/);
});

test("layout wraps the header in AuthProvider so the menu gets auth state", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /import { AuthProvider } from "\.\.\/lib\/auth"/);
  assert.match(layout, /<AuthProvider>/);
  assert.match(layout, /<Header \/>/);
  assert.ok(
    layout.indexOf("<AuthProvider>") < layout.indexOf("<Header />"),
    "AuthProvider must open before the header",
  );
  assert.ok(
    layout.indexOf("<Header />") < layout.indexOf("</AuthProvider>"),
    "the header must sit inside AuthProvider",
  );
  // CartProvider stays outermost (cart-store reads the session
  // independently of AuthProvider).
  assert.ok(
    layout.indexOf("<CartProvider>") < layout.indexOf("<AuthProvider>"),
    "CartProvider stays outermost",
  );
});

// ---------------------------------------------------------------------------
// Inbox page (app/inbox/page.tsx)
// ---------------------------------------------------------------------------

test("inbox page: real order data only, linked to each order, honest empty state", () => {
  const page = read("app/inbox/page.tsx");
  // Reads the customer's own orders the same way /orders does:
  // live Supabase orders (owner RLS) merged over the browser list.
  assert.match(page, /listSupabaseOrders\(\)/);
  assert.match(page, /mergeOrders\(browserOrders, liveOrders\)/);
  assert.match(page, /buildInboxEntries\(/);
  // Plus the two new sources: broadcasts and the own-orders audit
  // history, merged newest-first.
  assert.match(page, /listAnnouncementsForInbox\(\)/);
  assert.match(page, /listOwnOrderStatusHistory\(\)/);
  assert.match(page, /mergeInboxItems\(/);
  // The page never queries audit_log itself: the status history
  // comes from the server action listOwnOrderStatusHistory
  // (lib/inbox-server.ts), which reads audit_log with the
  // service-role client scoped to the caller's own order ids.
  // (audit_log IS mentioned in the page's header comment, which
  // explains why — so this checks for a query, not the word.)
  assert.equal(/\.from\("audit_log"\)/.test(page), false);
  // Never a seeded / sample / fake entry: the header comment says
  // "no fake entries" and nothing in the page renders one.
  assert.match(page, /no fake entries/);
  assert.equal(/seedAnnouncement|sampleAnnouncement|Welcome to TechShot/i.test(page), false);
  // Each order entry links to its order.
  assert.match(page, /href={`\/orders\/\${item\.orderId}`}/);
  // Empty state, and the page says plainly there is no unread count.
  assert.match(page, /No messages yet/);
  assert.match(page, /no unread count/);
});

test("inbox page: signed-out visitors get the account page's sign-in prompt — and nothing else", () => {
  const page = read("app/inbox/page.tsx");
  assert.match(page, /useAuth\(\)/);
  assert.match(page, /You are not signed in/);
  assert.match(page, /href="\/auth\/sign-in"/);
  // Same prompt treatment as /account (same heading + link).
  const account = read("app/account/page.tsx");
  assert.match(account, /You are not signed in/);
  assert.match(account, /href="\/auth\/sign-in"/);
  // Prompt-only: the signed-out branch returns before the list /
  // empty state are reached, and no order data is loaded for a
  // signed-out visitor (the effect bails out when there is no user).
  assert.ok(
    page.indexOf('if (!authLoading && !user)') < page.indexOf("items.length === 0"),
    "the signed-out return must come before the list",
  );
  assert.match(page, /if \(!user\) \{\s*\n\s*setItems\(\[\]\);\s*\n\s*setLoaded\(true\);/);
});

// ---------------------------------------------------------------------------
// Broadcasts: validation + roles (pure rules, imported directly)
// ---------------------------------------------------------------------------

test("broadcasts: compose validation trims and bounds title, body and kind", () => {
  const ok = validateAnnouncementInput({
    title: "  Eid offer  ",
    body: "  10% off all phones.  ",
    kind: "offer",
  });
  assert.deepEqual(ok, {
    ok: true,
    value: { title: "Eid offer", body: "10% off all phones.", kind: "offer" },
  });
  assert.equal(validateAnnouncementInput({ title: "", body: "x", kind: "notification" }).ok, false);
  assert.equal(validateAnnouncementInput({ title: "x", body: "", kind: "notification" }).ok, false);
  assert.equal(
    validateAnnouncementInput({ title: "x".repeat(201), body: "x", kind: "notification" }).ok,
    false,
  );
  assert.equal(
    validateAnnouncementInput({ title: "x", body: "x".repeat(2001), kind: "notification" }).ok,
    false,
  );
  assert.equal(
    validateAnnouncementInput({ title: "x", body: "x", kind: "sms" }).ok,
    false,
  );
  assert.equal(announcementKindLabel("notification"), "Notification");
  assert.equal(announcementKindLabel("offer"), "Offer");
});

test("broadcasts: only the Owner and co-admins may send", () => {
  assert.equal(canSendBroadcasts("admin"), true);
  assert.equal(canSendBroadcasts("co_admin"), true);
  // A manager is staff but may NOT send; customers never.
  assert.equal(canSendBroadcasts("manager"), false);
  assert.equal(canSendBroadcasts("customer"), false);
  assert.equal(canSendBroadcasts(null), false);
  assert.equal(canSendBroadcasts(undefined), false);
});

// ---------------------------------------------------------------------------
// Audit history: parsing + audit-aware order entries (real rules)
// ---------------------------------------------------------------------------

test("audit: only structured order.status rows parse", () => {
  assert.deepEqual(
    parseOrderStatusAudit({
      entity_id: "order-1",
      action: "order.status:confirmed->shipped",
      created_at: "2026-11-10T09:30:00.000Z",
    }),
    {
      orderId: "order-1",
      oldStatus: "confirmed",
      newStatus: "shipped",
      at: "2026-11-10T09:30:00.000Z",
    },
  );
  // The optional " (source)" suffix parses too.
  assert.equal(
    parseOrderStatusAudit({
      entity_id: "order-1",
      action: "order.status:pending_payment->confirmed (callback)",
      created_at: "2026-11-09T11:00:00.000Z",
    })?.newStatus,
    "confirmed",
  );
  // Anything else is ignored, never guessed.
  assert.equal(
    parseOrderStatusAudit({
      entity_id: "order-1",
      action: "order created",
      created_at: "2026-11-09T10:00:00.000Z",
    }),
    null,
  );
  assert.equal(
    parseOrderStatusAudit({
      entity_id: "order-1",
      action: "order.status:confirmed->shipped",
      created_at: "not-a-date",
    }),
    null,
  );
  assert.equal(
    parseOrderStatusAudit({
      entity_id: "",
      action: "order.status:confirmed->shipped",
      created_at: "2026-11-10T09:30:00.000Z",
    }),
    null,
  );
});

test("audit: each recorded step becomes an entry with the real transition", () => {
  const entries = buildInboxEntries(
    [makeOrder({ status: "shipped", updatedAt: "2026-11-10T09:30:00.000Z" })],
    [
      {
        orderId: "order-1",
        oldStatus: "pending_payment",
        newStatus: "confirmed",
        at: "2026-11-09T11:00:00.000Z",
      },
      {
        orderId: "order-1",
        oldStatus: "confirmed",
        newStatus: "shipped",
        at: "2026-11-10T09:30:00.000Z",
      },
    ],
  );
  // Placed + two audit steps. No orders-row fallback entry: the
  // audit trail already records the latest status (shipped), so a
  // second "shipped" entry would be a duplicate.
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.title]),
    [
      ["status", "Order TS-1001 — Shipped"],
      ["status", "Order TS-1001 — Confirmed"],
      ["placed", "Order TS-1001 placed"],
    ],
  );
  assert.match(entries[0].detail, /moved from confirmed to shipped/i);
});

test("audit: when the trail misses the latest change, the orders-row entry covers it", () => {
  // Audit recorded only the confirm step; the ship step was never
  // written (best-effort writes). The inbox still shows Shipped,
  // from updated_at — the order is never left without its latest
  // status.
  const entries = buildInboxEntries(
    [makeOrder({ status: "shipped", updatedAt: "2026-11-10T09:30:00.000Z" })],
    [
      {
        orderId: "order-1",
        oldStatus: "pending_payment",
        newStatus: "confirmed",
        at: "2026-11-09T11:00:00.000Z",
      },
    ],
  );
  assert.equal(entries.length, 3);
  assert.equal(entries[0].title, "Order TS-1001 — Shipped");
  assert.equal(entries[0].id, "order-1:status");
  assert.match(entries[0].detail, /now shipped/i);
  // Audit rows for orders not in the list are ignored.
  assert.equal(
    buildInboxEntries([makeOrder()], [
      {
        orderId: "order-other",
        oldStatus: "confirmed",
        newStatus: "shipped",
        at: "2026-11-10T09:30:00.000Z",
      },
    ]).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// Merged inbox: broadcasts + order entries, newest first
// ---------------------------------------------------------------------------

test("merged inbox: a broadcast appears alongside order updates, newest first", () => {
  const items = mergeInboxItems(
    buildInboxEntries([makeOrder()]),
    [
      {
        id: "ann-1",
        title: "Eid offer",
        body: "10% off all phones.",
        kind: "offer",
        createdBy: "admin-1",
        createdAt: "2026-11-09T12:00:00.000Z",
      },
    ],
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].source, "announcement");
  assert.equal(items[0].id, "announcement:ann-1");
  assert.equal(items[0].title, "Eid offer");
  assert.equal(items[0].detail, "10% off all phones.");
  assert.equal(items[0].kind, "offer");
  assert.equal(items[1].source, "order");
  // No announcements, no orders: nothing invented.
  assert.deepEqual(mergeInboxItems([], []), []);
  // No read/unread bookkeeping on any merged item.
  assert.equal(items.every((item) => !("unread" in item) && !("isRead" in item)), true);
});

// ---------------------------------------------------------------------------
// Broadcasts: migration + RLS (file, NOT applied live)
// ---------------------------------------------------------------------------

test("migration 0009: announcements table with staff-only write, read for all signed-in users", () => {
  const migration = read("supabase/migrations/0009_announcements.sql");
  assert.match(migration, /create table if not exists public\.announcements/);
  assert.match(migration, /title text not null/);
  assert.match(migration, /body text not null/);
  assert.match(migration, /kind text not null default 'notification' check \(kind in \('notification', 'offer'\)\)/);
  assert.match(migration, /created_by uuid references public\.profiles \(id\) on delete set null/);
  assert.match(migration, /created_at timestamptz not null default now\(\)/);
  assert.match(migration, /enable row level security/);
  // Read: every authenticated user. Write/delete: Owner or
  // co-admin only — a manager is NOT in the policy.
  assert.match(migration, /announcements_select_authenticated/);
  assert.match(migration, /for select to authenticated\s*\n\s*using \(true\)/);
  assert.match(migration, /announcements_staff_insert/);
  assert.match(migration, /with check \(public\.is_admin\(\) or public\.is_co_admin\(\)\)/);
  assert.match(migration, /announcements_staff_delete/);
  assert.equal(/is_manager\(\)/.test(migration), false);
  // No per-user targeting, no scheduling, no reads table: the
  // migration creates exactly one table, and no reads table.
  assert.equal(/user_id/.test(migration), false);
  assert.equal(/scheduled_at|send_at/.test(migration), false);
  assert.equal(/announcement_reads/.test(migration), false);
  assert.equal((migration.match(/create table/g) ?? []).length, 1);
  // Flagged as APPLIED live 2026-11-09 (verified: table + 3
  // policies + index) — the NOT APPLIED marker was dropped when
  // it was applied, like the other applied migrations.
  assert.match(migration, /APPLIED LIVE 2026-11-09/);
  assert.equal(/NOT APPLIED LIVE YET/.test(migration), false);
  // Mirrored in policies.sql (fresh-install path), same policies.
  const policies = read("supabase/policies.sql");
  assert.match(policies, /announcements_select_authenticated/);
  assert.match(policies, /announcements_staff_insert/);
  assert.match(policies, /announcements_staff_delete/);
  assert.match(policies, /0009/);
});

// ---------------------------------------------------------------------------
// Broadcasts: server actions enforce staff-only sending
// ---------------------------------------------------------------------------

test("announcements server actions: role check on every write, RLS read for the inbox", () => {
  const server = read("lib/announcements-server.ts");
  assert.match(server, /"use server"/);
  // Both writes gate on canSendBroadcasts + a fresh DB role read.
  assert.match(server, /canSendBroadcasts\(role\)/);
  assert.match(server, /getCallerRole\(\)/);
  assert.match(server, /Only the owner and co-admins can send messages\./);
  // Inputs go through the pure validator, never trusted raw.
  assert.match(server, /validateAnnouncementInput\(input\)/);
  // The inbox read uses the request client (RLS applies), and
  // refuses signed-out callers; the admin list needs staff.
  assert.match(server, /listAnnouncementsForInbox/);
  assert.match(server, /createClient\(\)/);
  assert.match(server, /getCurrentUser\(\)/);
  assert.match(server, /isStaff\(role\)/);
  // Sending revalidates the admin tab and the inbox.
  assert.match(server, /revalidatePath\("\/admin"\)/);
  assert.match(server, /revalidatePath\("\/inbox"\)/);
  // No customer path can insert: the only insert is behind the
  // canSendBroadcasts gate, and errors are generic.
  assert.equal((server.match(/\.from\("announcements"\)\s*\n\s*\.insert/g) ?? []).length, 1);
  assert.match(server, /Something went wrong\. Please try again\./);
});

test("inbox server action: audit_log is read scoped to the caller's own orders only", () => {
  const server = read("lib/inbox-server.ts");
  assert.match(server, /"use server"/);
  // Own order ids first, via the request client (owner RLS).
  assert.match(server, /\.from\("orders"\)/);
  assert.match(server, /\.eq\("user_id", userId\)/);
  // Then audit_log, only for those ids and only order rows.
  assert.match(server, /\.from\("audit_log"\)/);
  assert.match(server, /\.eq\("entity_type", "order"\)/);
  assert.match(server, /\.in\("entity_id", orderIds\)/);
  // actor_id is never selected — the audit select lists only the
  // three columns the parser needs — and the raw action never leaves.
  assert.match(server, /\.select\("entity_id, action, created_at"\)/);
  assert.equal(/\.select\([^)]*actor_id/.test(server), false);
  assert.match(server, /parseOrderStatusAudit\(/);
  // Signed-out callers get nothing.
  assert.match(server, /if \(!userId\) return \[\];/);
});

// ---------------------------------------------------------------------------
// Admin Messages tab
// ---------------------------------------------------------------------------

test("admin: Messages tab exists for all staff; Users stays Owner-only", () => {
  const helpers = read("components/admin-helpers.ts");
  assert.match(helpers, /{ id: "messages", label: "Messages" }/);
  assert.match(helpers, /"messages"/);
  assert.deepEqual(
    // Re-implemented here from the source text is not the point —
    // the visible-tabs rule is pinned by the strings below plus
    // the admin page test. This checks the tab list itself.
    ["overview", "products", "banners", "orders", "messages", "users"].map((id) =>
      helpers.includes(`"${id}"`),
    ),
    [true, true, true, true, true, true],
  );
  // Owner sees all six; co-admin / manager see all but Users.
  assert.match(helpers, /return \["overview", "products", "banners", "orders", "messages", "users"\];/);
  assert.match(helpers, /return \["overview", "products", "banners", "orders", "messages"\];/);
});

test("admin: Messages tab fetches announcements server-side and renders the section", () => {
  const page = read("app/admin/page.tsx");
  assert.match(page, /listAnnouncements\(\)/);
  assert.match(page, /canSendBroadcasts\(callerRole\)/);
  assert.match(page, /announcements={announcements}/);
  assert.match(page, /canSendMessages={canSendMessages}/);
  assert.match(page, /tab === "messages"/);

  const shell = read("components/admin/dashboard-shell.tsx");
  assert.match(shell, /import MessagesSection from "\.\/messages-section"/);
  assert.match(shell, /tab === "messages"/);
  assert.match(shell, /<MessagesSection/);
  assert.match(shell, /canSend={canSendMessages}/);

  const section = read("components/admin/messages-section.tsx");
  // Compose form: title, message, type; send through the server action.
  assert.match(section, /sendAnnouncement\(validated\.value\)/);
  assert.match(section, /validateAnnouncementInput\(/);
  assert.match(section, /<option value="notification">Notification<\/option>/);
  assert.match(section, /<option value="offer">Offer<\/option>/);
  // List newest first with delete through the server action.
  assert.match(section, /deleteAnnouncement\(id\)/);
  assert.match(section, /No messages sent yet/);
  // The form only renders when the server said this caller may
  // send; a manager gets the read-only note instead.
  assert.match(section, /canSend \?/);
  assert.match(section, /Only the owner and co-admins can send messages\./);
  // Theme tokens only — no hard-coded hex colours in this file.
  assert.equal(/#[0-9a-fA-F]{3,8}/.test(section), false);
  // No fake/sample messages seeded in the section.
  assert.equal(/sample|fake|demo/i.test(section), false);
});

test("server-action files export only async functions (else the production build fails)", () => {
  // 2026-11-09: lib/announcements-server.ts exported a const
  // (ANNOUNCEMENT_GENERIC_ERROR) from a "use server" file and the
  // production build failed with "Only async functions are allowed
  // to be exported" — the same class of bug the roles build hit in
  // lib/reviews.ts. Type exports are fine; value exports are not.
  // The generic error is now a private const in that file.
  const server = read("lib/announcements-server.ts");
  assert.doesNotMatch(server, /^export const ANNOUNCEMENT_GENERIC_ERROR/m);
  assert.match(server, /^const ANNOUNCEMENT_GENERIC_ERROR/m);
  for (const rel of ["lib/announcements-server.ts", "lib/inbox-server.ts"]) {
    const src = read(rel);
    assert.match(src, /"use server"/);
    for (const line of src.split("\n")) {
      assert.doesNotMatch(line, /^export (const|let|var|function (?!async))/);
    }
  }
});

test("messages section keeps the sent notice across the refresh remount", () => {
  // 2026-11-09: after a successful send the section refreshed so
  // the list shows fresh server data, and that refresh remounts
  // the component, wiping a notice kept only in React state —
  // the same bug class as the review-form thank-you and the admin
  // role-change notice. The fix is the pending-notice pattern
  // from AdminUsers: the notice is stored outside React state as
  // well as in it, and the remounted component consumes it once.
  // (Dropping the refresh alone did not help: the server action's
  // revalidatePath("/admin") triggers the same remount.)
  const section = read("components/admin/messages-section.tsx");
  assert.match(section, /let pendingMessageNotice: string \| null = null;/);
  assert.match(
    section,
    /pendingMessageNotice = "Message sent to all users\.";/,
  );
  assert.match(section, /pendingMessageNotice = "Message deleted\.";/);
  assert.match(section, /const pending = pendingMessageNotice;/);
  assert.match(section, /router\.refresh\(\)/);
  assert.doesNotMatch(section, /localAnnouncements/);
  assert.doesNotMatch(section, /deletedIds/);
});
