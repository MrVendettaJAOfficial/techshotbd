// Seller dashboard (client component).
//
// Product management lives in components/ProductManager.tsx and is
// backed by Supabase through lib/products/actions.ts — the shop
// reflects every change there. The parts below are unchanged from
// the demo dashboard and are NOT yet wired to Supabase (another
// workstream owns auth; orders / approvals still use the local
// stores):
//   * Orders come from lib/checkout-store (listOrders /
//     updateOrderStatus). Stored orders carry no seller id, so the
//     dashboard shows all stored orders and says so.
//   * The approval gate: a seller needs admin approval before
//     publishing. Approval is true when the live seller_profiles row
//     is verified (isVerified prop, from the server page) OR when the
//     existing demo-store approval record is "approved". The server
//     actions additionally refuse to publish for a seller whose
//     seller_profiles row exists and is not verified, so the gate
//     cannot be bypassed from the browser.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { addSellerApproval, getSellerApprovals, type SellerApproval } from "@/lib/demo-store";
import { formatBDT } from "@/lib/theme";
import { listOrders, updateOrderStatus, type StoredOrder } from "@/lib/checkout-store";
import { Badge, Button, Card, EmptyState, SectionHeading } from "@/components/ui";
import ProductManager from "@/components/ProductManager";

import type { AppUser } from "@/lib/auth";
import type { CategoryOption, ProductListItem } from "@/lib/products/types";

interface OrderItem {
  productId?: string;
  title?: string;
  quantity?: number;
  pricePoisha?: number;
}

interface ListedOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalPoisha: number;
  sellerId?: string;
  createdAt?: string;
  items: OrderItem[];
}

/** Stored checkout orders (lib/checkout-store) carry no seller id, so
 *  the seller dashboard shows all stored orders and says so. */
function fromStoredOrder(order: StoredOrder): ListedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalPoisha: order.total_poisha,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      productId: item.productId,
      title: item.title,
      quantity: item.quantity,
      pricePoisha: item.price_poisha,
    })),
  };
}

interface SellerDashboardProps {
  products: ProductListItem[];
  categories: CategoryOption[];
  configured: boolean;
  /** Live seller_profiles.is_verified, or null when there is no row / Supabase is not configured. */
  isVerified: boolean | null;
  /** Supabase session user, or null when there is no Supabase session. */
  serverUser: AppUser | null;
}

