// My account page.
//
// Shows the signed-in user's dashboard: name, email and role from
// Supabase (via useAuth + getAccountData), saved addresses, order
// history and wishlist. When Supabase is configured those sections
// read from Supabase (addresses / orders / order_items / wishlists,
// all owner-only under RLS); when it is not configured — or nobody
// is signed in — the page falls back to the browser-local data in
// lib/checkout-store, exactly as before, so the preview still works.
//
// After a successful sign-in / sign-up / email confirmation the user
// lands here with ?signed_in=1, and a visible "Signed in
// successfully" banner is shown (role="status") — not just a console
// log. The banner is dismissible and does not reappear on refresh:
// dismissing it removes the query parameter.
//
// A signed-out visitor sees a sign-in prompt at the top and the
// local sections below; a signed-in user gets a Sign out button.

"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatBDT } from "@/lib/theme";
import { useCart } from "@/lib/cart-store";
import { AuthProvider, useAuth, type AppUser } from "@/lib/auth";
import {
  deleteAccountAddress,
  getAccountData,
  removeAccountWishlist,
  saveAccountAddress,
  saveAccountProfile,
} from "@/lib/account-server";
import { mergeOrders } from "@/lib/account-rules";
import {
  DIVISIONS,
  DISTRICTS,
  addAddress,
  deleteAddress,
  getAddresses,
  getProfile,
  getWishlist,
  listOrders,
  removeFromWishlist,
  saveProfile,
  updateAddress,
  type Address,
  type Profile,
  type StoredOrder,
  type WishlistItem,
} from "@/lib/checkout-store";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-text outline-none focus:border-brand";
const labelCls = "mb-1 block text-sm font-medium text-text";
const errCls = "mt-1 text-sm text-red-400";
const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-text hover:border-brand";

