// Account wishlist section (client component).
//
// The saved wishlist, with "Move to cart" and "Remove" per item.
// Removing goes through lib/account-server.ts when the Supabase
// data is live, and falls back to the browser-local wishlist
// otherwise — the caller (app/account/page.tsx) owns that choice
// and passes its handlers in.
//
// Split from app/account/page.tsx: the wishlist UI lives here, the
// page keeps the wishlist state and the move / remove handlers.

"use client";

import { formatBDT } from "@/lib/theme";
import type { WishlistItem } from "@/lib/checkout-store";
import { btnGhost } from "./account-ui";

interface WishlistSectionProps {
  wishlist: WishlistItem[];
  notice: string | null;
  onMoveToCart: (item: WishlistItem) => void;
  onRemove: (productId: string) => void;
}

export default function WishlistSection({
  wishlist,
  notice,
  onMoveToCart,
  onRemove,
}: WishlistSectionProps) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Wishlist">
      <h2 className="text-lg font-bold text-text">Wishlist</h2>
      {notice && <p role="status" className="mt-3 text-sm text-success">{notice}</p>}
      {wishlist.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Your wishlist is empty. Items you save will appear here.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {wishlist.map((item) => (
            <li key={item.productId} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-panel font-bold text-brand">
                {item.title.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text">{item.title}</span>
                <span className="text-sm text-muted">{formatBDT(item.price_poisha)}</span>
              </span>
              <button type="button" className={btnGhost} onClick={() => onMoveToCart(item)}>
                Move to cart
              </button>
              <button
                type="button"
                className="text-sm text-muted hover:text-text"
                onClick={() => onRemove(item.productId)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
