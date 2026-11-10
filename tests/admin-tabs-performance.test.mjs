// Admin tabs performance fix (2026-11-11) — slow mobile tab taps.
//
// The admin tabs took 10-20s per tap on mobile: every tap fetched
// the whole product catalogue again (five round trips) just for the
// `configured` flag, the Orders tab re-read the caller's profile,
// and — worst — the tap showed literally nothing until the server
// answered, because loading.tsx never renders during client-side
// ?tab= navigation. These tests pin the fix at source level; the
// round-trip counts and the tap-to-highlight timing are measured
// live by tests/e2e/admin-tabs-performance.mjs.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = (...parts) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ...parts), "utf8");

test("admin page: Banners / Orders / Messages use the zero-round-trip configured check", () => {
  const page = root("app", "admin", "page.tsx");
  // The env-var-only check is imported and used for the three tabs
  // that only need the flag.
  assert.match(page, /import \{ isSupabaseConfigured \} from "@\/lib\/supabase\/server";/);
  assert.equal((page.match(/configured = isSupabaseConfigured\(\);/g) ?? []).length, 3);
  // fetchAllProducts is still used — but only for the Products tab,
  // which actually needs the data.
  assert.match(page, /const result = await fetchAllProducts\(\);/);
  assert.equal(/fetchAllProducts\(\)\.catch/.test(page), false);
  assert.equal(/Promise\.all\(\[\s*\/\/ Live orders/.test(page), false);
});

test("isSupabaseConfigured is an env-var check only — no network", () => {
  const server = root("lib", "supabase", "server.ts");
  assert.match(server, /export function isSupabaseConfigured\(\): boolean \{/);
  const fn = server.slice(server.indexOf("export function isSupabaseConfigured"));
  const body = fn.slice(0, fn.indexOf("}\n") + 1);
  assert.match(body, /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(body, /process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(body, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(/await|fetch\(|createClient/.test(body), false);
});

test("TabBar: link tabs flip instantly with a pending spinner; button tabs unchanged", () => {
  const tabBar = root("components", "TabBar.tsx");
  // A tapped link tab becomes the displayed active tab at once and
  // shows a spinner until the server-delivered activeId catches up.
  assert.match(tabBar, /const \[pendingId, setPendingId\] = useState<string \| null>\(null\);/);
  assert.match(tabBar, /const displayActiveId = pendingId \?\? activeId;/);
  assert.match(tabBar, /onClick=\{\(\) => setPendingId\(tab\.id\)\}/);
  assert.match(tabBar, /data-pending=\{pending \? "true" : undefined\}/);
  assert.match(tabBar, /Loader2/);
  assert.match(tabBar, /animate-spin/);
  // The pending state clears only when the server's active tab
  // matches the tap — an earlier payload must not clear a later tap.
  assert.match(tabBar, /if \(pendingId !== null && pendingId === activeId\) \{/);
  // Button mode has no pending logic: it is parent-controlled and
  // already updates instantly.
  const buttonBranch = tabBar.slice(tabBar.indexOf("return (\n          <button"));
  assert.equal(/pending/.test(buttonBranch), false);
});

test("orders: listAdminOrders reuses the cached caller role, no own profiles read", () => {
  const list = root("lib", "orders", "server", "list.ts");
  assert.match(list, /const role = await getCallerRole\(\);/);
  assert.match(list, /if \(!isStaff\(role\)\) return \[\];/);
  assert.equal(/\.from\("profiles"\)/.test(list), false);
});

test("orders: getSignedInUserId delegates to the cached getCurrentUser", () => {
  const shared = root("lib", "orders", "server", "shared.ts");
  assert.match(shared, /import \{ getCurrentUser \} from "\.\.\/\.\.\/auth-server\/session";/);
  assert.match(shared, /const user = await getCurrentUser\(\);/);
  assert.match(shared, /return user\?\.id \?\? null;/);
  // No second cached getUser of its own any more.
  assert.equal(/fetchSignedInUserId/.test(shared), false);
  assert.equal(/supabase\.auth\.getUser\(\)/.test(shared.slice(0, shared.indexOf("getSignedInUser"))), false);
});

test("admin loading skeleton mirrors the tabbed dashboard shell", () => {
  const loading = root("app", "admin", "loading.tsx");
  assert.match(loading, /max-w-5xl/);
  assert.match(loading, /px-4 py-12/);
  assert.match(loading, /role="tablist"/);
  assert.match(loading, /"Overview", "Products", "Banners", "Orders", "Messages", "Users"/);
  assert.match(loading, /mt-8/);
  // Solid colours only, no gradients, no emoji.
  assert.equal(/bg-gradient|linear-gradient|radial-gradient/.test(loading), false);
});
