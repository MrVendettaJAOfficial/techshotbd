// Shared types + localStorage persistence for the TechShot cart, checkout,
// orders and account flows.
//
// This module is client-safe (every read/write is guarded by a window
// check). It owns saved-for-later, coupon code, orders, profile,
// addresses and wishlist. The live cart itself is owned by lib/cart-store
// (CartProvider + useCart, key "techshot-cart-v1"); see the note above the
// save-for-later section.
//
// Persistence note (gap, stated plainly): orders, addresses, wishlist
// and profile are stored in the browser's localStorage in this preview.
// They are NOT yet persisted to Supabase, except for orders placed by a
// signed-in user when Supabase is configured: those are created in the
// Supabase `orders` / `order_items` tables by lib/orders-server.ts
// createSupabaseOrder() (called from the checkout page) and the same
// order is also saved here so the Orders / Account pages can list it.
// The server-side in-memory order record created at checkout lives in
// lib/orders.ts and is a separate, per-server-instance store; the two
// are reconciled by order id (checkout saves the same order object to
// both). Production must replace both with Supabase orders / cart_items
// / addresses tables.

export type DeliveryOption = "standard" | "express";
export type PaymentMethod = "card" | "bkash" | "nagad" | "cod" | "emi";
export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "returned";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "cancelled" | "refunded";

export interface OrderItem {
  productId: string;
  title: string;
  variant?: string;
  price_poisha: number;
  mrp_poisha: number;
  image?: string;
  quantity: number;
}

export interface Address {
  id: string;
  label?: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  address: string;
  area: string;
  division: string;
  district: string;
  city: string;
  isDefault: boolean;
}

export interface StoredOrder {
  id: string;
  orderNumber: string;
  items: OrderItem[];
  address: Address;
  delivery: DeliveryOption;
  paymentMethod: PaymentMethod;
  subtotal_poisha: number;
  savings_poisha: number;
  couponCode: string | null;
  couponDiscount_poisha: number;
  deliveryFee_poisha: number;
  total_poisha: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** How this order was cancelled, when it was cancelled from the order page: "live" means the server confirmed the live cancel (stock released), "local" means the browser copy only was cancelled. Persisted with the order — not kept in component state — because the cancel server action revalidates the order pages and that refresh remounts the order page, wiping transient notice state (proven by the Playwright mock run, 2026-11-08: the live cancel succeeded but no notice showed). Absent on orders never cancelled from the page. */
  cancelNotice?: "live" | "local";
  /** True when the payment went through a test adapter (card / bKash / Nagad / EMI). */
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  displayName: string;
  phone: string;
  email: string;
}

export interface WishlistItem {
  productId: string;
  title: string;
  price_poisha: number;
  mrp_poisha: number;
  image?: string;
}

/** A cart line saved for later: same shape as lib/cart-store's CartItem
 *  ({ slug, variant, quantity }) — prices are always re-derived from the
 *  catalog via getProduct, never stored here. */
export interface SavedItem {
  slug: string;
  variant?: string;
  quantity: number;
}

export const STORAGE_KEYS = {
  savedForLater: "techshot:saved-for-later",
  coupon: "techshot:coupon",
  orders: "techshot:orders",
  profile: "techshot:profile",
  addresses: "techshot:addresses",
  wishlist: "techshot:wishlist",
} as const;

/** Ordered fulfilment steps shown in the order timeline. */
export const ORDER_TIMELINE_STEPS: { key: OrderStatus; label: string }[] = [
  { key: "pending_payment", label: "Pending payment" },
  { key: "confirmed", label: "Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

/** Bangladesh divisions, with districts. No PIN code is used anywhere. */
export const DIVISIONS: string[] = [
  "Dhaka",
  "Chattogram",
  "Khulna",
  "Rajshahi",
  "Barishal",
  "Sylhet",
  "Rangpur",
  "Mymensingh",
];

export const DISTRICTS: Record<string, string[]> = {
  Dhaka: ["Dhaka", "Gazipur", "Narayanganj", "Tangail", "Faridpur", "Manikganj", "Munshiganj", "Kishoreganj", "Narsingdi", "Gopalganj"],
  Chattogram: ["Chattogram", "Cox's Bazar", "Cumilla", "Brahmanbaria", "Chandpur", "Noakhali", "Feni", "Lakshmipur", "Rangamati", "Bandarban", "Khagrachhari"],
  Khulna: ["Khulna", "Jashore", "Satkhira", "Bagerhat", "Chuadanga", "Kushtia", "Magura", "Meherpur", "Narail", "Jhenaidah"],
  Rajshahi: ["Rajshahi", "Bogura", "Pabna", "Sirajganj", "Natore", "Naogaon", "Chapainawabganj", "Joypurhat"],
  Barishal: ["Barishal", "Bhola", "Patuakhali", "Pirojpur", "Barguna", "Jhalokati"],
  Sylhet: ["Sylhet", "Moulvibazar", "Habiganj", "Sunamganj"],
  Rangpur: ["Rangpur", "Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Thakurgaon"],
  Mymensingh: ["Mymensingh", "Jamalpur", "Netrokona", "Sherpur"],
};

// ---------------------------------------------------------------------------
// Low-level JSON helpers (window-guarded so server rendering never touches
// localStorage).
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / unavailable: state stays in memory for this session.
  }
}

