// Shared localStorage helpers for the seller and admin dashboards.
//
// These are DEMO stores only. They hold seller-added products, seller
// approval decisions, admin coupons and admin order-status overrides in
// the browser, so dashboard actions work end to end without a backend.
// When Supabase is connected, these are replaced by Supabase tables
// (products, seller_approvals, coupons, orders) behind Row Level Security;
// the dashboard pages keep the same behaviour, backed by the database
// instead of localStorage.
//
// Catalogue override mechanism (how /shop sees seller products):
//   - `added`   — products created in the seller dashboard. The shop
//     listing merges the base catalogue (lib/data/catalog) with these.
//   - `edited`  — field overrides for base-catalogue products, keyed by
//     product id. The shop listing prefers the edited fields.
//   - `pausedIds` / `removedIds` — base-catalogue products hidden from
//     the shop listing (paused by the seller, removed by an admin).
// The shop page is responsible for applying this merge; this file only
// owns the stored state. Until the shop merge lands, added products are
// visible in the seller dashboard itself.

export interface DemoProduct {
  id: string;
  title: string;
  pricePoisha: number; // price in poisha (100 poisha = ৳1)
  stock: number;
  category: string;
  description: string;
  sellerId: string;
  sellerEmail: string;
  paused: boolean;
  createdAt: string; // ISO date string
}

export interface SellerProductsOverride {
  added: DemoProduct[];
  edited: Record<string, Partial<Pick<DemoProduct, "title" | "pricePoisha" | "stock" | "category" | "description">>>;
  pausedIds: string[];
  removedIds: string[];
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface SellerApproval {
  id: string;
  displayName: string;
  email: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface AdminCoupon {
  code: string;
  valuePoisha: number; // discount in poisha
  minPoisha: number; // minimum order subtotal in poisha
  active: boolean;
  createdAt: string;
}

const KEYS = {
  sellerProducts: "techshot-seller-products-v1",
  sellerApprovals: "techshot-seller-approvals-v1",
  adminCoupons: "techshot-admin-coupons-v1",
  orderStatus: "techshot-admin-order-status-v1",
} as const;

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the dashboard keeps working in memory
    // for this visit; the change simply will not survive a reload.
  }
}

export function emptySellerProductsOverride(): SellerProductsOverride {
  return { added: [], edited: {}, pausedIds: [], removedIds: [] };
}

export function getSellerProductsOverride(): SellerProductsOverride {
  const stored = readJSON<SellerProductsOverride | null>(KEYS.sellerProducts, null);
  if (!stored) return emptySellerProductsOverride();
  return {
    added: Array.isArray(stored.added) ? stored.added : [],
    edited: stored.edited && typeof stored.edited === "object" ? stored.edited : {},
    pausedIds: Array.isArray(stored.pausedIds) ? stored.pausedIds : [],
    removedIds: Array.isArray(stored.removedIds) ? stored.removedIds : [],
  };
}

export function setSellerProductsOverride(value: SellerProductsOverride): void {
  writeJSON(KEYS.sellerProducts, value);
}

export function addSellerProduct(product: DemoProduct): void {
  const current = getSellerProductsOverride();
  setSellerProductsOverride({ ...current, added: [product, ...current.added] });
}

