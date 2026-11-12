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
// Owner scoping (audit #9, 2026-11-12): browser-local data belongs to
// the account that created it. Every stored order carries the
// buyer's userId (StoredOrder.userId, null for guests — see
// lib/checkout/types.ts), and profile / addresses / wishlist records
// carry the same optional userId. The read helpers below accept the
// current user id and return only that account's records: pass the
// signed-in user's id, or null for a guest. A caller that passes NO
// id gets the legacy unfiltered list — that is for the callers that
// cannot know the viewer (the admin list on an unconfigured install,
// the order detail page's fallback, the inbox), whose behaviour is
// unchanged by this fix; pages that DO know the viewer (/orders,
// /account) must pass the id, and signOut clears these keys so the
// next account on a shared browser starts clean (see lib/auth.ts).
// Writes always go through the unfiltered internal read, so saving
// one account's record never drops another account's records from
// storage — filtering happens on read, never on write.
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
  // Write-back reads the FULL stored list, never the filtered one:
  // saving one account's order must not drop another account's
  // orders from storage. Filtering happens on read (listOrders /
  // getOrder), never here.
  const orders = readStoredOrders();
  const index = orders.findIndex((o) => o.id === order.id);
  if (index >= 0) orders[index] = order;
  else orders.unshift(order);
  writeJSON(STORAGE_KEYS.orders, orders);
}

/**
 * One stored order, for the current viewer only. `currentUserId`
 * is the signed-in user's id, or null for a guest; when it is not
 * passed at all the legacy unfiltered lookup runs (see the header
 * note — only callers that cannot know the viewer do that).
 */
export function getOrder(id: string, currentUserId?: string | null): StoredOrder | null {
  return listOrders(currentUserId).find((o) => o.id === id) ?? null;
}

/**
 * The stored orders for the current viewer, newest first.
 * `currentUserId` is the signed-in user's id, or null for a guest
 * (guest orders carry userId null); when it is not passed at all
 * the legacy unfiltered list is returned. A signed-in viewer's list
 * never contains another account's orders, or guest orders placed
 * on this browser by someone else.
 */
export function listOrders(currentUserId?: string | null): StoredOrder[] {
  return sortOrdersNewestFirst(filterByOwner(readStoredOrders(), currentUserId));
}

/** The stored orders with no viewer filter — the write path and
 *  the legacy unfiltered reads. Callers that know the viewer must
 *  use listOrders(currentUserId) instead. */
function readStoredOrders(): StoredOrder[] {
  const raw = readJSON<unknown>(STORAGE_KEYS.orders, []);
  const orders = validateStoredOrders(raw);
  // Repair: a crafted or corrupted entry is dropped from storage too,
  // so it cannot reappear on the next read.
  if (Array.isArray(raw) && orders.length !== raw.length && isBrowser()) {
    writeJSON(STORAGE_KEYS.orders, orders);
  }
  return orders;
}

/** Keep only the records owned by `currentUserId` (null = guest).
 *  `undefined` means the caller does not know the viewer: no
 *  filtering (legacy behaviour — see the header note). A record
 *  saved before owner tagging carries no userId and reads back as
 *  a guest record. */
function filterByOwner<T extends { userId?: string | null }>(
  records: T[],
  currentUserId?: string | null,
): T[] {
  if (currentUserId === undefined) return records;
  return records.filter((r) => (r.userId ?? null) === currentUserId);
}

function sortOrdersNewestFirst(orders: StoredOrder[]): StoredOrder[] {
  return [...orders].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
}

