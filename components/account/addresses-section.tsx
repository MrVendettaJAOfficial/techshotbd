// Account addresses section (client component).
//
// The saved-address list plus the add / edit address form. Saving,
// deleting and setting the default go through
// lib/account-server.ts when the Supabase data is live, and fall
// back to the browser-local addresses otherwise — the caller
// (app/account/page.tsx) owns that choice and the address state,
// and passes its handlers in.
//
// Split from app/account/page.tsx: the addresses UI lives here, the
// page keeps the address state and the save / delete handlers.

"use client";

import { DIVISIONS, DISTRICTS, type Address } from "@/lib/checkout-store";
import { btnGhost, btnPrimary, errCls, inputCls, labelCls } from "./account-ui";

export interface AddressFormState {
  label: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  address: string;
  area: string;
  division: string;
  district: string;
  city: string;
}

interface AddressesSectionProps {
  addresses: Address[];
  addressForm: AddressFormState;
  onAddressFormChange: (form: AddressFormState) => void;
  addressErrors: Record<string, string>;
  addressNotice: string | null;
  showAddressForm: boolean;
  editingId: string | null;
  onNewAddress: () => void;
  onEditAddress: (address: Address) => void;
  onSaveAddress: (event: React.FormEvent) => void;
  onDeleteAddress: (id: string) => void;
  onSetDefaultAddress: (address: Address) => void;
  onCancelForm: () => void;
}

export default function AddressesSection({
  addresses,
  addressForm,
  onAddressFormChange,
  addressErrors,
  addressNotice,
  showAddressForm,
  editingId,
  onNewAddress,
  onEditAddress,
  onSaveAddress,
  onDeleteAddress,
  onSetDefaultAddress,
  onCancelForm,
}: AddressesSectionProps) {
  const districts = addressForm.division ? DISTRICTS[addressForm.division] ?? [] : [];

  return (
    <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Addresses">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">Addresses</h2>
        <button type="button" className={btnGhost} onClick={onNewAddress}>Add address</button>
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
                  <button type="button" className={btnGhost} onClick={() => onSetDefaultAddress(address)}>
                    Set as default
                  </button>
                )}
                <button type="button" className={btnGhost} onClick={() => onEditAddress(address)}>Edit</button>
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-red-400 hover:border-red-400"
                  onClick={() => onDeleteAddress(address.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {showAddressForm && (
        <form onSubmit={onSaveAddress} className="mt-5 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
          <div>
            <label htmlFor="addrLabel" className={labelCls}>Label (optional, e.g. Home)</label>
            <input id="addrLabel" value={addressForm.label} onChange={(e) => onAddressFormChange({ ...addressForm, label: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="addrFirstName" className={labelCls}>First name</label>
            <input id="addrFirstName" value={addressForm.firstName} onChange={(e) => onAddressFormChange({ ...addressForm, firstName: e.target.value })} className={inputCls} />
            {addressErrors.firstName && <p className={errCls}>{addressErrors.firstName}</p>}
          </div>
          <div>
            <label htmlFor="addrLastName" className={labelCls}>Last name</label>
            <input id="addrLastName" value={addressForm.lastName} onChange={(e) => onAddressFormChange({ ...addressForm, lastName: e.target.value })} className={inputCls} />
            {addressErrors.lastName && <p className={errCls}>{addressErrors.lastName}</p>}
          </div>
          <div>
            <label htmlFor="addrEmail" className={labelCls}>Email</label>
            <input id="addrEmail" type="email" value={addressForm.email} onChange={(e) => onAddressFormChange({ ...addressForm, email: e.target.value })} className={inputCls} />
            {addressErrors.email && <p className={errCls}>{addressErrors.email}</p>}
          </div>
          <div>
            <label htmlFor="addrMobile" className={labelCls}>Mobile (+880)</label>
            <input id="addrMobile" type="tel" value={addressForm.mobile} onChange={(e) => onAddressFormChange({ ...addressForm, mobile: e.target.value })} placeholder="01XXXXXXXXX" className={inputCls} />
            {addressErrors.mobile && <p className={errCls}>{addressErrors.mobile}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="addrStreet" className={labelCls}>Street address</label>
            <input id="addrStreet" value={addressForm.address} onChange={(e) => onAddressFormChange({ ...addressForm, address: e.target.value })} placeholder="House, road, building" className={inputCls} />
            {addressErrors.address && <p className={errCls}>{addressErrors.address}</p>}
          </div>
          <div>
            <label htmlFor="addrArea" className={labelCls}>Area / locality</label>
            <input id="addrArea" value={addressForm.area} onChange={(e) => onAddressFormChange({ ...addressForm, area: e.target.value })} placeholder="e.g. Dhanmondi" className={inputCls} />
            {addressErrors.area && <p className={errCls}>{addressErrors.area}</p>}
          </div>
          <div>
            <label htmlFor="addrDivision" className={labelCls}>Division</label>
            <select
              id="addrDivision"
              value={addressForm.division}
              onChange={(e) => onAddressFormChange({ ...addressForm, division: e.target.value, district: "" })}
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
              onChange={(e) => onAddressFormChange({ ...addressForm, district: e.target.value })}
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
            <input id="addrCity" value={addressForm.city} onChange={(e) => onAddressFormChange({ ...addressForm, city: e.target.value })} placeholder="e.g. Dhaka" className={inputCls} />
            {addressErrors.city && <p className={errCls}>{addressErrors.city}</p>}
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={btnPrimary}>{editingId ? "Update address" : "Add address"}</button>
            <button type="button" className={btnGhost} onClick={onCancelForm}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
