"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBDT } from "@/lib/theme";
import { useCart } from "@/lib/cart-store";
import {
  DIVISIONS,
  DISTRICTS,
  addAddress,
  deleteAddress,
  getAddresses,
  getProfile,
  getWishlist,
  removeFromWishlist,
  saveProfile,
  updateAddress,
  type Address,
  type Profile,
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

function isValidMobile(mobile: string): boolean {
  return /^(\+880|0)?1[3-9]\d{8}$/.test(mobile.trim());
}

export default function AccountPage() {
  const cart = useCart();
  const [loaded, setLoaded] = useState(false);
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

  useEffect(() => {
    setProfile(getProfile());
    setAddresses(getAddresses());
    setWishlist(getWishlist());
    setLoaded(true);
  }, []);

  function refreshAddresses() {
    setAddresses(getAddresses());
  }

  function handleSaveProfile(event: React.FormEvent) {
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
    saveProfile(profile);
    setProfileError(null);
    setProfileSaved(true);
  }

  function openNewAddress() {
    setEditingId(null);
    setAddressForm(emptyAddressForm);
    setAddressErrors({});
    setShowAddressForm(true);
  }

  function openEditAddress(address: Address) {
    setEditingId(address.id);
    setAddressForm({
      label: address.label ?? "",
      firstName: address.firstName,
      lastName: address.lastName,
      email: address.email,
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

  function handleSaveAddress(event: React.FormEvent) {
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

  function moveWishlistToCart(item: WishlistItem) {
    // Wishlist stores catalog slugs; the live cart is lib/cart-store.
    cart.add(item.productId, undefined, 1);
    removeFromWishlist(item.productId);
    setWishlist(getWishlist());
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

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <h1 className="text-3xl font-bold text-text">My account</h1>
      <p className="mt-1 text-muted">Profile, addresses and wishlist — saved in your browser.</p>

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
            />
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
                    <button type="button" className={btnGhost} onClick={() => { updateAddress(address.id, { isDefault: true }); refreshAddresses(); }}>
                      Set as default
                    </button>
                  )}
                  <button type="button" className={btnGhost} onClick={() => openEditAddress(address)}>Edit</button>
                  <button
                    type="button"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-red-400 hover:border-red-400"
                    onClick={() => { deleteAddress(address.id); refreshAddresses(); }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {showAddressForm && (
          <form onSubmit={handleSaveAddress} className="mt-5 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
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
                <button type="button" className={btnGhost} onClick={() => moveWishlistToCart(item)}>
                  Move to cart
                </button>
                <button
                  type="button"
                  className="text-sm text-muted hover:text-text"
                  onClick={() => { removeFromWishlist(item.productId); setWishlist(getWishlist()); }}
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
        <p className="mt-2 text-sm text-muted">See every order you have placed, with its current status.</p>
        <Link href="/orders" className={`${btnPrimary} mt-4`}>View my orders</Link>
      </section>
    </main>
  );
}
