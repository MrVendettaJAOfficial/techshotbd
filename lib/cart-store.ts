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

function itemKey(item: CartItem): string {
  return `${item.slug}::${item.variant ?? ""}`;
}

function loadFromStorage(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is CartItem =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as CartItem).slug === "string" &&
        typeof (it as CartItem).quantity === "number" &&
        (it as CartItem).quantity > 0,
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Signed-in Supabase user id (null = guest / unconfigured). Tracked
  // directly from the browser client's auth state, because this
  // provider sits above AuthProvider in the tree (see app/layout.tsx).
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  const [serverCartReady, setServerCartReady] = useState(false);
  const serverCartUserRef = useRef<string | null>(null);
  const lastSyncedRef = useRef<CartItem[]>([]);
  const itemsRef = useRef<CartItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    setItems(loadFromStorage());
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
  // sign-out the local cart is kept as-is.
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
          setItems(serverItems);
          lastSyncedRef.current = serverItems;
        } else {
          // Upload the guest cart so it survives on other devices.
          const local = itemsRef.current;
          lastSyncedRef.current = local;
          void Promise.allSettled(
            local.map((it) => syncCartItem(it.slug, it.variant, it.quantity)),
          );
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
  useEffect(() => {
    if (!hydrated || !serverUserId || !serverCartReady) return;
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
  }, [items, hydrated, serverUserId, serverCartReady]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full or unavailable — cart still works in memory.
    }
  }, [items, hydrated]);

  const add = useCallback((slug: string, variant?: string, quantity = 1) => {
    setItems((prev) => {
      const key = `${slug}::${variant ?? ""}`;
      const existing = prev.find((it) => itemKey(it) === key);
      if (existing) {
        return prev.map((it) =>
          itemKey(it) === key
            ? { ...it, quantity: it.quantity + quantity }
            : it,
        );
      }
      return [...prev, { slug, variant, quantity }];
    });
  }, []);

  const remove = useCallback((slug: string, variant?: string) => {
    const key = `${slug}::${variant ?? ""}`;
    setItems((prev) => prev.filter((it) => itemKey(it) !== key));
  }, []);

  const setQuantity = useCallback(
    (slug: string, variant: string | undefined, quantity: number) => {
      const key = `${slug}::${variant ?? ""}`;
      if (quantity <= 0) {
        setItems((prev) => prev.filter((it) => itemKey(it) !== key));
        return;
      }
      setItems((prev) =>
        prev.map((it) =>
          itemKey(it) === key ? { ...it, quantity } : it,
        ),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setItems([]);
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
