"use client";

// Client-side cart store (React context + localStorage).
// This is the working cart until the Supabase cart is wired. Checkout
// recomputes totals server-side from catalog/DB prices, never from this
// store, so a tampered local cart cannot change what a customer is charged.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getProduct } from "./data/catalog";

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

  useEffect(() => {
    setItems(loadFromStorage());
    setHydrated(true);
  }, []);

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

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, it) => sum + it.quantity, 0);
    const subtotalPoisha = items.reduce((sum, it) => {
      const product = getProduct(it.slug);
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
