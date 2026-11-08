// Shared localStorage helpers for the admin dashboard.
//
// These are DEMO stores only. They hold admin coupons and admin
// order-status overrides in the browser, so dashboard actions work
// end to end without a backend. When Supabase is connected, these are
// replaced by Supabase tables (coupons, orders) behind Row Level
// Security.
//
// Single-seller store (2026-11-08): the seller-product override
// store and the seller-approval store were removed with the /seller
// route. Products are managed only in /admin through the Supabase
// server actions in lib/products/actions.ts, and the public shop
// reads the live catalogue — there is no localStorage catalogue
// override any more. Any stale "techshot-seller-*" keys left in a
// browser's localStorage are simply never read.

export interface AdminCoupon {
  code: string;
  valuePoisha: number; // discount in poisha
  minPoisha: number; // minimum order subtotal in poisha
  active: boolean;
  createdAt: string;
}

const KEYS = {
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
 *  admin page applies these on top of the stored orders. */
export function getOrderStatusOverrides(): Record<string, string> {
  return readJSON<Record<string, string>>(KEYS.orderStatus, {});
}

export function setOrderStatusOverride(orderId: string, status: string): void {
  writeJSON(KEYS.orderStatus, { ...getOrderStatusOverrides(), [orderId]: status });
}
