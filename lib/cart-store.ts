"use client";

// Client-side cart store (React context + localStorage).
// This is the working cart until the Supabase cart is wired. Checkout
// recomputes totals server-side from catalog/DB prices, never from this
// store, so a tampered local cart cannot change what a customer is charged.
//
// SUPABASE SYNC: when a user is signed in and Supabase is configured,
// the cart is also kept in the `carts` / `cart_items` tables
// (lib/cart-server.ts). On sign-in the server cart is loaded — if it
// has lines it replaces the local cart, otherwise the local (guest)
// cart is uploaded. Quantity changes are then persisted line by line.
// When signed out or unconfigured, behaviour is exactly the
// localStorage cart above: nothing is lost and nothing is blocked.
//
// OWNER SCOPING (audit #9, 2026-11-12): the browser cart used to be
// one unowned list, so the next account on a shared browser saw the
// previous account's cart. The stored cart is now tagged with its
// owner's user id ({ userId, items } under the same key,
// "techshot-cart-v1"; a bare array left over from before reads back
// as the guest cart) and the provider only RENDERS the lines whose
// owner matches the current viewer — another account's lines render
// as an empty cart. The cart is deliberately NOT deleted on sign-out:
// a guest cart survives sign-out, and when the same account signs
// back in the server cart restores the lines (or, unconfigured, the
// tagged local copy is still there). The server cart is the source
// of truth for signed-in users, so a stored copy overwritten by
// another account's shopping is restored from the server on the
// next sign-in. Mutations always start from the VISIBLE cart, never
// from another account's lines, and only the guest cart is ever
// uploaded into a newly signed-in account's server cart.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getProductForCartSlug } from "./data/catalog";
import { resolveCartLines } from "./orders";
import { createClient } from "./supabase/client";
import {
  clearServerCart,
  getPricedCartLines,
  getServerCart,
  syncCartItem,
} from "./cart-server";
import type { OrderItem } from "./checkout-store";

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export type CartItem = {
  slug: string;
  variant?: string;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotalPoisha: number;
  add: (slug: string, variant?: string, quantity?: number) => void;
  remove: (slug: string, variant?: string) => void;
  setQuantity: (slug: string, variant: string | undefined, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "techshot-cart-v1";

/** A stored cart: its lines plus the id of the account (or guest)
 *  they belong to. `userId` null means the guest cart. */
export interface StoredCart {
  userId: string | null;
  items: CartItem[];
}

function itemKey(item: CartItem): string {
  return `${item.slug}::${item.variant ?? ""}`;
}

/** Keep only well-formed cart lines from an unknown stored value. */
function validCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (it): it is CartItem =>
      typeof it === "object" &&
      it !== null &&
      typeof (it as CartItem).slug === "string" &&
      typeof (it as CartItem).quantity === "number" &&
      (it as CartItem).quantity > 0,
  );
}

/**
 * Parse the stored cart: the current { userId, items } shape, or a
 * legacy bare array of lines (the guest cart, from before owner
 * tagging). Anything else is an empty guest cart.
 */
function loadFromStorage(): StoredCart {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { userId: null, items: [] };
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return { userId: null, items: validCartItems(parsed) };
    if (typeof parsed === "object" && parsed !== null) {
      const shape = parsed as { userId?: unknown; items?: unknown };
      if (Array.isArray(shape.items)) {
        return {
          userId: typeof shape.userId === "string" ? shape.userId : null,
          items: validCartItems(shape.items),
        };
      }
    }
    return { userId: null, items: [] };
  } catch {
    return { userId: null, items: [] };
  }
}

/**
 * The lines the current viewer may see: only the stored cart whose
 * owner matches the viewer (null = guest) renders; another
 * account's cart renders as empty. The stored cart itself is left
 * untouched here — filtering happens on render, never by deleting.
 */
export function resolveVisibleCart(stored: StoredCart, currentUserId: string | null): CartItem[] {
  if ((stored.userId ?? null) !== currentUserId) return [];
  return stored.items;
}

