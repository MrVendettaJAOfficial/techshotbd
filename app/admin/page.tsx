// Admin dashboard — server component.
//
// The dashboard is split into tabs (?tab=overview|products|orders|
// users, default overview). Only the active tab's data is fetched:
// Overview reads the figures from getAdminStats()
// (lib/admin/stats.ts), Products fetches every live product (all
// statuses) and the live categories from Supabase (see
// lib/products/queries.ts), Orders fetches the live orders for the
// admin (lib/orders-server.ts listAdminOrders), and Users — Owner
// only — fetches the live users list (lib/auth-server listUsers).
// The dashboard renders the client shell, which still owns the
// demo-auth session and the demo coupons. Product writes go through
// the server actions in lib/products/actions.ts and order status
// changes through lib/orders/actions.ts, so the shop and the
// customer order pages reflect them immediately.

import { AuthProvider } from "@/lib/auth";
import { getCallerRole, getCurrentUser, listUsers } from "@/lib/auth-server";
import { listAdminOrders } from "@/lib/orders-server";
import { fetchAllProducts, type AdminUserItem } from "@/lib/products/queries";
import { getAdminStats, type AdminStats } from "@/lib/admin/stats";
import { isOwner } from "@/lib/roles";
import { isAdminTab, visibleAdminTabs, type AdminTabId } from "@/components/admin-helpers";
import type { ListedOrder } from "@/components/AdminOrders";

import AdminDashboard from "./AdminDashboard";

interface AdminPageProps {
  searchParams?: { tab?: string | string[] };
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const callerRole = await getCallerRole().catch(() => null);
  const currentUser = await getCurrentUser().catch(() => null);

  const rawTab = searchParams?.tab;
  const rawTabValue = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const requestedTab: AdminTabId = isAdminTab(rawTabValue) ? rawTabValue : "overview";
  const visibleTabs = visibleAdminTabs(callerRole);
  // A non-owner who navigates to ?tab=users directly must see an
  // access-denied message, not a silent redirect to Overview — so
  // "users" is kept as the active tab even when it is not visible
  // to the caller. Every other hidden or unknown tab falls back to
  // Overview.
  const tab: AdminTabId =
    requestedTab === "users" && !isOwner(callerRole)
      ? "users"
      : visibleTabs.includes(requestedTab)
        ? requestedTab
        : "overview";

  let stats: AdminStats | null = null;
  let products: Awaited<ReturnType<typeof fetchAllProducts>>["products"] = [];
  let categories: Awaited<ReturnType<typeof fetchAllProducts>>["categories"] = [];
  let configured = false;
  let users: AdminUserItem[] = [];
  let adminOrders: ListedOrder[] = [];

  if (tab === "overview") {
    stats = await getAdminStats().catch(() => null);
  } else if (tab === "products") {
    const result = await fetchAllProducts();
    products = result.products;
    categories = result.categories;
    configured = result.configured;
  } else if (tab === "orders") {
    const [orders, productResult] = await Promise.all([
      // Live orders for the admin list. Empty when Supabase is not
      // configured or the caller is not staff; the dashboard then
      // falls back to the local demo orders.
      listAdminOrders().catch(() => []),
      // Only for the `configured` flag, which decides the demo
      // fallback in the orders section.
      fetchAllProducts(),
    ]);
    configured = productResult.configured;
    adminOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalPoisha: order.total_poisha,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        title: item.title,
        quantity: item.quantity,
        pricePoisha: item.price_poisha,
      })),
    }));
  } else if (tab === "users" && isOwner(callerRole)) {
    // Admin users list (lib/auth-server listUsers). Only the display
    // name, role and join date are passed to the client dashboard —
    // emails stay server-side (the dashboard never renders them).
    // Falls back to an empty list when Supabase is not configured or
    // the caller is not the owner.
    users = await listUsers()
      .then((rows): AdminUserItem[] =>
        rows.map((row) => ({
          id: row.id,
          displayName: row.display_name ?? "TechShot user",
          role: row.role,
          createdAt: row.created_at,
        })),
      )
      .catch(() => [] as AdminUserItem[]);
  }

  return (
    <AuthProvider>
      <AdminDashboard
        tab={tab}
        callerRole={callerRole}
        currentUserId={currentUser?.id ?? null}
        stats={stats}
        products={products}
        categories={categories}
        configured={configured}
        users={users}
        initialOrders={adminOrders}
      />
    </AuthProvider>
  );
}
