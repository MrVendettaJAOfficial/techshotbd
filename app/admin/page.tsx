// Admin dashboard — server component.
//
// Fetches every live product (all statuses) and the
// live categories from Supabase (see lib/products/queries.ts) and
// renders the client dashboard, which still owns the demo-auth
// session, coupons, orders and users. Product writes go
// through the server actions in lib/products/actions.ts, so the shop
// reflects them immediately.

import { AuthProvider } from "@/lib/auth";
import { listUsers } from "@/lib/auth-server";
import { fetchAllProducts, type AdminUserItem } from "@/lib/products/queries";

import AdminDashboard from "./AdminDashboard";

export default async function AdminPage() {
  const [{ products, categories, configured }, users] = await Promise.all([
    fetchAllProducts(),
    // Admin users list with real emails (lib/auth-server listUsers).
    // Falls back to an empty list when Supabase is not configured or
    // the caller is not an admin.
    listUsers()
      .then((rows): AdminUserItem[] =>
        rows.map((row) => ({
          id: row.id,
          displayName: row.display_name ?? "TechShot user",
          email: row.email ?? "",
          role: row.role,
          createdAt: row.created_at,
        })),
      )
      .catch(() => [] as AdminUserItem[]),
  ]);

  return (
    <AuthProvider>
      <AdminDashboard products={products} categories={categories} configured={configured} users={users} />
    </AuthProvider>
  );
}