export default function SellerDashboard({ products, categories, configured, isVerified, serverUser }: SellerDashboardProps) {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [orders, setOrders] = useState<ListedOrder[]>([]);
  const [ordersAvailable, setOrdersAvailable] = useState(false);
  const [approval, setApproval] = useState<SellerApproval | null>(null);

  useEffect(() => {
    const stored = listOrders().map(fromStoredOrder);
    setOrders(stored);
    setOrdersAvailable(stored.length > 0);
  }, []);

  useEffect(() => {
    if (!user || user.role !== "seller") return;
    const existing = getSellerApprovals().find((a) => a.email.toLowerCase() === user.email.toLowerCase());
    if (existing) {
      setApproval(existing);
    } else {
      // Seller signed up before approvals were recorded: create the
      // pending record so an admin can approve it.
      const record: SellerApproval = {
        id: `approval-${user.id}`,
        displayName: user.displayName,
        email: user.email,
        status: "pending",
        createdAt: new Date().toISOString(),
        decidedAt: null,
      };
      addSellerApproval(record);
      setApproval(record);
    }
  }, [user]);

  useEffect(() => {
    if (!loading && !user) router.replace("/auth/sign-in");
  }, [loading, user, router]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted">Loading your seller dashboard…</p>
      </main>
    );
  }

  if (!user) return null;

  if (user.role !== "seller") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <SectionHeading title="Seller dashboard" description="This area is for seller accounts." />
        <EmptyState
          title="You are signed in as a customer"
          description="Seller tools need a seller account. Sign up as a seller, or sign in with a seller account, to manage products and orders."
          action={
            <div className="flex gap-3">
              <Link href="/auth/sign-up">
                <Button>Sign up as a seller</Button>
              </Link>
              <Link href="/shop">
                <Button variant="outline">Back to shop</Button>
              </Link>
            </div>
          }
        />
      </main>
    );
  }

  // Approval gate (kept as-is from the demo dashboard, plus the live
  // seller_profiles check): approved when either source says so.
  // The server actions enforce the live check strictly on publish.
  const isApproved = isVerified === true || approval?.status === "approved";
  const liveProducts = products;
  const visibleProducts = liveProducts.filter((p) => p.status === "active");

  const ordersWithStatus = orders;
  const ordersCarrySeller = ordersWithStatus.some((o) => Boolean(o.sellerId));
  const myOrders = ordersCarrySeller
    ? ordersWithStatus.filter((o) => o.sellerId === user.id)
    : ordersWithStatus;
  const revenuePoisha = myOrders.reduce((sum, o) => sum + o.totalPoisha, 0);

  function handleAdvanceOrder(order: ListedOrder) {
    const flow = ["pending_payment", "confirmed", "processing", "shipped", "delivered"];
    const index = flow.indexOf(order.status);
    const next = index >= 0 && index < flow.length - 1 ? flow[index + 1] : "delivered";
    updateOrderStatus(order.id, { status: next as StoredOrder["status"] });
    setOrders(listOrders().map(fromStoredOrder));
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Seller dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as {user.displayName} ({user.email})
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            signOutUser();
            router.push("/");
          }}
        >
          Sign out
        </Button>
      </div>

      {!isApproved ? (
        <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text" role="alert">
          {approval?.status === "rejected"
            ? "Your seller application was not approved. Please contact TechShot support if you think this is a mistake."
            : "Your seller account is waiting for admin approval. You can view your shop below, but publishing new products is disabled until an admin approves your account."}
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-text">
          Your seller account is approved. You can publish products.
        </div>
      )}

      {serverUser === null && configured === false ? (
        <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text" role="alert">
          Live product data is not configured yet. Your products will appear here once Supabase is connected and you have signed in with your Supabase account.
        </div>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Products listed</p>
          <p className="mt-1 text-2xl font-bold text-text">{visibleProducts.length}</p>
          <p className="text-xs text-muted">{liveProducts.length} total, including paused and drafts</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Orders</p>
          <p className="mt-1 text-2xl font-bold text-text">{myOrders.length}</p>
          <p className="text-xs text-muted">
            {ordersAvailable ? "From stored checkout orders" : "No stored orders yet"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Revenue</p>
          <p className="mt-1 text-2xl font-bold text-text">{formatBDT(revenuePoisha)}</p>
          <p className="text-xs text-muted">Sum of your stored orders</p>
        </Card>
      </div>

      <ProductManager
        products={liveProducts}
        categories={categories}
        mode="seller"
        canPublish={isApproved}
        configured={configured}
      />

      <div className="mt-10">
        <SectionHeading
          title="Your orders"
          description={
            ordersCarrySeller
              ? "Orders for your products, from stored checkout orders."
              : "Stored orders do not carry a seller id, so all stored orders are shown here."
          }
        />
        {myOrders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="When a customer buys one of your products, the order will appear here with its current status."
          />
        ) : (
          <div className="space-y-3">
            {myOrders.map((order) => (
              <Card key={order.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text">Order {order.orderNumber || order.id}</p>
                    <p className="mt-1 text-sm text-muted">
                      {formatBDT(order.totalPoisha)} · {order.items.length} item(s)
                      {order.createdAt ? ` · ${new Date(order.createdAt).toLocaleDateString("en-GB")}` : ""}
                    </p>
                    <ul className="mt-2 list-inside list-disc text-sm text-muted">
                      {order.items.map((item, index) => (
                        <li key={`${order.id}-item-${index}`}>
                          {item.title ?? item.productId ?? "Item"} × {item.quantity ?? 1}
                          {item.pricePoisha ? ` — ${formatBDT(item.pricePoisha)} each` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{order.status}</Badge>
                    {order.status !== "delivered" ? (
                      <Button variant="outline" size="sm" onClick={() => handleAdvanceOrder(order)}>
                        Advance status
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <p className="mt-8 text-sm">
        <Link href="/shop" className="font-medium text-brand hover:underline">
          View the shop
        </Link>
      </p>
    </main>
  );
}
