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
// They are NOT yet persisted to Supabase. The server-side in-memory order
// record created at checkout lives in lib/orders.ts and is a separate,
// per-server-instance store; the two are reconciled by order id (checkout
// saves the same order object to both). Production must replace both with
// Supabase orders / cart_items / addresses tables.

export type DeliveryOption = "standard" | "express";
export type PaymentMethod = "card" | "bkash" | "nagad" | "cod" | "emi";
export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";
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

// ---------------------------------------------------------------------------
// Orders (browser copy of the orders created at checkout)
// ---------------------------------------------------------------------------

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
  const orders = readJSON<StoredOrder[]>(STORAGE_KEYS.orders, []);
  return [...orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function updateOrderStatus(
  id: string,
  patch: Partial<Pick<StoredOrder, "status" | "paymentStatus">>,
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