// ---------------------------------------------------------------------------
// Cart — the live cart is owned by lib/cart-store (CartProvider + useCart,
// localStorage key "techshot-cart-v1"). This module deliberately has NO
// cart functions of its own, so there is exactly one source of truth for
// cart state. Pages use useCart() and resolve display data from the
// catalog with lib/orders resolveCartLines().
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Save for later
// ---------------------------------------------------------------------------

export function getSavedForLater(): SavedItem[] {
  return readJSON<SavedItem[]>(STORAGE_KEYS.savedForLater, []);
}

export function saveForLater(item: SavedItem): void {
  const saved = getSavedForLater();
  if (!saved.some((s) => s.slug === item.slug && (s.variant ?? "") === (item.variant ?? ""))) {
    saved.push(item);
    writeJSON(STORAGE_KEYS.savedForLater, saved);
  }
}

export function removeSaved(slug: string, variant?: string): void {
  writeJSON(
    STORAGE_KEYS.savedForLater,
    getSavedForLater().filter(
      (s) => !(s.slug === slug && (s.variant ?? "") === (variant ?? "")),
    ),
  );
}

// ---------------------------------------------------------------------------
// Coupon code (the discount itself is always re-validated server-side;
// only the code string is stored here).
// ---------------------------------------------------------------------------

export function getCouponCode(): string | null {
  return readJSON<string | null>(STORAGE_KEYS.coupon, null);
}

export function setCouponCode(code: string | null): void {
  if (code) writeJSON(STORAGE_KEYS.coupon, code);
  else if (isBrowser()) window.localStorage.removeItem(STORAGE_KEYS.coupon);
}

export function clearCouponCode(): void {
  if (isBrowser()) window.localStorage.removeItem(STORAGE_KEYS.coupon);
}

import { z } from "zod";

// ---------------------------------------------------------------------------
// Orders (browser copy of the orders created at checkout)
//
// A crafted localStorage entry must never render as a fake order:
// stored orders are validated against this schema when read, and
// entries that fail validation are dropped (and the stored list is
// repaired) before anything renders. Live Supabase orders are
// unaffected — mergeOrders() lets the live copy win over the browser
// copy, and listSupabaseOrders() never goes through this schema.
// ---------------------------------------------------------------------------

const orderItemSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  variant: z.string().optional(),
  price_poisha: z.number().int().nonnegative(),
  mrp_poisha: z.number().int().nonnegative(),
  image: z.string().optional(),
  quantity: z.number().int().positive(),
});

const addressSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  mobile: z.string(),
  address: z.string(),
  area: z.string(),
  division: z.string(),
  district: z.string(),
  city: z.string(),
  isDefault: z.boolean(),
});