const emptyAddressForm = {
  label: "",
  firstName: "",
  lastName: "",
  email: "",
  mobile: "",
  address: "",
  area: "",
  division: "",
  district: "",
  city: "",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function roleLabel(role: AppUser["role"]): string {
  return role === "admin" ? "Admin" : "Customer";
}

function isValidMobile(mobile: string): boolean {
  return /^(\+880|0)?1[3-9]\d{8}$/.test(mobile.trim());
}

function AccountPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cart = useCart();
  const { user, loading: authLoading, signOutUser } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [serverMode, setServerMode] = useState(false);
  const [accountUser, setAccountUser] = useState<(AppUser & { phone: string }) | null>(null);
  const [showSignedIn, setShowSignedIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [profile, setProfile] = useState<Profile>({ displayName: "", phone: "", email: "" });
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressForm, setAddressForm] = useState(emptyAddressForm);
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({});
  const [addressNotice, setAddressNotice] = useState<string | null>(null);

  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [wishlistNotice, setWishlistNotice] = useState<string | null>(null);

  const [orders, setOrders] = useState<StoredOrder[]>([]);

  const refreshAccountData = useCallback(async () => {
    const data = await getAccountData().catch(() => null);
    if (!data) {
      setServerMode(false);
      return false;
    }
    setServerMode(true);
    setAccountUser(data.user);
    setProfile({
      displayName: data.user.displayName,
      phone: data.user.phone,
      email: data.user.email,
    });
    setAddresses(data.addresses);
    setWishlist(data.wishlist);
    setOrders((local) => mergeOrders(local, data.orders));
    return true;
  }, []);

  // Browser-local data first, so the page renders immediately even
  // before auth resolves; Supabase data replaces it when available.
  useEffect(() => {
    setProfile(getProfile());
    setAddresses(getAddresses());
    setWishlist(getWishlist());
    setOrders(listOrders());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    // Fill the profile form from the signed-in user even before the
    // server data arrives (name/email/role come from the profile row,
    // with user_metadata as fallback — see lib/auth.ts toAppUser).
    setProfile((prev) => ({
      displayName: prev.displayName || user.displayName,
      phone: prev.phone,
      email: user.email,
    }));
    void refreshAccountData();
  }, [authLoading, user, refreshAccountData]);

  useEffect(() => {
    if (searchParams.get("signed_in") === "1") setShowSignedIn(true);
  }, [searchParams]);

  function dismissSignedIn() {
    setShowSignedIn(false);
    router.replace("/account", { scroll: false });
  }

  async function handleSignOut() {
    setSigningOut(true);
    signOutUser();
    router.push("/");
    router.refresh();
  }

  function refreshAddresses() {
    setAddresses(getAddresses());
  }

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (profile.phone && !isValidMobile(profile.phone)) {
      setProfileError("Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX.");
      setProfileSaved(false);
      return;
    }
    if (profile.email && !/^\S+@\S+\.\S+$/.test(profile.email)) {
      setProfileError("Enter a valid email address.");
      setProfileSaved(false);
      return;
    }
    if (serverMode) {
      const result = await saveAccountProfile({
        displayName: profile.displayName,
        phone: profile.phone,
      });
      if (!result.ok) {
        setProfileError(result.message);
        setProfileSaved(false);
        return;
      }
      // Keep the browser-local copy in sync for the preview fallback.
      saveProfile(profile);
    } else {
      saveProfile(profile);
    }
    setProfileError(null);
    setProfileSaved(true);
  }

  function openNewAddress() {
    setEditingId(null);
    setAddressForm({ ...emptyAddressForm, email: user?.email ?? "" });
    setAddressErrors({});
    setShowAddressForm(true);
  }

  function openEditAddress(address: Address) {
    setEditingId(address.id);
    setAddressForm({
      label: address.label ?? "",
      firstName: address.firstName,
      lastName: address.lastName,
      email: address.email || user?.email || "",
      mobile: address.mobile,
      address: address.address,
      area: address.area,
      division: address.division,
      district: address.district,
      city: address.city,
    });
    setAddressErrors({});
    setShowAddressForm(true);
  }

  function validateAddressForm(): boolean {
    const errors: Record<string, string> = {};
    if (!addressForm.firstName.trim()) errors.firstName = "First name is required.";
    if (!addressForm.lastName.trim()) errors.lastName = "Last name is required.";
    if (!addressForm.email.trim() || !/^\S+@\S+\.\S+$/.test(addressForm.email)) {
      errors.email = "Enter a valid email address.";
    }
    if (!isValidMobile(addressForm.mobile)) {
      errors.mobile = "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX.";
    }
    if (!addressForm.address.trim()) errors.address = "Street address is required.";
    if (!addressForm.area.trim()) errors.area = "Area / locality is required.";
    if (!addressForm.division) errors.division = "Division is required.";
    if (!addressForm.district) errors.district = "District is required.";
    if (!addressForm.city.trim()) errors.city = "City is required.";
    setAddressErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveAddress(event: React.FormEvent) {
    event.preventDefault();
    if (!validateAddressForm()) return;
    const payload = {
      label: addressForm.label.trim() || undefined,
      firstName: addressForm.firstName.trim(),
      lastName: addressForm.lastName.trim(),
      email: addressForm.email.trim(),
      mobile: addressForm.mobile.trim(),
      address: addressForm.address.trim(),
      area: addressForm.area.trim(),
      division: addressForm.division,
      district: addressForm.district,
      city: addressForm.city.trim(),
      isDefault: addresses.length === 0,
    };
    if (serverMode) {
      const result = await saveAccountAddress(
        editingId ? { ...payload, id: editingId } : payload,
      );
      if (!result.ok) {
        if (result.errors) setAddressErrors(result.errors);
        else setAddressErrors({ form: result.message });
        return;
      }
      setAddressNotice(editingId ? "Address updated." : "Address added.");
      setShowAddressForm(false);
      setEditingId(null);
      await refreshAccountData();
      return;
    }
    if (editingId) {
      updateAddress(editingId, payload);
      setAddressNotice("Address updated.");
    } else {
      addAddress(payload);
      setAddressNotice("Address added.");
    }
    setShowAddressForm(false);
    setEditingId(null);
    refreshAddresses();
  }

  async function handleDeleteAddress(id: string) {
    if (serverMode) {
      const result = await deleteAccountAddress(id);
      if (!result.ok) {
        setAddressNotice(result.message);
        return;
      }
      await refreshAccountData();
      return;
    }
    deleteAddress(id);
    refreshAddresses();
  }

  async function handleSetDefaultAddress(address: Address) {
    if (serverMode) {
      const result = await saveAccountAddress({ ...address, isDefault: true });
      if (!result.ok) {
        setAddressNotice(result.message);
        return;
      }
      await refreshAccountData();
      return;
    }
    updateAddress(address.id, { isDefault: true });
    refreshAddresses();
  }

  async function handleRemoveWishlist(productId: string) {
    if (serverMode) {
      await removeAccountWishlist(productId);
      await refreshAccountData();
      return;
    }
    removeFromWishlist(productId);
    setWishlist(getWishlist());
  }

  async function moveWishlistToCart(item: WishlistItem) {
    // Wishlist stores catalog slugs; the live cart is lib/cart-store.
    cart.add(item.productId, undefined, 1);
    await handleRemoveWishlist(item.productId);
    setWishlistNotice(`Moved “${item.title}” to your cart.`);
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-10">
        <p className="text-muted">Loading your account…</p>
      </main>
    );
  }

  const districts = addressForm.division ? DISTRICTS[addressForm.division] ?? [] : [];
  const displayUser = accountUser ?? user;
  const recentOrders = orders.slice(0, 5);

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <h1 className="text-3xl font-bold text-text">My account</h1>

      {showSignedIn && user && (
        <p
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-[#5bd4a0]/40 bg-[#5bd4a0]/15 px-4 py-3 text-sm font-medium text-[#5bd4a0]"
        >
          <span>Signed in successfully. Welcome back, {user.displayName}.</span>
          <button type="button" onClick={dismissSignedIn} className="shrink-0 font-bold hover:underline" aria-label="Dismiss">
            Dismiss
          </button>
        </p>
      )}

      {!authLoading && !user && (
        <div className="mt-4 rounded-2xl border border-border bg-panel p-5">
          <h2 className="text-lg font-bold text-text">You are not signed in</h2>
          <p className="mt-1 text-sm text-muted">
            Sign in to see your profile, orders and wishlist saved to your account.
          </p>
          <Link href="/auth/sign-in" className={`${btnPrimary} mt-4`}>
            Sign in
          </Link>
        </div>
      )}

      {displayUser && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-panel p-5">
          <div className="text-sm">
            <p className="text-lg font-bold text-text">{displayUser.displayName}</p>
            <p className="mt-0.5 text-muted">{displayUser.email}</p>
            <p className="mt-1 text-muted">
              Role: <span className="font-semibold text-text">{roleLabel(displayUser.role)}</span>
            </p>
          </div>
          <button type="button" className={btnGhost} onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}

      <p className="mt-4 text-muted">
        {serverMode
          ? "Profile, addresses and wishlist — saved to your TechShot account."
          : "Profile, addresses and wishlist — saved in your browser."}
      </p>

      {/* Profile */}
      <section className="mt-8 rounded-2xl border border-border bg-panel p-5" aria-label="Profile">
        <h2 className="text-lg font-bold text-text">Profile</h2>
        <form onSubmit={handleSaveProfile} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="displayName" className={labelCls}>Display name</label>
            <input
              id="displayName"
              value={profile.displayName}
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
              placeholder="Your name"
              className={inputCls}
              autoComplete="name"
            />
          </div>
          <div>
            <label htmlFor="phone" className={labelCls}>Phone</label>
            <input
              id="phone"
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="01XXXXXXXXX"
              className={inputCls}
              autoComplete="tel"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="profileEmail" className={labelCls}>Email</label>
            <input
              id="profileEmail"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="you@example.com"
              className={inputCls}
              autoComplete="email"
              readOnly={!!user}
              aria-readonly={!!user}
            />
            {user && (
              <p className="mt-1 text-xs text-muted">Your sign-in email cannot be changed here.</p>
            )}
          </div>
          {profileError && <p role="alert" className="text-sm text-red-400 sm:col-span-2">{profileError}</p>}
          {profileSaved && <p role="status" className="text-sm text-success sm:col-span-2">Profile saved.</p>}
          <div className="sm:col-span-2">
            <button type="submit" className={btnPrimary}>Save profile</button>
          </div>
        </form>
      </section>

      {/* Addresses */}
      <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Addresses">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text">Addresses</h2>
          <button type="button" className={btnGhost} onClick={openNewAddress}>Add address</button>
        </div>
        {addressNotice && <p role="status" className="mt-3 text-sm text-success">{addressNotice}</p>}
        {addressErrors.form && <p role="alert" className="mt-3 text-sm text-red-400">{addressErrors.form}</p>}

        {addresses.length === 0 && !showAddressForm && (
          <p className="mt-3 text-sm text-muted">No addresses yet. Add your delivery address here.</p>
        )}

        <ul className="mt-4 space-y-3">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm text-text">
                  <p className="font-semibold">
                    {address.label ? `${address.label} — ` : ""}
                    {address.firstName} {address.lastName}
                    {address.isDefault && (
                      <span className="ml-2 rounded-full bg-success/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Default</span>
                    )}
                  </p>
                  <p className="mt-1 text-muted">
                    {address.address}, {address.area}
                    <br />
                    {address.city}, {address.district}, {address.division}
                    <br />
                    {address.mobile} · {address.email}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!address.isDefault && (
                    <button type="button" className={btnGhost} onClick={() => { void handleSetDefaultAddress(address); }}>
                      Set as default
                    </button>
                  )}
                  <button type="button" className={btnGhost} onClick={() => openEditAddress(address)}>Edit</button>
                  <button
                    type="button"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-red-400 hover:border-red-400"
                    onClick={() => { void handleDeleteAddress(address.id); }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {showAddressForm && (
          <form onSubmit={(e) => { void handleSaveAddress(e); }} className="mt-5 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
            <div>
              <label htmlFor="addrLabel" className={labelCls}>Label (optional, e.g. Home)</label>
              <input id="addrLabel" value={addressForm.label} onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label htmlFor="addrFirstName" className={labelCls}>First name</label>
              <input id="addrFirstName" value={addressForm.firstName} onChange={(e) => setAddressForm({ ...addressForm, firstName: e.target.value })} className={inputCls} />
              {addressErrors.firstName && <p className={errCls}>{addressErrors.firstName}</p>}
            </div>
            <div>
              <label htmlFor="addrLastName" className={labelCls}>Last name</label>
              <input id="addrLastName" value={addressForm.lastName} onChange={(e) => setAddressForm({ ...addressForm, lastName: e.target.value })} className={inputCls} />
              {addressErrors.lastName && <p className={errCls}>{addressErrors.lastName}</p>}
            </div>
            <div>
              <label htmlFor="addrEmail" className={labelCls}>Email</label>
              <input id="addrEmail" type="email" value={addressForm.email} onChange={(e) => setAddressForm({ ...addressForm, email: e.target.value })} className={inputCls} />
              {addressErrors.email && <p className={errCls}>{addressErrors.email}</p>}
            </div>
            <div>
              <label htmlFor="addrMobile" className={labelCls}>Mobile (+880)</label>
              <input id="addrMobile" type="tel" value={addressForm.mobile} onChange={(e) => setAddressForm({ ...addressForm, mobile: e.target.value })} placeholder="01XXXXXXXXX" className={inputCls} />
              {addressErrors.mobile && <p className={errCls}>{addressErrors.mobile}</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="addrStreet" className={labelCls}>Street address</label>
              <input id="addrStreet" value={addressForm.address} onChange={(e) => setAddressForm({ ...addressForm, address: e.target.value })} placeholder="House, road, building" className={inputCls} />
              {addressErrors.address && <p className={errCls}>{addressErrors.address}</p>}
            </div>
            <div>
              <label htmlFor="addrArea" className={labelCls}>Area / locality</label>
              <input id="addrArea" value={addressForm.area} onChange={(e) => setAddressForm({ ...addressForm, area: e.target.value })} placeholder="e.g. Dhanmondi" className={inputCls} />
              {addressErrors.area && <p className={errCls}>{addressErrors.area}</p>}
            </div>
            <div>
              <label htmlFor="addrDivision" className={labelCls}>Division</label>
              <select
                id="addrDivision"
                value={addressForm.division}
                onChange={(e) => setAddressForm({ ...addressForm, division: e.target.value, district: "" })}
                className={inputCls}
              >
                <option value="">Select division</option>
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {addressErrors.division && <p className={errCls}>{addressErrors.division}</p>}
            </div>
            <div>
              <label htmlFor="addrDistrict" className={labelCls}>District</label>
              <select
                id="addrDistrict"
                value={addressForm.district}
                onChange={(e) => setAddressForm({ ...addressForm, district: e.target.value })}
                className={inputCls}
                disabled={!addressForm.division}
              >
                <option value="">{addressForm.division ? "Select district" : "Select division first"}</option>
                {districts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {addressErrors.district && <p className={errCls}>{addressErrors.district}</p>}
            </div>
            <div>
              <label htmlFor="addrCity" className={labelCls}>City</label>
              <input id="addrCity" value={addressForm.city} onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} placeholder="e.g. Dhaka" className={inputCls} />
              {addressErrors.city && <p className={errCls}>{addressErrors.city}</p>}
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className={btnPrimary}>{editingId ? "Update address" : "Add address"}</button>
              <button type="button" className={btnGhost} onClick={() => { setShowAddressForm(false); setEditingId(null); }}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      {/* Wishlist */}
      <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Wishlist">
        <h2 className="text-lg font-bold text-text">Wishlist</h2>
        {wishlistNotice && <p role="status" className="mt-3 text-sm text-success">{wishlistNotice}</p>}
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
                <button type="button" className={btnGhost} onClick={() => { void moveWishlistToCart(item); }}>
                  Move to cart
                </button>
                <button
                  type="button"
                  className="text-sm text-muted hover:text-text"
                  onClick={() => { void handleRemoveWishlist(item.productId); }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Order history */}
      <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Order history">
        <h2 className="text-lg font-bold text-text">Order history</h2>
        {recentOrders.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No orders yet. Orders you place will show up here with their status and totals.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {recentOrders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 hover:border-brand"
                >
                  <span>
                    <span className="block font-semibold text-text">{order.orderNumber}</span>
                    <span className="block text-sm text-muted">
                      {formatDate(order.createdAt)} · {ORDER_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </span>
                  <span className="font-bold text-text">{formatBDT(order.total_poisha)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/orders" className={`${btnPrimary} mt-4`}>View my orders</Link>
      </section>
    </main>
  );
}

export default function AccountPage() {
  return (
    <AuthProvider>
      <Suspense
        fallback={
          <main className="mx-auto max-w-[900px] px-4 py-10">
            <p className="text-muted">Loading your account…</p>
          </main>
        }
      >
        <AccountPageInner />
      </Suspense>
    </AuthProvider>
  );
}
