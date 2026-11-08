// Admin dashboard (client component).
//
// Product management lives in components/ProductManager.tsx and is
// backed by Supabase through lib/products/actions.ts — the shop
// reflects every change there. The users list is also live now
// (profiles rows, passed in as props from the server page), and so
// is the orders list: when Supabase is configured, orders come from
// the live database (lib/orders-server.ts listAdminOrders) and the
// Advance / Cancel / Refund buttons call the admin-only server
// actions in lib/orders/actions.ts, which validate the transition,
// write an audit_log row and revalidate the order pages — the
// customer order page moves as soon as the admin advances it. When
// Supabase is not configured, the orders section falls back to the
// local demo store (lib/checkout-store), exactly like the storefront
// catalogue fallback.
//
// Coupons are still stored locally in the demo (lib/demo-store).
// There is no seller-approval section any more: TechShot is
// single-seller, so nobody can sign up as a seller.
//
// NOTE on the demo admin button: the auth workstream has removed the
// demo auth store (lib/auth.ts no longer exports signInAsDemoAdmin
// or listDemoUsers), so the "Sign in as demo admin" button cannot
// work any more and is gone from this page. Admins sign in with a
// real Supabase account that has the admin role (granted manually in
// the database). The header no longer says "DEMO ADMIN".

"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import {
  addAdminCoupon,
  deleteCoupon,
  getAdminCoupons,
  toggleCoupon,
  type AdminCoupon,
} from "@/lib/demo-store";
import { formatBDT } from "@/lib/theme";
import { listOrders, updateOrderStatus, type StoredOrder } from "@/lib/checkout-store";
import { advanceOrderStatus, setOrderStatus } from "@/lib/orders/actions";
import { Badge, Button, Card, EmptyState, Field, Input, SectionHeading } from "@/components/ui";
import ProductManager from "@/components/ProductManager";

import type { CategoryOption, ProductListItem } from "@/lib/products/types";
import type { AdminUserItem } from "@/lib/products/queries";

interface ListedOrder {
  id: string;
  orderNumber: string;
  status: string;
  /** Latest payment status ("paid" gates the Refund button). */
  paymentStatus?: string;
  totalPoisha: number;
  createdAt?: string;
  items: Array<{ title?: string; quantity?: number; pricePoisha?: number }>;
}

/** Map a stored checkout order (lib/checkout-store) to the shape this
 *  page renders. Stored orders are store orders (no per-account split). */
function fromStoredOrder(order: StoredOrder): ListedOrder {
  return {
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
  };
}

const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Coupon code must be at least 3 characters.")
    .max(20, "Coupon code must be 20 characters or fewer.")
    .regex(/^[A-Za-z0-9]+$/, "Coupon code may only contain letters and numbers."),
  valueTaka: z.number().positive("Discount must be greater than ৳0."),
  minTaka: z.number().min(0, "Minimum order cannot be negative."),
});

interface AdminDashboardProps {
  products: ProductListItem[];
  categories: CategoryOption[];
  configured: boolean;
  /** Live profiles rows (admin users list). Empty when Supabase is not configured. */
  users: AdminUserItem[];
  /** Live Supabase orders for the admin list. Empty when Supabase is not configured. */
  initialOrders: ListedOrder[];
}

