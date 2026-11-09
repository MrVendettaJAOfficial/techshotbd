// Checkout form for TechShot.
//
// The form moved to components/checkout/ (one job per file); this
// file is a thin barrel so the existing import in
// app/checkout/page.tsx keeps working:
//   checkout/checkout-form.tsx — CheckoutForm (state, delivery, summary)
//   checkout/address-step.tsx  — Step 1 shipping address
//   checkout/payment-step.tsx  — Step 3 payment options
//   checkout/checkout-shared.ts — shared step type + form classes

export { default } from "@/components/checkout/checkout-form";
