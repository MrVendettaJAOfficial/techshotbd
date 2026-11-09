// TechShot marketplace — server-side account dashboard data.
//
// SERVER ONLY. This file is a server-actions module ("use server"):
// the account page (a Client Component) calls these actions to read
// the signed-in user's Supabase data. Reads use the per-request
// client, so Row Level Security limits every row to its owner
// (profiles_select_own, addresses_owner_all, wishlists_owner_all,
// orders owner policy) — the service-role client is never used here
// except inside ensureCurrentUserProfile / listSupabaseOrders, which
// already enforce their own checks.
//
// When Supabase is not configured, or nobody is signed in,
// getAccountData returns null and the account page keeps its
// browser-local (localStorage) data — the preview fallback. The
// write actions return { ok: false } instead of throwing in that
// case, and the page falls back to the local stores.
//
// The profile row is self-healing here: if the signed-in user has no
// profiles row yet (signed up before migration 0002 was applied),
// getAccountData creates it from the session metadata first
// (ensureCurrentUserProfile — insert-only, never overwrites, never
// downgrades an admin), so /account never renders empty for a
// signed-in user whose row is missing.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "./supabase/server";
import { ensureCurrentUserProfile } from "./auth-server";
import { listSupabaseOrders } from "./orders-server";
import {
  mapDbAddressToLocal,
  mapDbWishlistRowToLocal,
  mapLocalAddressToDb,
  validateAddressInput,
  isValidBangladeshiMobile,
  type DbAddressRow,
  type DbWishlistRow,
} from "./account-rules";
import type { Address, StoredOrder, WishlistItem } from "./checkout-store";
import type { AppUser } from "./auth";

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/auth-server.ts),
 * so this file talks to the untyped client and casts rows to the
 * local shapes below. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function isValidRole(value: unknown): value is AppUser["role"] {
  // Legacy "seller" rows are treated as customers (single-seller store).
  return value === "customer" || value === "admin";
}

export interface AccountData {
  user: AppUser & { phone: string };
  addresses: Address[];
  orders: StoredOrder[];
  wishlist: WishlistItem[];
}

/**
 * The signed-in user's account data from Supabase: profile (name,
 * email, role, phone), saved addresses, orders and wishlist.
 * Returns null when Supabase is not configured or nobody is signed
 * in — the caller then uses the browser-local fallback. Never throws.
 */
export async function getAccountData(): Promise<AccountData | null> {
  if (!isConfigured()) return null;
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const authUser = data.user;

    // Self-heal a missing profiles row before reading it, so a user
    // who signed up before the trigger existed still gets a
    // dashboard. Insert-only: an existing row (including an admin's)
    // is never touched.
    let { data: profile } = (await supabase
      .from("profiles")
      .select("display_name, phone, role")
      .eq("id", authUser.id)
      .maybeSingle()) as {
      data: { display_name: string | null; phone: string | null; role: unknown } | null;
    };
    if (!profile) {
      await ensureCurrentUserProfile();
      ({ data: profile } = (await supabase
        .from("profiles")
        .select("display_name, phone, role")
        .eq("id", authUser.id)
        .maybeSingle()) as {
        data: { display_name: string | null; phone: string | null; role: unknown } | null;
      });
    }

    const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      profile?.display_name ??
      (typeof metadata["display_name"] === "string" ? (metadata["display_name"] as string) : null) ??
      authUser.email?.split("@")[0] ??
      "TechShot customer";

    // After the profile is known, the addresses, wishlist and orders
    // are independent of each other — fetch them in parallel. They
    // used to run one after another (three serial Supabase round
    // trips, plus a second getUser() inside listSupabaseOrders()),
    // which was a large share of the account page's wait on a real
    // network. The profile self-heal re-select above stays serial:
    // it depends on the insert finishing first.
    const [addressResult, wishlistResult, orders] = await Promise.all([
      supabase
        .from("addresses")
        .select("id, name, phone, division, district, city, full_address, is_default")
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("wishlists")
        .select("product_id, products(title, slug, price_poisha, compare_at_poisha)")
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false }),
      listSupabaseOrders(),
    ]);
    const addressRows = (addressResult as { data: DbAddressRow[] | null }).data;
    const addresses = (addressRows ?? []).map(mapDbAddressToLocal);

    const wishlistRows = (wishlistResult as { data: DbWishlistRow[] | null }).data;
    const wishlist = (wishlistRows ?? [])
      .map(mapDbWishlistRowToLocal)
      .filter((item): item is WishlistItem => item !== null);

    return {
      user: {
        id: authUser.id,
        email: authUser.email ?? "",
        displayName,
        role: profile && isValidRole(profile.role) ? profile.role : "customer",
        phone: profile?.phone ?? "",
      },
      addresses,
      orders,
      wishlist,
    };
  } catch {
    return null;
  }
}

