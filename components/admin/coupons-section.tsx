// Admin coupons section (client component).
//
// The coupons list and add-coupon form on the dashboard Overview
// tab. Coupons are still stored locally in the demo (lib/demo-store).
// FIRST2000 is the launch coupon: ৳2,000 off orders of ৳50,000 or
// more.
//
// Split from app/admin/AdminDashboard.tsx: the coupons UI and its
// form state live here, the tab shell in ./dashboard-shell, and
// app/admin/AdminDashboard.tsx re-exports the shell.

"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  addAdminCoupon,
  deleteCoupon,
  getAdminCoupons,
  toggleCoupon,
  type AdminCoupon,
} from "@/lib/demo-store";
import { formatBDT } from "@/lib/theme";
import { Badge, Button, Card, Field, Input, SectionHeading } from "@/components/ui";

const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Coupon code must be at least 3 characters.")
    .max(20, "Coupon code must be 20 characters or fewer.")
    .regex(/^[A-Za-z0-9]+$/, "Coupon code may only contain letters and numbers."),
  valueTaka: z.number().positive("Discount must be greater than ৳0."),
  minTaka: z.number().min(0, "Minimum order cannot be negative."),
});

export default function CouponsSection() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);

  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("");
  const [couponMin, setCouponMin] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    setCoupons(getAdminCoupons());
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  function handleAddCoupon(event: FormEvent) {
    event.preventDefault();
    setCouponError(null);
    setCouponNotice(null);
    const parsed = couponSchema.safeParse({
      code: couponCode,
      valueTaka: Number(couponValue),
      minTaka: Number(couponMin),
    });
    if (!parsed.success) {
      setCouponError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    try {
      addAdminCoupon({
        code: parsed.data.code,
        valuePoisha: Math.round(parsed.data.valueTaka * 100),
        minPoisha: Math.round(parsed.data.minTaka * 100),
        active: true,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      setCouponError(error instanceof Error ? error.message : "Could not add the coupon.");
      return;
    }
    setCouponCode("");
    setCouponValue("");
    setCouponMin("");
    setCouponNotice(`Coupon ${parsed.data.code.toUpperCase()} was added.`);
    refreshAll();
  }

  return (
    <div className="mt-10">
      <SectionHeading title="Coupons" description="Coupons are stored locally in the demo. FIRST2000 is the launch coupon: ৳2,000 off orders of ৳50,000 or more." />
      <div className="mb-10 space-y-3">
        {coupons.map((coupon) => (
          <Card key={coupon.code}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-text">
                  {coupon.code} {coupon.active ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formatBDT(coupon.valuePoisha)} off orders of {formatBDT(coupon.minPoisha)} or more
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toggleCoupon(coupon.code);
                    refreshAll();
                  }}
                >
                  {coupon.active ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    deleteCoupon(coupon.code);
                    refreshAll();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
        <Card>
          <form onSubmit={handleAddCoupon} noValidate className="grid gap-3 sm:grid-cols-4">
            <Field label="Code" htmlFor="coupon-code" required>
              <Input id="coupon-code" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="e.g. EID500" />
            </Field>
            <Field label="Discount (৳)" htmlFor="coupon-value" required>
              <Input id="coupon-value" type="number" min="0" step="1" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} placeholder="500" />
            </Field>
            <Field label="Minimum order (৳)" htmlFor="coupon-min" required>
              <Input id="coupon-min" type="number" min="0" step="1" value={couponMin} onChange={(e) => setCouponMin(e.target.value)} placeholder="5000" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Add coupon</Button>
            </div>
            {couponError ? (
              <p role="alert" className="text-sm text-red-700 sm:col-span-4">{couponError}</p>
            ) : null}
            {couponNotice ? (
              <p role="status" className="text-sm text-success sm:col-span-4">{couponNotice}</p>
            ) : null}
          </form>
        </Card>
      </div>
    </div>
  );
}
