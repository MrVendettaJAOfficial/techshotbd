// TechShot marketplace — staff role helpers.
//
// Pure module, no imports: the exact rules the server actions in
// lib/orders/actions.ts, lib/products/actions.ts and
// lib/auth-server.ts enforce, so tests/roles.test.mjs can import
// this file directly (Node strips the erasable TypeScript types, as
// with lib/catalog-rules.ts). Only erasable TypeScript is used here
// (type exports + functions) — no enums, namespaces or parameter
// properties.
//
// Roles (profiles.role, migration 0006):
//   - "admin"    — the Owner. The only role that may manage users
//     and the only role that may change orders or edit products
//     alongside co_admin.
//   - "co_admin" — a co-admin: manages products (including edits),
//     changes orders, and uses /admin, but may not manage users.
//   - "manager"  — a manager: uses /admin, adds and deletes
//     products, but may NOT edit/pause products and may NOT change
//     orders.
//   - "customer" — a shopper. "seller" is a legacy value and is
//     treated as customer everywhere (single-seller store: the
//     owner is the only seller).
//
// Every helper takes a plain string (or null / undefined — a
// signed-out caller, or a missing profiles row) and treats anything
// it does not recognise as "customer". Callers must never trust a
// role string from the browser: the server actions re-read the
// caller's profiles.role from the database on every call.

/** The staff roles: owner, co-admin, manager. */
export type StaffRole = "admin" | "co_admin" | "manager";

/** True only for the Owner (role "admin"). */
export function isOwner(role: string | null | undefined): boolean {
  return role === "admin";
}

/** True only for a co-admin (role "co_admin"). */
export function isCoAdmin(role: string | null | undefined): boolean {
  return role === "co_admin";
}

/** True only for a manager (role "manager"). */
export function isManager(role: string | null | undefined): boolean {
  return role === "manager";
}

/** True for any staff role: owner, co-admin or manager. */
export function isStaff(role: string | null | undefined): boolean {
  return role === "admin" || role === "co_admin" || role === "manager";
}

/** Who may manage products at all (add / delete): owner, co-admin, manager. */
export function canManageProducts(role: string | null | undefined): boolean {
  return isStaff(role);
}

/**
 * Who may edit / pause a product: owner and co-admin only. A manager
 * adds and deletes products but does NOT edit or pause them.
 */
export function canEditProducts(role: string | null | undefined): boolean {
  return role === "admin" || role === "co_admin";
}

/** Who may change an order's status: owner and co-admin only. */
export function canChangeOrders(role: string | null | undefined): boolean {
  return role === "admin" || role === "co_admin";
}

/**
 * Who may send in-app broadcast messages (and delete them):
 * the Owner and co-admins only. A manager is staff, but may NOT
 * send broadcasts — the server actions in
 * lib/announcements-server.ts enforce this on every call, and the
 * announcements RLS policies (migration 0009) enforce it in the
 * database too. Customers can never send.
 */
export function canSendBroadcasts(role: string | null | undefined): boolean {
  return role === "admin" || role === "co_admin";
}

/** Who may manage users (change roles, remove users): the Owner only. */
export function canManageUsers(role: string | null | undefined): boolean {
  return role === "admin";
}

/** Display label for a role value; anything unrecognised is a Customer. */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "admin":
      return "Owner";
    case "co_admin":
      return "Co-admin";
    case "manager":
      return "Manager";
    case "customer":
      return "Customer";
    case "seller":
      return "Seller";
    default:
      return "Customer";
  }
}