export default function AdminDashboard({ products, categories, configured, users, initialOrders }: AdminDashboardProps) {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [orders, setOrders] = useState<ListedOrder[]>(initialOrders);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);

  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("");
  const [couponMin, setCouponMin] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    setCoupons(getAdminCoupons());
  }, []);

  useEffect(() => {
    refreshAll();
    // Live orders when Supabase is configured; the local demo store
    // is only the fallback for an unconfigured install.
    if (configured) {
      setOrders(initialOrders);
    } else {
      setOrders(listOrders().map(fromStoredOrder));
    }
  }, [refreshAll, configured, initialOrders]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted">Loading the admin dashboard…</p>
      </main>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <SectionHeading
          title="Admin dashboard"
          description="Admin access is granted manually in the database. Sign-up can never create an admin account."
        />
        <Card>
          <p className="text-sm text-muted">
            Sign in with an admin account to manage products, orders, coupons and users.
          </p>
          <p className="mt-4 text-center text-sm text-muted">
            <Link href="/auth/sign-in" className="font-medium text-brand hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </main>
    );
  }

  const ordersWithStatus = orders;
  const totalRevenue = ordersWithStatus.reduce((sum, o) => sum + o.totalPoisha, 0);

  /** Advance one order via the live server action (or the local demo
   *  store when Supabase is not configured). The server validates the
   *  transition, writes the audit row and revalidates the order pages,
   *  so the customer order page moves too. */
  async function handleAdvanceOrder(order: ListedOrder) {
    setOrderError(null);
    if (configured) {
      const result = await advanceOrderStatus(order.id);
      if (!result.ok) {
        setOrderError(result.error);
        return;
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: result.newStatus } : o)),
      );
      router.refresh();
      return;
    }
    const flow = ["pending_payment", "confirmed", "processing", "shipped", "delivered"];
    const index = flow.indexOf(order.status);
    const next = index >= 0 && index < flow.length - 1 ? flow[index + 1] : "delivered";
    updateOrderStatus(order.id, { status: next as StoredOrder["status"] });
    setOrders(listOrders().map(fromStoredOrder));
  }

  /** Cancel / refund via the live server action (configured only —
   *  the demo store has no cancel or refund path). */
  async function handleSetOrderStatus(order: ListedOrder, target: "cancelled" | "refunded") {
    setOrderError(null);
    const result = await setOrderStatus(order.id, target);
    if (!result.ok) {
      setOrderError(result.error);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, status: result.newStatus } : o)),
    );
    router.refresh();
  }

  function handleAddCoupon(event: FormEvent) {
    event.preventDefault();
    setCouponError(null);
    setCouponNotice(null);
    const parsed = couponSchema.safeParse({
      code: couponCode,
      valueTaka: Number(couponValue),
      minTaka: Number(couponMin),
    });
    if (!parsed.success) {
      setCouponError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    try {
      addAdminCoupon({
        code: parsed.data.code,
        valuePoisha: Math.round(parsed.data.valueTaka * 100),
        minPoisha: Math.round(parsed.data.minTaka * 100),
        active: true,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      setCouponError(error instanceof Error ? error.message : "Could not add the coupon.");
      return;
    }
    setCouponCode("");
    setCouponValue("");
    setCouponMin("");
    setCouponNotice(`Coupon ${parsed.data.code.toUpperCase()} was added.`);
    refreshAll();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Admin dashboard</h1>
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

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Products</p>
          <p className="mt-1 text-2xl font-bold text-text">{products.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Orders</p>
          <p className="mt-1 text-2xl font-bold text-text">{ordersWithStatus.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Order revenue</p>
          <p className="mt-1 text-2xl font-bold text-text">{formatBDT(totalRevenue)}</p>
        </Card>
      </div>

      <ProductManager
        products={products}
        categories={categories}
        canPublish
        configured={configured}
      />

      <div className="mt-10">
        <SectionHeading title="Orders" description="Advance an order through pending payment, confirmed, processing, shipped, delivered." />
        {orderError ? (
          <p role="alert" className="mb-4 text-sm text-[#f87171]">{orderError}</p>
        ) : null}
        {ordersWithStatus.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description={
              configured
                ? "Orders placed on the shop appear here."
                : "Orders appear here once checkout stores them locally."
            }
            className="mb-10"
          />
        ) : (
          <div className="mb-10 space-y-3">
            {ordersWithStatus.map((order) => (
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
                          {item.title ?? "Item"} × {item.quantity ?? 1}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{order.status}</Badge>
                    {order.status !== "delivered" &&
                    order.status !== "cancelled" &&
                    order.status !== "refunded" ? (
                      <Button variant="outline" size="sm" onClick={() => handleAdvanceOrder(order)}>
                        Advance status
                      </Button>
                    ) : null}
                    {(order.status === "pending_payment" || order.status === "confirmed") &&
                    configured ? (
                      <Button variant="danger" size="sm" onClick={() => handleSetOrderStatus(order, "cancelled")}>
                        Cancel
                      </Button>
                    ) : null}
                    {order.paymentStatus === "paid" &&
                    order.status !== "cancelled" &&
                    order.status !== "refunded" &&
                    configured ? (
                      <Button variant="outline" size="sm" onClick={() => handleSetOrderStatus(order, "refunded")}>
                        Refund
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SectionHeading title="Coupons" description="Coupons are stored locally in the demo. FIRST2000 is the launch coupon: ৳2,000 off orders of ৳50,000 or more." />
      <div className="mb-10 space-y-3">
        {coupons.map((coupon) => (
          <Card key={coupon.code}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-text">
                  {coupon.code} {coupon.active ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formatBDT(coupon.valuePoisha)} off orders of {formatBDT(coupon.minPoisha)} or more
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toggleCoupon(coupon.code);
                    refreshAll();
                  }}
                >
                  {coupon.active ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    deleteCoupon(coupon.code);
                    refreshAll();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
        <Card>
          <form onSubmit={handleAddCoupon} noValidate className="grid gap-3 sm:grid-cols-4">
            <Field label="Code" htmlFor="coupon-code" required>
              <Input id="coupon-code" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="e.g. EID500" />
            </Field>
            <Field label="Discount (৳)" htmlFor="coupon-value" required>
              <Input id="coupon-value" type="number" min="0" step="1" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} placeholder="500" />
            </Field>
            <Field label="Minimum order (৳)" htmlFor="coupon-min" required>
              <Input id="coupon-min" type="number" min="0" step="1" value={couponMin} onChange={(e) => setCouponMin(e.target.value)} placeholder="5000" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Add coupon</Button>
            </div>
            {couponError ? (
              <p role="alert" className="text-sm text-[#f87171] sm:col-span-4">{couponError}</p>
            ) : null}
            {couponNotice ? (
              <p role="status" className="text-sm text-success sm:col-span-4">{couponNotice}</p>
            ) : null}
          </form>
        </Card>
      </div>

      <SectionHeading title="Users" description="Registered accounts (profiles). Emails live in Supabase Auth, not in profiles, so only the display name and role are shown here." />
      {users.length === 0 ? (
        <EmptyState
          title="No registered users yet"
          description={configured ? "Customers who sign up appear here." : "Live user data is not configured yet, so no users can be listed here."}
        />
      ) : (
        <div className="space-y-3">
          {users.map((account) => (
            <Card key={account.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">{account.displayName}</p>
                  <p className="text-sm text-muted">
                    Joined {new Date(account.createdAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Badge tone={account.role === "admin" ? "warning" : "default"}>{account.role}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-8 text-sm">
        <Link href="/shop" className="font-medium text-brand hover:underline">
          View the shop
        </Link>
      </p>
    </main>
  );
}
