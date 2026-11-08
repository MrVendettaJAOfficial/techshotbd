// Seller dashboard — server component.
//
// Fetches the seller's own live products and categories from Supabase
// (see lib/products/queries.ts) and renders the client dashboard,
// which still owns the demo-auth session, the approval record and the
// stored orders. Product writes go through the server actions in
// lib/products/actions.ts, so the shop reflects them immediately.

import { AuthProvider } from "@/lib/auth";
import { getCurrentUser, getSellerVerified } from "@/lib/auth-server";
import { fetchSellerProducts } from "@/lib/products/queries";

import SellerDashboard from "./SellerDashboard";

export default async function SellerPage() {
  const serverUser = await getCurrentUser();
  const { products, categories, configured } = await fetchSellerProducts(serverUser?.id ?? null);
  const isVerified = serverUser ? await getSellerVerified(serverUser.id) : null;

  return (
    <AuthProvider>
      <SellerDashboard
        products={products}
        categories={categories}
        configured={configured}
        isVerified={isVerified}
        serverUser={serverUser}
      />
    </AuthProvider>
  );
}
