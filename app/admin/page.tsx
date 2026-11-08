// Admin dashboard.
//
// Admin access is granted manually — in production, in the database.
// Sign-up can never create an admin (see lib/auth). In this demo, the
// "Sign in as demo admin" button below creates a local-only admin session
// in this browser so the dashboard can be tried before Supabase is
// connected. That button and session are labelled DEMO ADMIN and are
// deleted with the demo auth store when Supabase Auth lands.
//
// Every action on this page writes to the demo store (lib/demo-store) and
// is reflected on reload: seller approvals, product pause/remove, order
// status, and coupons. Orders are read from lib/checkout-store
// (listOrders / updateOrderStatus); stored orders carry no seller id.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { AuthProvider, listDemoUsers, signInAsDemoAdmin, useAuth } from "@/lib/auth";
import {
  addAdminCoupon,
  decideSellerApproval,
  deleteCoupon,
  getAdminCoupons,
  getSellerApprovals,
  getSellerProductsOverride,
  removeProduct,
  toggleCoupon,
  togglePauseProduct,
  type AdminCoupon,
  type DemoProduct,
  type SellerApproval,
  type SellerProductsOverride,
} from "@/lib/demo-store";
import { formatBDT } from "@/lib/theme";
import { listOrders, updateOrderStatus, type StoredOrder } from "@/lib/checkout-store";
import { Badge, Button, Card, EmptyState, Field, Input, SectionHeading } from "@/components/ui";

interface ListedProduct {
  id: string;
  title: string;
  pricePoisha: number;
  stock: number;
  category: string;
  sellerEmail?: string;
  paused: boolean;
  isSellerAdded: boolean;
}

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

function toPoisha(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function productPricePoisha(p: Record<string, unknown>): number {
  if (typeof p.pricePoisha === "number") return toPoisha(p.pricePoisha);
  if (typeof p.price_poisha === "number") return toPoisha(p.price_poisha);
  if (typeof p.price === "number") return toPoisha(p.price);
  if (typeof p.priceTaka === "number") return Math.round(p.priceTaka * 100);
  return 0;
}

function extractProducts(module: Record<string, unknown>): ListedProduct[] {
  const candidates: unknown[] = [];
  for (const key of ["products", "catalog", "PRODUCTS", "items", "default"]) {
    const value = module[key];
    if (Array.isArray(value)) candidates.push(...value);
  }
  const seen = new Set<string>();
  const out: ListedProduct[] = [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id : typeof p.slug === "string" ? p.slug : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: typeof p.title === "string" ? p.title : typeof p.name === "string" ? p.name : "Untitled product",
      pricePoisha: productPricePoisha(p),
      stock: typeof p.stock === "number" ? p.stock : typeof p.inventory === "number" ? p.inventory : 0,
      category: typeof p.category === "string" ? p.category : "General",
      sellerEmail: typeof p.sellerEmail === "string" ? p.sellerEmail : undefined,
      paused: false,
      isSellerAdded: false,
    });
  }
  return out;
}

async function loadCatalogue(): Promise<ListedProduct[]> {
  try {
    const mod = (await import("@/lib/data/catalog")) as Record<string, unknown>;
    return extractProducts(mod);
  } catch {
    return [];
  }
}

