// Admin dashboard — server component.
//
// Fetches every live product (all statuses) and the
// live categories from Supabase (see lib/products/queries.ts),
// the live orders for the admin (lib/orders-server.ts
// listAdminOrders), and the live users list. The dashboard renders
// the client component, which still owns the demo-auth session and
// the demo coupons. Product writes go through the server actions in
// lib/products/actions.ts and order status changes through
// lib/orders/actions.ts, so the shop and the customer order pages
// reflect them immediately.

import { AuthProvider } from "@/lib/auth";
import { listUsers } from "@/lib/auth-server";
import { listAdminOrders } from "@/lib/orders-server";
import { fetchAllProducts, type AdminUserItem } from "@/lib/products/queries";

import AdminDashboard from "./AdminDashboard";

export default async function AdminPage() {
  const [{ products, categories, configured }, users, adminOrders] = await Promise.all([
    fetchAllProducts(),
    // Admin users list (lib/auth-server listUsers). Only the display
    // name, role and join date are passed to the client dashboard —
    // emails stay server-side (the dashboard never renders them).
    // Falls back to an empty list when Supabase is not configured or
    // the caller is not an admin.
    listUsers()
      .then((rows): AdminUserItem[] =>
        rows.map((row) => ({
          id: row.id,
          displayName: row.display_name ?? "TechShot user",
          role: row.role,
          createdAt: row.created_at,
        })),
      )
      .catch(() => [] as AdminUserItem[]),
    // Live orders for the admin list. Empty when Supabase is not
    // configured or the caller is not an admin; the dashboard then
    // falls back to the local demo orders.
    listAdminOrders().catch(() => []),
  ]);

  return (
    <AuthProvider>
      <AdminDashboard
        products={products}
        categories={categories}
        configured={configured}
        users={users}
        initialOrders={adminOrders.map((order) => ({
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
        }))}
      />
    </AuthProvider>
  );
}
