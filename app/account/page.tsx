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
//
// The four sections live in components/account/ (profile, addresses,
// orders, wishlist); this page keeps the account state, the data
// loading and the save / delete handlers, and composes the sections.

"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { btnGhost, btnPrimary } from "@/components/account/account-ui";
import ProfileSection from "@/components/account/profile-section";
import SecuritySection from "@/components/account/security-section";
import AddressesSection, { type AddressFormState } from "@/components/account/addresses-section";
import OrdersSection from "@/components/account/orders-section";
import WishlistSection from "@/components/account/wishlist-section";

const emptyAddressForm: AddressFormState = {
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
    // Signed in, so Supabase is configured: the live orders are the
    // whole list — the local copy is a guest / unconfigured fallback
    // only and must never surface another account's local orders
    // here (audit #9, mergeOrders serverMode).
    setOrders((local) => mergeOrders(local, data.orders, true));
    return true;
  }, []);

  // Browser-local data first, so the page renders immediately even
  // before auth resolves; Supabase data replaces it when available.
  // The seed is the GUEST view (explicit null): until the viewer is
  // known, only guest-owned records may show — another account's
  // local records must never flash on this page while auth loads
  // (audit #9). The auth effect below re-seeds with the signed-in
  // user's id as soon as it is known.
  useEffect(() => {
    setProfile(getProfile(null));
    setAddresses(getAddresses(null));
    setWishlist(getWishlist(null));
    setOrders(listOrders(null));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    // The viewer is known now: re-seed the local sections with this
    // account's records only (another account's local records stay
    // hidden), then let the server data replace them when it loads.
    setProfile(getProfile(user.id));
    setAddresses(getAddresses(user.id));
    setWishlist(getWishlist(user.id));
    setOrders(listOrders(user.id));
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
    setAddresses(getAddresses(user?.id ?? null));
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
      // Keep the browser-local copy in sync for the preview fallback,
      // stamped with this account's id so it is never shown to
      // another account on a shared browser (audit #9).
      saveProfile(profile, user?.id ?? null);
    } else {
      saveProfile(profile, user?.id ?? null);
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
      addAddress(payload, user?.id ?? null);
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
    removeFromWishlist(productId, user?.id ?? null);
    setWishlist(getWishlist(user?.id ?? null));
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

  const displayUser = accountUser ?? user;

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <h1 className="text-3xl font-bold text-text">My account</h1>

      {showSignedIn && user && (
        <p
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-success/40 bg-success/15 px-4 py-3 text-sm font-medium text-success"
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

      <ProfileSection
        profile={profile}
        onProfileChange={setProfile}
        user={user}
        saved={profileSaved}
        error={profileError}
        onSave={handleSaveProfile}
      />

      <SecuritySection user={user} />

      <AddressesSection
        addresses={addresses}
        addressForm={addressForm}
        onAddressFormChange={setAddressForm}
        addressErrors={addressErrors}
        addressNotice={addressNotice}
        showAddressForm={showAddressForm}
        editingId={editingId}
        onNewAddress={openNewAddress}
        onEditAddress={openEditAddress}
        onSaveAddress={(e) => { void handleSaveAddress(e); }}
        onDeleteAddress={(id) => { void handleDeleteAddress(id); }}
        onSetDefaultAddress={(address) => { void handleSetDefaultAddress(address); }}
        onCancelForm={() => { setShowAddressForm(false); setEditingId(null); }}
      />

      <div id="wishlist" className="scroll-mt-20">
        <WishlistSection
          wishlist={wishlist}
          notice={wishlistNotice}
          onMoveToCart={(item) => { void moveWishlistToCart(item); }}
          onRemove={(productId) => { void handleRemoveWishlist(productId); }}
        />
      </div>

      <OrdersSection orders={orders} />
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