function AdminDashboard() {
  const router = useRouter();
  const { user, loading, refresh, signOutUser } = useAuth();
  const [override, setOverride] = useState<SellerProductsOverride | null>(null);
  const [catalogue, setCatalogue] = useState<ListedProduct[]>([]);
  const [catalogueAvailable, setCatalogueAvailable] = useState(false);
  const [orders, setOrders] = useState<ListedOrder[]>([]);
  const [approvals, setApprovals] = useState<SellerApproval[]>([]);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [users, setUsers] = useState<ReturnType<typeof listDemoUsers>>([]);

  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("");
  const [couponMin, setCouponMin] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    setOverride(getSellerProductsOverride());
    setApprovals(getSellerApprovals());
    setCoupons(getAdminCoupons());
    setUsers(listDemoUsers());
  }, []);

  useEffect(() => {
    refreshAll();
    void loadCatalogue().then((products) => {
      setCatalogue(products);
      setCatalogueAvailable(products.length > 0);
    });
    setOrders(listOrders().map(fromStoredOrder));
  }, [refreshAll]);

  if (loading || !override) {
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
            For the demo, sign in with the demo admin account. This creates a local-only admin
            session in this browser — there is no demo admin password, and this button is removed
            when Supabase Auth is connected.
          </p>
          <Button
            className="mt-5 w-full"
            size="lg"
            onClick={() => {
              signInAsDemoAdmin();
              refresh();
            }}
          >
            Sign in as demo admin
          </Button>
          <p className="mt-4 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/auth/sign-in" className="font-medium text-brand hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </main>
    );
  }

  const merged: ListedProduct[] = [
    ...override.added.map((p: DemoProduct): ListedProduct => ({
      id: p.id,
      title: p.title,
      pricePoisha: p.pricePoisha,
      stock: p.stock,
      category: p.category,
      sellerEmail: p.sellerEmail,
      paused: p.paused,
      isSellerAdded: true,
    })),
    ...catalogue
      .filter((p) => !override.removedIds.includes(p.id))
      .map((p) => ({ ...p, paused: override.pausedIds.includes(p.id) ? true : p.paused })),
  ];
  const ordersWithStatus = orders;
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const totalRevenue = ordersWithStatus.reduce((sum, o) => sum + o.totalPoisha, 0);

  function handleDecideApproval(id: string, status: "approved" | "rejected") {
    decideSellerApproval(id, status);
    refreshAll();
  }

  function handlePause(id: string) {
    togglePauseProduct(id);
    refreshAll();
  }

  function handleRemove(id: string) {
    removeProduct(id);
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
          <h1 className="text-2xl font-bold text-text">
            Admin dashboard <Badge tone="warning">DEMO ADMIN — local only</Badge>
          </h1>
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
          <p className="mt-1 text-2xl font-bold text-text">{merged.length}</p>
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

      <SectionHeading
        title="Product moderation"
        description={
          catalogueAvailable
            ? "Pause hides a product from shoppers. Remove takes a seller-added product out, or hides a base-catalogue product."
            : "The base catalogue (lib/data/catalog) is not available yet, so only seller-added products are listed."
        }
      />
      {merged.length === 0 ? (
        <EmptyState title="No products to moderate" description="Products appear here once the catalogue or a seller adds them." className="mb-10" />
      ) : (
        <div className="mb-10 space-y-3">
          {merged.map((product) => (
            <Card key={product.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">
                    {product.title}{" "}
                    {product.paused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Live</Badge>}{" "}
                    {product.isSellerAdded ? <Badge tone="brand">Seller-added</Badge> : null}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formatBDT(product.pricePoisha)} · Stock: {product.stock} · {product.category}
                    {product.sellerEmail ? ` · Seller: ${product.sellerEmail}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handlePause(product.id)}>
                    {product.paused ? "Resume" : "Pause"}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleRemove(product.id)}>Remove</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

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

      <SectionHeading title="Users" description="Accounts registered in this browser's demo store. The demo admin is not a registered user and is not listed." />
      {users.length === 0 ? (
        <EmptyState title="No registered users yet" description="Customers and sellers who sign up in this browser appear here." />
      ) : (
        <div className="space-y-3">
          {users.map((account) => (
            <Card key={account.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">{account.displayName}</p>
                  <p className="text-sm text-muted">
                    {account.email} · Joined {new Date(account.createdAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Badge tone={account.role === "seller" ? "brand" : "default"}>{account.role}</Badge>
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

export default function AdminPage() {
  return (
    <AuthProvider>
      <AdminDashboard />
    </AuthProvider>
  );
}
