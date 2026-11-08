// TechShot marketplace — payment adapter interface.
// Every payment provider (test adapter now, a real gateway later) plugs
// in behind this interface, so checkout code never talks to a provider
// directly. Money is integer poisha (100 poisha = 1 BDT).
// No adapter may collect or store real card / bank details; the provider
// handles payment data on its own hosted page.

export type PaymentMethod = "card" | "bkash" | "nagad" | "cod" | "emi";

export type PaymentCallbackStatus = "paid" | "failed" | "cancelled";

export interface CreatePaymentInput {
  /** The order's database id (uuid). */
  id: string;
  orderNumber: string;
  total_poisha: number;
}

export interface CreatePaymentResult {
  /** Our payments-row id (or the provider's payment id once known). */
  paymentId: string;
  /** Where the customer is sent to complete the payment. */
  redirectUrl: string;
  /** The provider's reference for this payment attempt. */
  providerReference: string;
}

export interface VerifyCallbackResult {
  /** True only when the signature checks out and the payload is valid. */
  valid: boolean;
  /** The order id from the payload (empty string when it cannot be read). */
  orderId: string;
  status: PaymentCallbackStatus;
}

export interface RefundResult {
  ok: boolean;
}

export interface PaymentAdapter {
  createPayment(order: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyCallback(
    payload: unknown,
    signature: string,
  ): Promise<VerifyCallbackResult>;
  refund(paymentId: string, amount_poisha: number): Promise<RefundResult>;
}