/** A stored order as written by saveOrder(); anything else is not an order. */
export const storedOrderSchema = z.object({
  id: z.string().min(1),
  orderNumber: z.string().min(1),
  items: z.array(orderItemSchema),
  address: addressSchema,
  delivery: z.enum(["standard", "express"]),
  paymentMethod: z.enum(["card", "bkash", "nagad", "cod", "emi"]),
  subtotal_poisha: z.number().int().nonnegative(),
  savings_poisha: z.number().int().nonnegative(),
  couponCode: z.string().nullable(),
  couponDiscount_poisha: z.number().int().nonnegative(),
  deliveryFee_poisha: z.number().int().nonnegative(),
  total_poisha: z.number().int().nonnegative(),
  status: z.enum([
    "pending_payment",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
    "returned",
  ]),
  paymentStatus: z.enum(["unpaid", "paid", "failed", "cancelled", "refunded"]),
  cancelNotice: z.enum(["live", "local"]).optional(),
  testMode: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/**
 * Validate an unknown value as a list of stored orders. Entries that
 * fail validation are dropped; the caller (listOrders) repairs the
 * stored list so a bad entry cannot reappear on the next read.
 */
export function validateStoredOrders(value: unknown): StoredOrder[] {
  if (!Array.isArray(value)) return [];
  const valid: StoredOrder[] = [];
  for (const entry of value) {
    const parsed = storedOrderSchema.safeParse(entry);
    if (parsed.success) valid.push(parsed.data as StoredOrder);
  }
  return valid;
}

export function saveOrder(order: StoredOrder): void {
  const orders = listOrders();
  const index = orders.findIndex((o) => o.id === order.id);
  if (index >= 0) orders[index] = order;
  else orders.unshift(order);
  writeJSON(STORAGE_KEYS.orders, orders);
}

export function getOrder(id: string): StoredOrder | null {
  return listOrders().find((o) => o.id === id) ?? null;
}

export function listOrders(): StoredOrder[] {
  const raw = readJSON<unknown>(STORAGE_KEYS.orders, []);
  const orders = validateStoredOrders(raw);
  // Repair: a crafted or corrupted entry is dropped from storage too,
  // so it cannot reappear on the next read.
  if (Array.isArray(raw) && orders.length !== raw.length && isBrowser()) {
    writeJSON(STORAGE_KEYS.orders, orders);
  }
  return [...orders].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
}

export function updateOrderStatus(
  id: string,
  patch: Partial<Pick<StoredOrder, "status" | "paymentStatus" | "cancelNotice">>,
): StoredOrder | null {
  const order = getOrder(id);
  if (!order) return null;
  const updated: StoredOrder = { ...order, ...patch, updatedAt: new Date().toISOString() };
  saveOrder(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function getProfile(): Profile {
  return readJSON<Profile>(STORAGE_KEYS.profile, { displayName: "", phone: "", email: "" });
}

export function saveProfile(profile: Profile): void {
  writeJSON(STORAGE_KEYS.profile, profile);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export function getAddresses(): Address[] {
  return readJSON<Address[]>(STORAGE_KEYS.addresses, []);
}

export function saveAddresses(addresses: Address[]): void {
  writeJSON(STORAGE_KEYS.addresses, addresses);
}

export function getDefaultAddress(): Address | null {
  const addresses = getAddresses();
  return addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
}

export function addAddress(address: Omit<Address, "id">): Address {
  const addresses = getAddresses();
  const created: Address = {
    ...address,
    id: `addr_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    isDefault: addresses.length === 0 ? true : address.isDefault,
  };
  const next = created.isDefault
    ? [...addresses.map((a) => ({ ...a, isDefault: false })), created]
    : [...addresses, created];
  saveAddresses(next);
  return created;
}

export function updateAddress(id: string, patch: Partial<Address>): void {
  let addresses = getAddresses().map((a) => (a.id === id ? { ...a, ...patch } : a));
  if (patch.isDefault) {
    addresses = addresses.map((a) => ({ ...a, isDefault: a.id === id }));
  }
  saveAddresses(addresses);
}

export function deleteAddress(id: string): void {
  const addresses = getAddresses().filter((a) => a.id !== id);
  if (addresses.length > 0 && !addresses.some((a) => a.isDefault)) {
    addresses[0].isDefault = true;
  }
  saveAddresses(addresses);
}

// ---------------------------------------------------------------------------
// Wishlist (client-side only; there is intentionally no /api/wishlist route)
// ---------------------------------------------------------------------------

export function getWishlist(): WishlistItem[] {
  return readJSON<WishlistItem[]>(STORAGE_KEYS.wishlist, []);
}

export function addToWishlist(item: WishlistItem): void {
  const list = getWishlist();
  if (!list.some((w) => w.productId === item.productId)) {
    list.push(item);
    writeJSON(STORAGE_KEYS.wishlist, list);
  }
}

export function removeFromWishlist(productId: string): void {
  writeJSON(
    STORAGE_KEYS.wishlist,
    getWishlist().filter((w) => w.productId !== productId),
  );
}
