// Admin dashboard (client component) — tab shell.
//
// The dashboard is split into tabs driven by the ?tab= search param
// (Overview / Products / Orders / Users), so tabs are shareable and
// survive refresh. The server page fetches only what the active tab
// needs. Which tabs exist for the caller depends on their role:
// Owner sees all four, co-admin and manager see everything except
// Users, and the Users tab is Owner-only — a non-owner who navigates
// to ?tab=users directly gets an access-denied message, not the
// content. Role helpers come from lib/roles.ts.
//
// Product management lives in components/ProductManager.tsx and is
// backed by Supabase through lib/products/actions.ts — the shop
// reflects every change there. Orders live in
// components/AdminOrders.tsx (status tabs + manual status selector,
// server actions in lib/orders/actions.ts). Users live in
// components/AdminUsers.tsx (Owner-only role changes + removal).
//
// Coupons are still stored locally in the demo (lib/demo-store).
// There is no seller-approval section any more: TechShot is
// single-seller, so nobody can sign up as a seller.
//
// NOTE on the demo admin button: the auth workstream has removed the
// demo auth store (lib/auth.ts no longer exports signInAsDemoAdmin
// or listDemoUsers), so the "Sign in as demo admin" button cannot
// work any more and is gone from this page. Admins sign in with a
// real Supabase account that has a staff role (granted manually in
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
import { isOwner, isStaff } from "@/lib/roles";
import { Badge, Button, Card, EmptyState, Field, Input, SectionHeading } from "@/components/ui";
import ProductManager from "@/components/ProductManager";
import AdminOrders, { type ListedOrder } from "@/components/AdminOrders";
import AdminStats from "@/components/AdminStats";
import type { AdminStats as AdminStatsData } from "@/lib/admin/stats";
import AdminUsers from "@/components/AdminUsers";
import TabBar from "@/components/TabBar";
import { ADMIN_TABS, visibleAdminTabs, type AdminTabId } from "@/components/admin-helpers";

import type { CategoryOption, ProductListItem } from "@/lib/products/types";
import type { AdminUserItem } from "@/lib/products/queries";

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
  /** Active tab from the ?tab= search param (validated server-side). */
  tab: AdminTabId;
  /** The signed-in caller's role, from getCallerRole() (server). */
  callerRole: string | null;
  /** The signed-in caller's user id, for the Users tab self-row. */
  currentUserId: string | null;
  /** Overview figures from getAdminStats(); null when unavailable. */
  stats: AdminStatsData | null;
  products: ProductListItem[];
  categories: CategoryOption[];
  configured: boolean;
  /** Live profiles rows (admin users list). Only fetched for the Users tab. */
  users: AdminUserItem[];
  /** Live Supabase orders for the admin list. Only fetched for the Orders tab. */
  initialOrders: ListedOrder[];
}

export default function AdminDashboard({
  tab,
  callerRole,
  currentUserId,
  stats,
  products,
  categories,
  configured,
  users,
  initialOrders,
}: AdminDashboardProps) {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);

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
  }, [refreshAll]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted">Loading the admin dashboard…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <SectionHeading
          title="Admin dashboard"
          description="Admin access is granted manually in the database. Sign-up can never create an admin account."
        />
        <Card>
          <p className="text-sm text-muted">
            Sign in with a staff account to manage products, orders, coupons and users.
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

  // The server-side role (getCallerRole) is authoritative. The
  // client session role is only a fallback for the transitional
  // moment when the server role is unavailable but the session
  // already proves the caller is the owner ("admin" role value).
  const effectiveRole = callerRole ?? (user.role === "admin" ? "admin" : null);

  if (!isStaff(effectiveRole)) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <SectionHeading title="Admin dashboard" description="This area is for store staff." />
        <Card>
          <p className="text-sm text-muted">
            This account does not have admin access. Sign in with a staff account to manage
            products, orders, coupons and users.
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

  const visibleTabs = visibleAdminTabs(effectiveRole);

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

      <TabBar
        tabs={ADMIN_TABS.filter((adminTab) => visibleTabs.includes(adminTab.id)).map(
          (adminTab) => ({ ...adminTab, href: `/admin?tab=${adminTab.id}` }),
        )}
        activeId={tab}
        ariaLabel="Admin sections"
      />

      <div className="mt-8">
        {tab === "overview" && (
          <div>
            <SectionHeading title="Overview" description="Store totals from live orders and products." />
            {stats ? (
              <AdminStats stats={stats} />
            ) : (
              <EmptyState
                title="Statistics are not available"
                description="Live statistics could not be loaded. Try refreshing the page."
              />
            )}

            <div className="mt-10">
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
            </div>
          </div>
        )}

        {tab === "products" && (
          <ProductManager
            products={products}
            categories={categories}
            canPublish
            configured={configured}
            callerRole={effectiveRole}
          />
        )}

        {tab === "orders" && (
          <AdminOrders initialOrders={initialOrders} configured={configured} callerRole={effectiveRole} />
        )}

        {tab === "users" &&
          (isOwner(effectiveRole) ? (
            <AdminUsers users={users} currentUserId={currentUserId} callerRole={effectiveRole} />
          ) : (
            <div>
              <SectionHeading title="Users" description="Registered accounts (profiles)." />
              <p role="alert" className="rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
                Only the owner can view and manage users.
              </p>
            </div>
          ))}
      </div>

      <p className="mt-8 text-sm">
        <Link href="/shop" className="font-medium text-brand hover:underline">
          View the shop
        </Link>
      </p>
    </main>
  );
}
