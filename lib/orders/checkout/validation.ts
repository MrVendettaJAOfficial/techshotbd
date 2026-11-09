// Checkout validation + cart-line resolution (lib/orders.ts).
// One job: turn client cart lines into priced order lines from
// the catalogue, check stock, and validate the checkout address
// (the same zod rules the server action and the client form share).

import { z } from "zod";
import { getProductForCartSlug } from "@/lib/data/catalog";
import { variantMatchesOption } from "@/lib/catalog-rules";
import type {
  Address,
  DeliveryOption,
  OrderItem,
  PaymentMethod,
  StoredOrder,
} from "@/lib/checkout-store";

/** One line as the client cart holds it (lib/cart-store CartItem shape). */
export interface CheckoutCartItem {
  slug: string;
  variant?: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Catalog price resolution.
//
// resolveCartLines() turns client cart lines ({slug, variant, quantity})
// into priced order lines. A cart slug is resolved with
// getProductForCartSlug(): the live storefront sells products under
// their Supabase slugs, which are longer than the local seed slugs for
// some products (live `apple-iphone-16-pro-256gb-natural-titanium` vs
// seed `apple-iphone-16-pro`), so an exact match is tried first and then
// the local slug that is a `<slug>-…` prefix of the cart slug. Without
// that step a live product's line was reported as "no longer available"
// and priced at ৳0, which made the cart unusable whenever Supabase was
// configured — the line was in the cart, the badge counted it, but the
// cart page showed it as unavailable and checkout refused it.
//
// The returned line keeps the ORIGINAL cart slug as productId (the live
// slug when Supabase is configured, the seed slug otherwise), so the
// cart page can match lines back to cart items and the server-side
// checkout can re-resolve the same slug against the live database.
// Prices come from the seed product; a variant that matches a storage
// option (compared space- and case-insensitively, so "256GB Natural
// Titanium" matches the "256 GB" option) applies that option's price
// delta and stock. Lines whose slug matches no product at all are
// reported in unknownSlugs and dropped — they must never be charged.
// A product that exists only in the live database (added in the admin,
// no seed counterpart) is NOT resolved here: it is priced from the live
// database by getPricedCartLines in lib/cart-server.ts, which the cart
// page, checkout form and checkout action use when Supabase is
// configured.
// ---------------------------------------------------------------------------

export function resolveCartLines(items: CheckoutCartItem[]): {
  lines: OrderItem[];
  unknownSlugs: string[];
} {
  const lines: OrderItem[] = [];
  const unknownSlugs: string[] = [];
  for (const item of items) {
    const product = getProductForCartSlug(item.slug);
    if (!product) {
      unknownSlugs.push(item.slug);
      continue;
    }
    const option = product.storageOptions?.find(
      (o) => variantMatchesOption(item.variant, o.label),
    );
    const delta = option?.priceDeltaPoisha ?? 0;
    lines.push({
      productId: item.slug,
      title: product.title,
      variant: item.variant ?? product.variant,
      price_poisha: product.price_poisha + delta,
      mrp_poisha: product.compare_at_poisha + delta,
      image: product.image,
      quantity: Math.max(1, item.quantity),
    });
  }
  return { lines, unknownSlugs };
}

function stockFor(item: OrderItem): number | null {
  const product = getProductForCartSlug(item.productId);
  if (!product) return null;
  const option = product.storageOptions?.find(
    (o) => variantMatchesOption(item.variant, o.label),
  );
  return option?.stock ?? product.stock;
}

// ---------------------------------------------------------------------------
// Totals. computeTotals is the synchronous pricing wrapper used for
// display: lib/pricing computeTotals does subtotal / discount / delivery
// / total, and savings against compare-at prices are computed here from
// the resolved lines. computeCheckoutTotals is the async server-side
// recompute used at checkout: it re-prices every line from the catalog
// via resolveCartLines() — never from a total submitted by the browser.
// ---------------------------------------------------------------------------

export function validateStock(
  items: OrderItem[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const item of items) {
    const stock = stockFor(item);
    if (stock !== null && item.quantity > stock) {
      errors.push(
        `${item.title}: only ${stock} in stock, you asked for ${item.quantity}.`,
      );
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Checkout address validation (shared by the server action and the client
// form so both enforce exactly the same rules).
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.string().trim().email("Enter a valid email address."),
  mobile: z
    .string()
    .trim()
    .regex(/^(\+880|0)?1[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX."),
  address: z.string().trim().min(1, "Street address is required."),
  area: z.string().trim().min(1, "Area / locality is required."),
  division: z.string().trim().min(1, "Division is required."),
  district: z.string().trim().min(1, "District is required."),
  city: z.string().trim().min(1, "City is required."),
  billingSame: z.boolean(),
});

export type AddressInput = z.infer<typeof addressSchema>;

export interface PlaceOrderInput {
  items: CheckoutCartItem[];
  couponCode: string | null;
  delivery: DeliveryOption;
  paymentMethod: PaymentMethod;
  address: AddressInput;
}

export type PlaceOrderResult =
  | { ok: true; order: StoredOrder; redirectTo: string }
  | { ok: false; errors: Record<string, string>; message: string };

export function toAddressSnapshot(input: AddressInput, id: string): Address {
  return {
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    mobile: input.mobile,
    address: input.address,
    area: input.area,
    division: input.division,
    district: input.district,
    city: input.city,
    isDefault: false,
  };
}
