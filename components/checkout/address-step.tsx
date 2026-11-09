// Step 1 of the checkout form: the shipping address.
// One job: the address fields (with division -> district reset)
// and the collapsed address summary once the step is done.

import { DIVISIONS, DISTRICTS } from "@/lib/checkout-store";
import type { AddressInput } from "@/lib/orders";
import { btnPrimary, errCls, inputCls, labelCls, type CheckoutStep } from "./checkout-shared";

export default function AddressStep({
  address,
  errors,
  step,
  onField,
  onEdit,
  onContinue,
}: {
  address: AddressInput;
  errors: Record<string, string>;
  step: CheckoutStep;
  onField: <K extends keyof AddressInput>(key: K, value: AddressInput[K]) => void;
  onEdit: () => void;
  onContinue: () => void;
}) {
  const districts = address.division ? DISTRICTS[address.division] ?? [] : [];
  return (
    <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Shipping address">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text">
                <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm text-white">1</span>
                Shipping address
              </h2>
              {step !== 1 && (
                <button type="button" className="text-sm text-ink hover:underline" onClick={onEdit}>
                  Edit
                </button>
              )}
            </div>

            {step === 1 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="firstName" className={labelCls}>First name</label>
                  <input id="firstName" value={address.firstName} onChange={(e) => onField("firstName", e.target.value)} className={inputCls} autoComplete="given-name" />
                  {errors.firstName && <p className={errCls}>{errors.firstName}</p>}
                </div>
                <div>
                  <label htmlFor="lastName" className={labelCls}>Last name</label>
                  <input id="lastName" value={address.lastName} onChange={(e) => onField("lastName", e.target.value)} className={inputCls} autoComplete="family-name" />
                  {errors.lastName && <p className={errCls}>{errors.lastName}</p>}
                </div>
                <div>
                  <label htmlFor="email" className={labelCls}>Email</label>
                  <input id="email" type="email" value={address.email} onChange={(e) => onField("email", e.target.value)} className={inputCls} autoComplete="email" />
                  {errors.email && <p className={errCls}>{errors.email}</p>}
                </div>
                <div>
                  <label htmlFor="mobile" className={labelCls}>Mobile (+880)</label>
                  <input id="mobile" type="tel" value={address.mobile} onChange={(e) => onField("mobile", e.target.value)} placeholder="01XXXXXXXXX" className={inputCls} autoComplete="tel" />
                  {errors.mobile && <p className={errCls}>{errors.mobile}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="address" className={labelCls}>Street address</label>
                  <input id="address" value={address.address} onChange={(e) => onField("address", e.target.value)} placeholder="House, road, building" className={inputCls} autoComplete="street-address" />
                  {errors.address && <p className={errCls}>{errors.address}</p>}
                </div>
                <div>
                  <label htmlFor="area" className={labelCls}>Area / locality</label>
                  <input id="area" value={address.area} onChange={(e) => onField("area", e.target.value)} placeholder="e.g. Dhanmondi" className={inputCls} />
                  {errors.area && <p className={errCls}>{errors.area}</p>}
                </div>
                <div>
                  <label htmlFor="division" className={labelCls}>Division</label>
                  <select id="division" value={address.division} onChange={(e) => onField("division", e.target.value)} className={inputCls}>
                    <option value="">Select division</option>
                    {DIVISIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {errors.division && <p className={errCls}>{errors.division}</p>}
                </div>
                <div>
                  <label htmlFor="district" className={labelCls}>District</label>
                  <select id="district" value={address.district} onChange={(e) => onField("district", e.target.value)} className={inputCls} disabled={!address.division}>
                    <option value="">{address.division ? "Select district" : "Select division first"}</option>
                    {districts.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {errors.district && <p className={errCls}>{errors.district}</p>}
                </div>
                <div>
                  <label htmlFor="city" className={labelCls}>City</label>
                  <input id="city" value={address.city} onChange={(e) => onField("city", e.target.value)} placeholder="e.g. Dhaka" className={inputCls} />
                  {errors.city && <p className={errCls}>{errors.city}</p>}
                </div>
                <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={address.billingSame}
                    onChange={(e) => onField("billingSame", e.target.checked)}
                    className="h-4 w-4 accent-brandDark"
                  />
                  Billing address is the same as shipping address
                </label>
                <div className="sm:col-span-2">
                  <button type="button" className={btnPrimary} onClick={onContinue}>
                    Continue to delivery
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                {address.firstName} {address.lastName}, {address.address}, {address.area}, {address.city}, {address.district}, {address.division} · {address.mobile}
              </p>
            )}
          </section>
  );
}
