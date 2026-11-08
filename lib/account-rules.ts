// Account dashboard rules — TechShot.
//
// Pure module, no imports: the exact rules the server actions in
// lib/account-server.ts run and the account page renders, so
// tests/account.test.mjs can import this file directly (Node strips
// the erasable types, as with lib/profile-rules.ts).
//
// Background (bug fixed 2026-11-08): after sign-in the user saw no
// success message and /account showed only browser-local data — no
// name / email / role from Supabase, no Supabase orders, and no
// sign-out button — because the page read lib/checkout-store
// (localStorage) and never asked Supabase for the signed-in user's
// profile, addresses, orders or wishlist. The page now reads those
// from Supabase when configured (lib/account-server.ts) and keeps
// the localStorage data only as the fallback when Supabase is not
// configured.
//
// Shape note: the Supabase `addresses` table stores one `name` and
// one `full_address` (see supabase/migrations/0001_initial_schema.sql),
// while the browser Address shape splits first/last name and keeps
// street address and area separate. The mapping below round-trips
// them: saving joins "First Last" and "street, area"; loading splits
// the name on the first space and the full address on its LAST comma,
// so a street address that itself contains commas survives.

export interface DbAddressRow {
  id: string;
  name: string;
  phone: string;
  division: string;
  district: string;
  city: string;
  full_address: string;
  is_default: boolean;
}

export interface LocalAddress {
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

export interface DbWishlistRow {
  product_id: string;
  products:
    | { title: string; slug: string; price_poisha: number; compare_at_poisha: number | null }
    | null;
}

export interface LocalWishlistItem {
  productId: string;
  title: string;
  price_poisha: number;
  mrp_poisha: number;
}

export interface LocalOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  total_poisha: number;
  createdAt: string;
}

/** Bangladeshi mobile: 01XXXXXXXXX, with or without the +880 prefix. */
export function isValidBangladeshiMobile(mobile: string): boolean {
  return /^(\+880|0)?1[3-9]\d{8}$/.test(mobile.trim());
}

/** "Md Joynal Abedin" -> { firstName: "Md", lastName: "Joynal Abedin" }. */
export function splitDbName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/**
 * Split a stored full address ("House 1, Road 2, Dhanmondi") on its
 * LAST comma: everything before it is the street address, the last
 * segment is the area. A full address with no comma is all street
 * address with an empty area.
 */
export function splitFullAddress(fullAddress: string): { address: string; area: string } {
  const idx = fullAddress.lastIndexOf(",");
  if (idx < 0) return { address: fullAddress.trim(), area: "" };
  return {
    address: fullAddress.slice(0, idx).trim(),
    area: fullAddress.slice(idx + 1).trim(),
  };
}

/** Supabase addresses row -> the browser Address shape. Email is not
 *  stored on the addresses table, so it comes back empty and the
 *  account page fills it from the signed-in user's email instead. */
export function mapDbAddressToLocal(row: DbAddressRow): LocalAddress {
  const { firstName, lastName } = splitDbName(row.name ?? "");
  const { address, area } = splitFullAddress(row.full_address ?? "");
  return {
    id: row.id,
    firstName,
    lastName,
    email: "",
    mobile: row.phone ?? "",
    address,
    area,
    division: row.division ?? "",
    district: row.district ?? "",
    city: row.city ?? "",
    isDefault: row.is_default === true,
  };
}

/** Browser address form -> the Supabase addresses row (without id). */
export function mapLocalAddressToDb(input: {
  firstName: string;
  lastName: string;
  mobile: string;
  address: string;
  area: string;
  division: string;
  district: string;
  city: string;
  isDefault: boolean;
}): {
  name: string;
  phone: string;
  division: string;
  district: string;
  city: string;
  full_address: string;
  is_default: boolean;
} {
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  const full_address = input.area.trim()
    ? `${input.address.trim()}, ${input.area.trim()}`
    : input.address.trim();
  return {
    name,
    phone: input.mobile.trim(),
    division: input.division,
    district: input.district,
    city: input.city,
    full_address,
    is_default: input.isDefault,
  };
}

/** Supabase wishlists row (with its products embed) -> browser item.
 *  Returns null when the product is gone (deleted product), so the
 *  caller drops the row instead of rendering a broken entry. */
export function mapDbWishlistRowToLocal(row: DbWishlistRow): LocalWishlistItem | null {
  const product = row.products;
  if (!product || !product.slug || !product.title) return null;
  return {
    productId: product.slug,
    title: product.title,
    price_poisha: product.price_poisha ?? 0,
    mrp_poisha: product.compare_at_poisha ?? product.price_poisha ?? 0,
  };
}

/**
 * Merge the browser's local orders with the Supabase orders for the
 * signed-in user: same order id in both places is one order, and the
 * Supabase copy wins (it is the source of truth once configured).
 * Newest first. The local copy is the fallback when Supabase is not
 * configured, so it is never dropped — only de-duplicated.
 */
export function mergeOrders<T extends LocalOrderSummary>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const order of local) byId.set(order.id, order);
  for (const order of remote) byId.set(order.id, order);
  // Newest first, compared as numbers: ISO strings sort correctly
  // only when every value uses the same format, and equal timestamps
  // must compare 0 (the old comparator returned -1 for equals, which
  // is not a valid sort order). Unparseable dates sort as epoch.
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
}

/** Validate the account address form. Returns field errors, empty
 *  when the form is valid. Mirrors the client-side checks so a
 *  server action can never be tricked into storing a bad address. */
export function validateAddressInput(input: {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  address: string;
  area: string;
  division: string;
  district: string;
  city: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.firstName.trim()) errors.firstName = "First name is required.";
  if (!input.lastName.trim()) errors.lastName = "Last name is required.";
  if (!input.email.trim() || !/^\S+@\S+\.\S+$/.test(input.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!isValidBangladeshiMobile(input.mobile)) {
    errors.mobile = "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX.";
  }
  if (!input.address.trim()) errors.address = "Street address is required.";
  if (!input.area.trim()) errors.area = "Area / locality is required.";
  if (!input.division) errors.division = "Division is required.";
  if (!input.district) errors.district = "District is required.";
  if (!input.city.trim()) errors.city = "City is required.";
  return errors;
}
