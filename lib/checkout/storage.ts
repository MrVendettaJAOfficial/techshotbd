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
//
// LocalStorage persistence for the checkout store (see
// lib/checkout-store.ts barrel). One job: window-guarded JSON
// read/write plus the saved-for-later, coupon, orders, profile,
// addresses and wishlist helpers built on it.

import { STORAGE_KEYS, type Address, type Profile, type SavedItem, type StoredOrder, type WishlistItem } from "./types";
import { validateStoredOrders } from "./validation";

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
