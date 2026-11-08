// Admin dashboard (client component).
//
// Product management lives in components/ProductManager.tsx and is
// backed by Supabase through lib/products/actions.ts — the shop
// reflects every change there. The users list is also live now
// (profiles rows, passed in as props from the server page).
//
// The sections below are unchanged from the demo dashboard and are
// NOT yet wired to Supabase: seller approvals, orders
// (lib/checkout-store) and coupons (lib/demo-store).
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
  decideSellerApproval,
  deleteCoupon,
  getAdminCoupons,
  getSellerApprovals,
  toggleCoupon,
  type AdminCoupon,
  type SellerApproval,
} from "@/lib/demo-store";
import { formatBDT } from "@/lib/theme";
import { listOrders, updateOrderStatus, type StoredOrder } from "@/lib/checkout-store";
import { Badge, Button, Card, EmptyState, Field, Input, SectionHeading } from "@/components/ui";
import ProductManager from "@/components/ProductManager";

import type { CategoryOption, ProductListItem } from "@/lib/products/types";
import type { AdminUserItem } from "@/lib/products/queries";

interface ListedOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalPoisha: number;
  createdAt?: string;
  items: Array<{ title?: string; quantity?: number; pricePoisha?: number }>;
}

/** Map a stored checkout order (lib/checkout-store) to the shape this
 *  page renders. Stored orders carry no seller id. */
function fromStoredOrder(order: StoredOrder): ListedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
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
}

export default function AdminDashboard({ products, categories, configured, users }: AdminDashboardProps) {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [orders, setOrders] = useState<ListedOrder[]>([]);
  const [approvals, setApprovals] = useState<SellerApproval[]>([]);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);

  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("");
  const [couponMin, setCouponMin] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    setApprovals(getSellerApprovals());
    setCoupons(getAdminCoupons());
  }, []);

  useEffect(() => {
    refreshAll();
    setOrders(listOrders().map(fromStoredOrder));
  }, [refreshAll]);

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
            Sign in with an admin account to manage products, seller approvals, orders, coupons and users.
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
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const totalRevenue = ordersWithStatus.reduce((sum, o) => sum + o.totalPoisha, 0);

  function handleDecideApproval(id: string, status: "approved" | "rejected") {
    decideSellerApproval(id, status);
    refreshAll();
  }

  function handleAdvanceOrder(order: ListedOrder) {
    const flow = ["pending_payment", "confirmed", "processing", "shipped", "delivered"];
    const index = flow.indexOf(order.status);
    const next = index >= 0 && index < flow.length - 1 ? flow[index + 1] : "delivered";
    updateOrderStatus(order.id, { status: next as StoredOrder["status"] });
    setOrders(listOrders().map(fromStoredOrder));
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

      <div className="mb-8 grid gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">Pending approvals</p>
          <p className="mt-1 text-2xl font-bold text-text">{pendingApprovals.length}</p>
        </Card>
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

      <SectionHeading title="Seller approvals" description="Seller accounts wait for approval before they can publish products." />
      {approvals.length === 0 ? (
        <EmptyState
          title="No seller sign-ups yet"
          description="When someone signs up as a seller, their approval request appears here."
          className="mb-10"
        />
      ) : (
        <div className="mb-10 space-y-3">
          {approvals.map((approval) => (
            <Card key={approval.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">{approval.displayName}</p>
                  <p className="text-sm text-muted">
                    {approval.email} · Signed up {new Date(approval.createdAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={approval.status === "approved" ? "success" : approval.status === "rejected" ? "danger" : "warning"}>
                    {approval.status}
                  </Badge>
                  {approval.status === "pending" ? (
                    <>
                      <Button size="sm" onClick={() => handleDecideApproval(approval.id, "approved")}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => handleDecideApproval(approval.id, "rejected")}>Reject</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleDecideApproval(approval.id, approval.status === "approved" ? "rejected" : "approved")}>
                      {approval.status === "approved" ? "Revoke" : "Approve"}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProductManager
        products={products}
        categories={categories}
        mode="admin"
        canPublish
        configured={configured}
      />

      <div className="mt-10">
        <SectionHeading title="Orders" description="Advance an order through pending payment, confirmed, processing, shipped, delivered." />
        {ordersWithStatus.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Orders appear here once checkout stores them (lib/checkout-store)."
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
          description={configured ? "Customers and sellers who sign up appear here." : "Live user data is not configured yet, so no users can be listed here."}
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
                <Badge tone={account.role === "seller" ? "brand" : account.role === "admin" ? "warning" : "default"}>{account.role}</Badge>
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