export function CartProvider({ children }: { children: ReactNode }) {
  // The stored cart: its lines plus the id of the account (or
  // guest) they belong to. `items` below is the VISIBLE slice of
  // it — only the lines owned by the current viewer ever render.
  const [cart, setCart] = useState<StoredCart>({ userId: null, items: [] });
  const [hydrated, setHydrated] = useState(false);
  // Signed-in Supabase user id (null = guest / unconfigured). Tracked
  // directly from the browser client's auth state, because this
  // provider sits above AuthProvider in the tree (see app/layout.tsx).
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  const [serverCartReady, setServerCartReady] = useState(false);
  const serverCartUserRef = useRef<string | null>(null);
  const lastSyncedRef = useRef<CartItem[]>([]);
  const cartRef = useRef<StoredCart>(cart);
  cartRef.current = cart;
  const items = resolveVisibleCart(cart, serverUserId);

  useEffect(() => {
    setCart(loadFromStorage());
    setHydrated(true);
  }, []);

  // Watch the Supabase session independently of AuthProvider.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    let cancelled = false;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setServerUserId(data.session?.user.id ?? null);
      })
      .catch(() => {});
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setServerUserId(session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // On sign-in, load the server cart. A non-empty server cart wins;
  // an empty one means the guest cart is uploaded instead. On
  // sign-out the local cart is kept as-is — filtering on render
  // hides it from the guest view, and it is still there (or restored
  // from the server cart) when the same account signs back in.
  useEffect(() => {
    if (!serverUserId) {
      serverCartUserRef.current = null;
      setServerCartReady(false);
      return;
    }
    if (serverCartUserRef.current === serverUserId) return;
    serverCartUserRef.current = serverUserId;
    let cancelled = false;
    void getServerCart()
      .then((serverItems) => {
        if (cancelled) return;
        if (serverItems && serverItems.length > 0) {
          setCart({ userId: serverUserId, items: serverItems });
          lastSyncedRef.current = serverItems;
        } else {
          // Upload the guest cart so it survives on other devices —
          // only the guest cart (owner null): another account's
          // lines must never be uploaded into this account's
          // server cart. The uploaded lines are now this account's
          // cart, so they are re-tagged with its id.
          const local = cartRef.current.userId === null ? cartRef.current.items : [];
          lastSyncedRef.current = local;
          void Promise.allSettled(
            local.map((it) => syncCartItem(it.slug, it.variant, it.quantity)),
          );
          if (local.length > 0) setCart({ userId: serverUserId, items: local });
        }
        setServerCartReady(true);
      })
      .catch(() => {
        if (!cancelled) setServerCartReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [serverUserId]);

  // Persist local changes to the server cart (signed-in users only).
  // Only the diff against the last synced state is sent; failures are
  // silent — the local cart is the source of truth for the shopper.
  // The guard is the cart's owner: while the in-memory cart still
  // belongs to another account (or a guest) — for example the stale
  // local copy while this account's server cart is still loading —
  // syncing would push their lines into this account's server cart,
  // so nothing syncs until the sign-in effect has replaced the cart.
  useEffect(() => {
    if (!hydrated || !serverUserId || !serverCartReady) return;
    if (cart.userId !== serverUserId) return;
    const items = cart.items;
    const prev = lastSyncedRef.current;
    if (JSON.stringify(prev) === JSON.stringify(items)) return;
    lastSyncedRef.current = items;
    const nextKeys = new Set(items.map(itemKey));
    void Promise.allSettled([
      ...items.map((it) => syncCartItem(it.slug, it.variant, it.quantity)),
      ...prev
        .filter((it) => !nextKeys.has(itemKey(it)))
        .map((it) => syncCartItem(it.slug, it.variant, 0)),
    ]);
  }, [cart, hydrated, serverUserId, serverCartReady]);

  // Persist the tagged cart locally. The owner tag travels with it,
  // so the next render — same account or guest — can filter it.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId: cart.userId, items: cart.items }),
      );
    } catch {
      // Storage full or unavailable — cart still works in memory.
    }
  }, [cart, hydrated]);

  // Every mutation starts from the VISIBLE cart (the lines owned by
  // the current viewer) and re-tags the result with the viewer's id:
  // adding to a cart while another account's lines are stored never
  // appends to theirs — it starts this viewer's own cart.
  const add = useCallback((slug: string, variant?: string, quantity = 1) => {
    setCart((prev) => {
      const base = prev.userId === serverUserId ? prev.items : [];
      const key = `${slug}::${variant ?? ""}`;
      const existing = base.find((it) => itemKey(it) === key);
      const items = existing
        ? base.map((it) =>
            itemKey(it) === key
              ? { ...it, quantity: it.quantity + quantity }
              : it,
          )
        : [...base, { slug, variant, quantity }];
      return { userId: serverUserId, items };
    });
  }, [serverUserId]);

  const remove = useCallback((slug: string, variant?: string) => {
    const key = `${slug}::${variant ?? ""}`;
    setCart((prev) => ({
      userId: serverUserId,
      items: (prev.userId === serverUserId ? prev.items : []).filter(
        (it) => itemKey(it) !== key,
      ),
    }));
  }, [serverUserId]);

  const setQuantity = useCallback(
    (slug: string, variant: string | undefined, quantity: number) => {
      const key = `${slug}::${variant ?? ""}`;
      setCart((prev) => {
        const base = prev.userId === serverUserId ? prev.items : [];
        if (quantity <= 0) {
          return {
            userId: serverUserId,
            items: base.filter((it) => itemKey(it) !== key),
          };
        }
        return {
          userId: serverUserId,
          items: base.map((it) =>
            itemKey(it) === key ? { ...it, quantity } : it,
          ),
        };
      });
    },
    [serverUserId],
  );

  const clear = useCallback(() => {
    setCart({ userId: serverUserId, items: [] });
    if (serverUserId) void clearServerCart().catch(() => {});
  }, [serverUserId]);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, it) => sum + it.quantity, 0);
    const subtotalPoisha = items.reduce((sum, it) => {
      // Prefix-aware: a live slug (apple-iphone-16-pro-256gb-…) prices
      // from its seed product, so the subtotal is right even before the
      // live lines below arrive.
      const product = getProductForCartSlug(it.slug);
      return sum + (product ? product.price_poisha * it.quantity : 0);
    }, 0);
    return { items, count, subtotalPoisha, add, remove, setQuantity, clear };
  }, [items, add, remove, setQuantity, clear]);

  // createElement (not JSX) so this file stays a valid .ts module.
  return createElement(CartContext.Provider, { value }, children);
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