export function updateOrderStatus(
  id: string,
  patch: Partial<Pick<StoredOrder, "status" | "paymentStatus" | "cancelNotice">>,
  currentUserId?: string | null,
): StoredOrder | null {
  // The write path reads the full list (see saveOrder). When the
  // caller knows the viewer it may also pass that viewer's id: the
  // update then applies only to an order that viewer owns, so a
  // status write can never move another account's order.
  const order = readStoredOrders().find((o) => o.id === id) ?? null;
  if (!order) return null;
  if (currentUserId !== undefined && (order.userId ?? null) !== currentUserId) return null;
  const updated: StoredOrder = { ...order, ...patch, updatedAt: new Date().toISOString() };
  saveOrder(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * The stored profile for the current viewer, or the empty profile
 * when the stored one belongs to another account. `currentUserId`
 * is the signed-in user's id, or null for a guest; not passing it
 * returns the stored profile as before (legacy callers only).
 */
export function getProfile(currentUserId?: string | null): Profile {
  const empty: Profile = { displayName: "", phone: "", email: "" };
  const stored = readJSON<Profile>(STORAGE_KEYS.profile, empty);
  if (currentUserId === undefined) return stored;
  if ((stored.userId ?? null) !== currentUserId) return empty;
  return stored;
}

/** Store the profile, stamped with its owner's id (null = guest). */
export function saveProfile(profile: Profile, currentUserId?: string | null): void {
  writeJSON<Profile>(STORAGE_KEYS.profile, {
    ...profile,
    userId: currentUserId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * The stored addresses for the current viewer. `currentUserId` is
 * the signed-in user's id, or null for a guest; not passing it
 * returns every stored address (legacy callers only).
 */
export function getAddresses(currentUserId?: string | null): Address[] {
  return filterByOwner(readJSON<Address[]>(STORAGE_KEYS.addresses, []), currentUserId);
}

export function saveAddresses(addresses: Address[]): void {
  // Full-list write (see saveOrder): callers pass the whole list,
  // and filtering happens on read. Kept unfiltered on purpose.
  writeJSON(STORAGE_KEYS.addresses, addresses);
}

/** The viewer's default address (first address when none is
 *  marked default), or null when they have none. Pass the
 *  viewer's id (null = guest) to scope it; no id returns the
 *  legacy unfiltered default. */
export function getDefaultAddress(currentUserId?: string | null): Address | null {
  const addresses = getAddresses(currentUserId);
  return addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
}

export function addAddress(address: Omit<Address, "id">, currentUserId?: string | null): Address {
  // The default rule ("first address is the default", and a new
  // default demotes the old one) runs inside the caller's own
  // addresses only — another account's default must never be
  // demoted by this account adding an address. The write-back
  // still carries the full stored list (see saveOrder).
  const own = getAddresses(currentUserId);
  const all = getAddresses();
  const owner = currentUserId ?? null;
  const created: Address = {
    ...address,
    id: `addr_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    userId: owner,
    isDefault: own.length === 0 ? true : address.isDefault,
  };
  const next = created.isDefault
    ? [...all.map((a) => ((a.userId ?? null) === owner ? { ...a, isDefault: false } : a)), created]
    : [...all, created];
  saveAddresses(next);
  return created;
}

export function updateAddress(id: string, patch: Partial<Address>): void {
  // Operates on the stored list by id, like before: callers only
  // ever pass ids from their own filtered view (getAddresses with
  // their id), so another account's address is never in reach. The
  // spread keeps the address's existing owner stamp, and a new
  // default demotes only the same owner's addresses.
  const all = getAddresses();
  const target = all.find((a) => a.id === id);
  let addresses = all.map((a) => (a.id === id ? { ...a, ...patch } : a));
  if (patch.isDefault && target) {
    const owner = target.userId ?? null;
    addresses = addresses.map((a) =>
      (a.userId ?? null) === owner ? { ...a, isDefault: a.id === id } : a,
    );
  }
  saveAddresses(addresses);
}

export function deleteAddress(id: string): void {
  // Same scoping note as updateAddress: the id comes from the
  // caller's filtered view. When the deleted address was the
  // owner's default, the owner's next address (not another
  // account's) is promoted to default. An unknown id changes
  // nothing.
  const all = getAddresses();
  const target = all.find((a) => a.id === id);
  if (!target) return;
  const addresses = all.filter((a) => a.id !== id);
  const owner = target.userId ?? null;
  const own = addresses.filter((a) => (a.userId ?? null) === owner);
  if (own.length > 0 && !own.some((a) => a.isDefault)) {
    own[0].isDefault = true;
  }
  saveAddresses(addresses);
}

// ---------------------------------------------------------------------------
// Wishlist (client-side only; there is intentionally no /api/wishlist route)
// ---------------------------------------------------------------------------

/**
 * The stored wishlist for the current viewer. `currentUserId` is
 * the signed-in user's id, or null for a guest; not passing it
 * returns every stored entry (legacy callers only).
 */
export function getWishlist(currentUserId?: string | null): WishlistItem[] {
  return filterByOwner(readJSON<WishlistItem[]>(STORAGE_KEYS.wishlist, []), currentUserId);
}

/** Save a wishlist entry, stamped with its owner's id (null = guest).
 *  The "already wishlisted" check runs inside the caller's own
 *  entries only: another account having the same product must not
 *  stop this account adding it. The write-back still carries the
 *  full stored list (see saveOrder). */
export function addToWishlist(item: WishlistItem, currentUserId?: string | null): void {
  const own = getWishlist(currentUserId);
  if (own.some((w) => w.productId === item.productId)) return;
  const list = getWishlist();
  list.push({ ...item, userId: currentUserId ?? null });
  writeJSON(STORAGE_KEYS.wishlist, list);
}

/**
 * Remove a wishlist entry by product. When the caller knows the
 * viewer, pass their id and only their own entry is removed —
 * another account's entry for the same product stays. Without an
 * id the legacy behaviour runs (every matching entry is removed).
 */
export function removeFromWishlist(productId: string, currentUserId?: string | null): void {
  writeJSON(
    STORAGE_KEYS.wishlist,
    getWishlist().filter(
      (w) =>
        w.productId !== productId ||
        (currentUserId !== undefined && (w.userId ?? null) !== currentUserId),
    ),
  );
}
