// Admin dashboard shell (client component) — tab shell.
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
// Coupons live in ./coupons-section.
//
// There is no seller-approval section any more: TechShot is
// single-seller, so nobody can sign up as a seller.
//
// NOTE on the demo admin button: the auth workstream has removed the
// demo auth store (lib/auth.ts no longer exports signInAsDemoAdmin
// or listDemoUsers), so the "Sign in as demo admin" button cannot
// work any more and is gone from this page. Admins sign in with a
// real Supabase account that has a staff role (granted manually in
// the database). The header no longer says "DEMO ADMIN".
//
// Split from app/admin/AdminDashboard.tsx: the tab shell lives here,
// the coupons section in ./coupons-section, and
// app/admin/AdminDashboard.tsx re-exports this shell.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isOwner, isStaff } from "@/lib/roles";
import { Button, Card, EmptyState, SectionHeading } from "@/components/ui";
import ProductManager from "@/components/ProductManager";
import AdminOrders, { type ListedOrder } from "@/components/AdminOrders";
import AdminStats from "@/components/AdminStats";
import type { AdminStats as AdminStatsData } from "@/lib/admin/stats";
import AdminUsers from "@/components/AdminUsers";
import TabBar from "@/components/TabBar";
import { ADMIN_TABS, visibleAdminTabs, type AdminTabId } from "@/components/admin-helpers";
import CouponsSection from "./coupons-section";

import type { CategoryOption, ProductListItem } from "@/lib/products/types";
import type { AdminUserItem } from "@/lib/products/queries";

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

            <CouponsSection />
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