/** Save the signed-in user's display name / phone to their profiles
 *  row. The role is never touched here, so an admin can never be
 *  downgraded; RLS (profiles_update_own) also forbids role escalation.
 *  Falls back to the browser-local profile when Supabase is not
 *  configured — the caller handles that from the { ok: false } result.
 */
export async function saveAccountProfile(input: {
  displayName: string;
  phone: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const displayName = input.displayName.trim();
  const phone = input.phone.trim();
  if (displayName.length < 2) {
    return { ok: false, message: "Please enter your name (at least 2 characters)." };
  }
  if (phone && !isValidBangladeshiMobile(phone)) {
    return {
      ok: false,
      message: "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX.",
    };
  }
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { ok: false, message: "Please sign in again." };
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ display_name: displayName, phone: phone || null })
      .eq("id", data.user.id);
    if (updateError) return { ok: false, message: "Could not save your profile. Please try again." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not save your profile. Please try again." };
  }
}

export type AccountAddressInput = Omit<Address, "id"> & { id?: string };

/** Add a new address, or update an existing one the caller owns.
 *  The browser-only `label` is not stored in Supabase (the addresses
 *  table has no label column) — it is kept in the local copy only.
 *  Setting an address as default clears the default flag on the
 *  caller's other addresses first. */
export async function saveAccountAddress(
  input: AccountAddressInput,
): Promise<
  | { ok: true; address: Address }
  | { ok: false; message: string; errors?: Record<string, string> }
> {
  const errors = validateAddressInput(input);
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Please fix the highlighted address fields.", errors };
  }
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { ok: false, message: "Please sign in again." };
    const userId = data.user.id;
    const row = mapLocalAddressToDb({
      ...input,
      isDefault: input.isDefault || false,
    });
    if (row.is_default) {
      await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("user_id", userId);
    }
    if (input.id) {
      const { data: updated, error: updateError } = (await supabase
        .from("addresses")
        .update(row)
        .eq("id", input.id)
        .eq("user_id", userId)
        .select("id, name, phone, division, district, city, full_address, is_default")
        .maybeSingle()) as { data: DbAddressRow | null; error: unknown };
      if (updateError || !updated) {
        return { ok: false, message: "Could not save this address. Please try again." };
      }
      return { ok: true, address: { ...mapDbAddressToLocal(updated), label: input.label } };
    }
    const { data: inserted, error: insertError } = (await supabase
      .from("addresses")
      .insert({ ...row, user_id: userId })
      .select("id, name, phone, division, district, city, full_address, is_default")
      .single()) as { data: DbAddressRow | null; error: unknown };
    if (insertError || !inserted) {
      return { ok: false, message: "Could not save this address. Please try again." };
    }
    return { ok: true, address: { ...mapDbAddressToLocal(inserted), label: input.label } };
  } catch {
    return { ok: false, message: "Could not save this address. Please try again." };
  }
}

/** Delete one of the caller's own addresses. */
export async function deleteAccountAddress(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { ok: false, message: "Please sign in again." };
    const { error: deleteError } = await supabase
      .from("addresses")
      .delete()
      .eq("id", id)
      .eq("user_id", data.user.id);
    if (deleteError) return { ok: false, message: "Could not delete this address." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not delete this address." };
  }
}

/** Remove a product (by catalogue slug) from the caller's wishlist. */
export async function removeAccountWishlist(
  productSlug: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { ok: false, message: "Please sign in again." };
    let productId: string | null = null;
    const { data: exact } = (await supabase
      .from("products")
      .select("id")
      .eq("slug", productSlug)
      .maybeSingle()) as { data: { id: string } | null };
    productId = exact?.id ?? null;
    if (!productId) {
      const { data: prefixed } = (await supabase
        .from("products")
        .select("id")
        .like("slug", `${productSlug}-%`)
        .order("slug")
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };
      productId = prefixed?.id ?? null;
    }
    if (!productId) return { ok: true };
    const { error: deleteError } = await supabase
      .from("wishlists")
      .delete()
      .eq("user_id", data.user.id)
      .eq("product_id", productId);
    if (deleteError) return { ok: false, message: "Could not remove this item." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not remove this item." };
  }
}
