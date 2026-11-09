// Shared tab + status helpers for the admin dashboard and the
// customer orders page (roles + admin-tabs build).
//
// Pure functions only, no imports: unit tests import this file
// directly, and it must not depend on server modules that are still
// landing (lib/roles.ts, lib/admin/stats.ts, lib/reviews.ts).
//
// Role values are the profiles.role values from the database:
// "admin" is the Owner (the current admin role value), "co_admin",
// "manager", "customer". A legacy "seller" value grants nothing and
// is treated like a customer here.

export type AdminTabId = "overview" | "products" | "orders" | "users";

export const ADMIN_TABS: Array<{ id: AdminTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "orders", label: "Orders" },
  { id: "users", label: "Users" },
];

export function isAdminTab(value: string | null | undefined): value is AdminTabId {
  return (
    value === "overview" || value === "products" || value === "orders" || value === "users"
  );
}

/**
 * Which admin tabs a caller may see. Owner sees all four; co-admin
 * and manager see everything except Users; anyone else sees none
 * (the dashboard gate shows the sign-in / access message instead).
 */
export function visibleAdminTabs(role: string | null | undefined): AdminTabId[] {
  if (role === "admin") return ["overview", "products", "orders", "users"];
  if (role === "co_admin" || role === "manager") return ["overview", "products", "orders"];
  return [];
}

export type OrderStatusId =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "returned"
  | "cancelled"
  | "refunded";

/** All nine order statuses, in fulfilment order, exits last. */
export const ORDER_STATUSES: OrderStatusId[] = [
  "pending_payment",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
  "refunded",
];

export const ORDER_STATUS_LABELS: Record<OrderStatusId, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** Display label for any order status string; unknown values pass through. */
export function orderStatusLabel(status: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export type OrderStatusFilter = "all" | OrderStatusId;

export interface StatusTab {
  id: string;
  label: string;
}

/** "All" plus the nine order statuses, for the admin and customer order tabs. */
export const ORDER_STATUS_TABS: StatusTab[] = [
  { id: "all", label: "All" },
  ...ORDER_STATUSES.map((status) => ({ id: status, label: ORDER_STATUS_LABELS[status] })),
];

export type ProductStatusId = "active" | "paused" | "draft";

export const PRODUCT_STATUSES: ProductStatusId[] = ["active", "paused", "draft"];

export const PRODUCT_STATUS_LABELS: Record<ProductStatusId, string> = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
};

/** "All" plus the three product statuses, for the admin Products tab. */
export const PRODUCT_STATUS_TABS: StatusTab[] = [
  { id: "all", label: "All" },
  ...PRODUCT_STATUSES.map((status) => ({ id: status, label: PRODUCT_STATUS_LABELS[status] })),
];

/** Roles that can be assigned in the Users tab (Owner-only). Values
 *  are the profiles.role values; labels are the display names. */
export const USER_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "admin", label: "Owner" },
  { value: "co_admin", label: "Co-admin" },
  { value: "manager", label: "Manager" },
  { value: "customer", label: "Customer" },
];

/** Role filter tabs for the Users tab: "All" plus one tab per role. */
export const USER_ROLE_TABS: StatusTab[] = [
  { id: "all", label: "All" },
  ...USER_ROLE_OPTIONS.map((option) => ({ id: option.value, label: option.label })),
];

/** Count items by status string: { pending_payment: 2, delivered: 1, ... }. */
export function countByStatus<T>(
  items: T[],
  getStatus: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const status = getStatus(item);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/** Filter items by a status tab id; "all" returns every item. */
export function filterByStatus<T>(
  items: T[],
  filter: string,
  getStatus: (item: T) => string,
): T[] {
  if (filter === "all") return items;
  return items.filter((item) => getStatus(item) === filter);
}

export interface SpecificationRow {
  key: string;
  value: string;
}

/**
 * Clean a specifications key/value list for saving: trim both sides
 * and drop rows with an empty key or an empty value. Rows are kept
 * in order; duplicate keys are left for the server to handle.
 */
export function cleanSpecifications(rows: SpecificationRow[]): SpecificationRow[] {
  const cleaned: SpecificationRow[] = [];
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (key === "" || value === "") continue;
    cleaned.push({ key, value });
  }
  return cleaned;
}