/**
 * Priced cart lines for the cart page and the checkout form.
 *
 * The lines are resolved from the seed catalogue synchronously first
 * (so the page renders immediately, with correct prices for every
 * seeded product — live slugs included, via the prefix rule in
 * lib/orders.ts), and then, when Supabase is configured, re-resolved
 * from the live database by getPricedCartLines (lib/cart-server.ts).
 * The live lines win when they arrive: they carry the live title and
 * price, and they cover products that exist only in the database
 * (added in the admin, no seed counterpart). A failed live lookup
 * keeps the local lines — the cart never breaks on a pricing failure.
 * When Supabase is not configured there is no second step at all: the
 * local lines are the whole answer.
 *
 * Must be called inside CartProvider.
 */
export function usePricedCartLines(): {
  lines: OrderItem[];
  unknownSlugs: string[];
} {
  const { items } = useCart();
  const [live, setLive] = useState<{
    lines: OrderItem[];
    unknownSlugs: string[];
  } | null>(null);
  const local = useMemo(() => resolveCartLines(items), [items]);

  useEffect(() => {
    // A changed cart invalidates the previous live lines; the local
    // lines render meanwhile.
    setLive(null);
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    void getPricedCartLines(items)
      .then((result) => {
        if (!cancelled) {
          setLive({ lines: result.lines, unknownSlugs: result.unknownSlugs });
        }
      })
      .catch(() => {
        // Keep the local lines — see the doc comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [items]);

  return live ?? local;
}