export function updateSellerProduct(id: string, patch: Partial<DemoProduct>): void {
  const current = getSellerProductsOverride();
  const inAdded = current.added.some((p) => p.id === id);
  if (inAdded) {
    setSellerProductsOverride({
      ...current,
      added: current.added.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
    return;
  }
  // Base-catalogue product: store the edit as a field override.
  const { title, pricePoisha, stock, category, description } = patch;
  const fields: SellerProductsOverride["edited"][string] = {};
  if (title !== undefined) fields.title = title;
  if (pricePoisha !== undefined) fields.pricePoisha = pricePoisha;
  if (stock !== undefined) fields.stock = stock;
  if (category !== undefined) fields.category = category;
  if (description !== undefined) fields.description = description;
  setSellerProductsOverride({
    ...current,
    edited: { ...current.edited, [id]: { ...(current.edited[id] ?? {}), ...fields } },
  });
}

export function togglePauseProduct(id: string): void {
  const current = getSellerProductsOverride();
  const inAdded = current.added.some((p) => p.id === id);
  if (inAdded) {
    setSellerProductsOverride({
      ...current,
      added: current.added.map((p) => (p.id === id ? { ...p, paused: !p.paused } : p)),
    });
    return;
  }
  const paused = current.pausedIds.includes(id);
  setSellerProductsOverride({
    ...current,
    pausedIds: paused ? current.pausedIds.filter((x) => x !== id) : [...current.pausedIds, id],
  });
}

export function removeProduct(id: string): void {
  const current = getSellerProductsOverride();
  if (current.added.some((p) => p.id === id)) {
    setSellerProductsOverride({
      ...current,
      added: current.added.filter((p) => p.id !== id),
    });
    return;
  }
  if (current.removedIds.includes(id)) return;
  setSellerProductsOverride({ ...current, removedIds: [...current.removedIds, id] });
}

export function getSellerApprovals(): SellerApproval[] {
  return readJSON<SellerApproval[]>(KEYS.sellerApprovals, []);
}

export function setSellerApprovals(value: SellerApproval[]): void {
  writeJSON(KEYS.sellerApprovals, value);
}

export function addSellerApproval(approval: SellerApproval): void {
  const current = getSellerApprovals();
  if (current.some((a) => a.email.toLowerCase() === approval.email.toLowerCase())) return;
  setSellerApprovals([approval, ...current]);
}

export function decideSellerApproval(id: string, status: Exclude<ApprovalStatus, "pending">): void {
  setSellerApprovals(
    getSellerApprovals().map((a) =>
      a.id === id ? { ...a, status, decidedAt: new Date().toISOString() } : a,
    ),
  );
}

export function getAdminCoupons(): AdminCoupon[] {
  const stored = readJSON<AdminCoupon[] | null>(KEYS.adminCoupons, null);
  if (stored) return stored;
  // Seed the launch coupon exactly as specified: ৳2,000 off orders of
  // ৳50,000 or more. Amounts are in poisha (100 poisha = ৳1).
  const seed: AdminCoupon[] = [
    { code: "FIRST2000", valuePoisha: 200000, minPoisha: 5000000, active: true, createdAt: new Date().toISOString() },
  ];
  writeJSON(KEYS.adminCoupons, seed);
  return seed;
}

export function setAdminCoupons(value: AdminCoupon[]): void {
  writeJSON(KEYS.adminCoupons, value);
}

export function addAdminCoupon(coupon: AdminCoupon): void {
  const current = getAdminCoupons();
  if (current.some((c) => c.code.toUpperCase() === coupon.code.toUpperCase())) {
    throw new Error(`Coupon ${coupon.code.toUpperCase()} already exists.`);
  }
  setAdminCoupons([{ ...coupon, code: coupon.code.toUpperCase() }, ...current]);
}

export function toggleCoupon(code: string): void {
  setAdminCoupons(
    getAdminCoupons().map((c) => (c.code === code ? { ...c, active: !c.active } : c)),
  );
}

export function deleteCoupon(code: string): void {
  setAdminCoupons(getAdminCoupons().filter((c) => c.code !== code));
}

/** Admin order-status overrides, keyed by order id. Used when the
 *  checkout/order store does not expose its own status update; the
 *  admin and seller pages apply these on top of the stored orders. */
export function getOrderStatusOverrides(): Record<string, string> {
  return readJSON<Record<string, string>>(KEYS.orderStatus, {});
}

export function setOrderStatusOverride(orderId: string, status: string): void {
  writeJSON(KEYS.orderStatus, { ...getOrderStatusOverrides(), [orderId]: status });
}
