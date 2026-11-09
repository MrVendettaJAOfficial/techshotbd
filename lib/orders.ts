// Server-side order helpers for TechShot.
//
// The code moved to lib/orders/checkout/ (one job per file); this
// file is a thin barrel so every original import path keeps working:
//   checkout/totals.ts       — totals, order numbers, summaries, payment outcomes
//   checkout/coupons.ts      — FIRST2000 coupon validation
//   checkout/validation.ts   — cart-line resolution, stock + address validation
//   checkout/memory-store.ts — the in-memory (preview-only) order store

export { STANDARD_DELIVERY_POISHA, applyPaymentOutcome, adapterStatusToOutcome, computeCheckoutTotals, computeCheckoutTotalsFromLines, computeTotals, createOrderNumber, outcomeToAdapterStatus, paymentQueryToOutcome, toOrderSummary, type AdapterPaymentStatus, type CheckoutTotals, type OrderSummary, type PaymentOutcome } from "./orders/checkout/totals";
export { validateCoupon } from "./orders/checkout/coupons";
export { addressSchema, resolveCartLines, toAddressSnapshot, validateStock, type AddressInput, type CheckoutCartItem, type PlaceOrderInput, type PlaceOrderResult } from "./orders/checkout/validation";
export { createOrderRecord, getOrderRecord, listOrderRecords, updateOrderRecordStatus } from "./orders/checkout/memory-store";
