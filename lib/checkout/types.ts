// Shared order / checkout types and constants (lib/checkout-store.ts).
// One job: the types, storage keys, order timeline and Bangladesh
// division / district lists every cart, checkout and order flow uses.

export type DeliveryOption = "standard" | "express";
export type PaymentMethod = "card" | "bkash" | "nagad" | "cod" | "emi";
export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "returned";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "cancelled" | "refunded";

export interface OrderItem {
  productId: string;
  title: string;
  variant?: string;
  price_poisha: number;
  mrp_poisha: number;
  image?: string;
  quantity: number;
}

export interface Address {
  id: string;
  /** Supabase user id the address belongs to, or null for a guest
   *  address (audit #9): browser-local addresses are scoped to the
   *  account that created them, like orders. Absent on addresses
   *  saved before this field existed — they read back as guest
   *  addresses. */
  userId?: string | null;
  label?: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  address: string;
  area: string;
  division: string;
  district: string;
  city: string;
  isDefault: boolean;
}

export interface StoredOrder {
  id: string;
  orderNumber: string;
  items: OrderItem[];
  address: Address;
  delivery: DeliveryOption;
  paymentMethod: PaymentMethod;
  subtotal_poisha: number;
  savings_poisha: number;
  couponCode: string | null;
  couponDiscount_poisha: number;
  deliveryFee_poisha: number;
  total_poisha: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** Supabase user id of the signed-in buyer, or null for a guest
   *  order. The test-pay page checks this against the caller's
   *  session — a signed-in order can only be paid by its owner. */
  userId: string | null;
  /** Random per-order key for a guest (local) order, minted at
   *  checkout with crypto.randomUUID(). The guest proves ownership
   *  of the order by presenting this key (carried in the test-pay
   *  redirect URL and in the browser copy saved at checkout). Null
   *  for signed-in orders, where the session proves ownership. */
  buyerToken: string | null;
  /** How this order was cancelled, when it was cancelled from the order page: "live" means the server confirmed the live cancel (stock released), "local" means the browser copy only was cancelled. Persisted with the order — not kept in component state — because the cancel server action revalidates the order pages and that refresh remounts the order page, wiping transient notice state (proven by the Playwright mock run, 2026-11-08: the live cancel succeeded but no notice showed). Absent on orders never cancelled from the page. */
  cancelNotice?: "live" | "local";
  /** True when the payment went through a test adapter (card / bKash / Nagad / EMI). */
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  /** Supabase user id the profile belongs to, or null for a guest
   *  profile (audit #9). Absent on profiles saved before this
   *  field existed — they read back as guest profiles. */
  userId?: string | null;
  displayName: string;
  phone: string;
  email: string;
}

export interface WishlistItem {
  /** Supabase user id the wishlist entry belongs to, or null for a
   *  guest entry (audit #9). Absent on entries saved before this
   *  field existed — they read back as guest entries. */
  userId?: string | null;
  productId: string;
  title: string;
  price_poisha: number;
  mrp_poisha: number;
  image?: string;
}

/** A cart line saved for later: same shape as lib/cart-store's CartItem
 *  ({ slug, variant, quantity }) — prices are always re-derived from the
 *  catalog via getProduct, never stored here. */
export interface SavedItem {
  slug: string;
  variant?: string;
  quantity: number;
}

export const STORAGE_KEYS = {
  savedForLater: "techshot:saved-for-later",
  coupon: "techshot:coupon",
  orders: "techshot:orders",
  profile: "techshot:profile",
  addresses: "techshot:addresses",
  wishlist: "techshot:wishlist",
} as const;

/** Ordered fulfilment steps shown in the order timeline. */
export const ORDER_TIMELINE_STEPS: { key: OrderStatus; label: string }[] = [
  { key: "pending_payment", label: "Pending payment" },
  { key: "confirmed", label: "Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

/** Bangladesh divisions, with districts. No PIN code is used anywhere. */
export const DIVISIONS: string[] = [
  "Dhaka",
  "Chattogram",
  "Khulna",
  "Rajshahi",
  "Barishal",
  "Sylhet",
  "Rangpur",
  "Mymensingh",
];

export const DISTRICTS: Record<string, string[]> = {
  Dhaka: ["Dhaka", "Gazipur", "Narayanganj", "Tangail", "Faridpur", "Manikganj", "Munshiganj", "Kishoreganj", "Narsingdi", "Gopalganj"],
  Chattogram: ["Chattogram", "Cox's Bazar", "Cumilla", "Brahmanbaria", "Chandpur", "Noakhali", "Feni", "Lakshmipur", "Rangamati", "Bandarban", "Khagrachhari"],
  Khulna: ["Khulna", "Jashore", "Satkhira", "Bagerhat", "Chuadanga", "Kushtia", "Magura", "Meherpur", "Narail", "Jhenaidah"],
  Rajshahi: ["Rajshahi", "Bogura", "Pabna", "Sirajganj", "Natore", "Naogaon", "Chapainawabganj", "Joypurhat"],
  Barishal: ["Barishal", "Bhola", "Patuakhali", "Pirojpur", "Barguna", "Jhalokati"],
  Sylhet: ["Sylhet", "Moulvibazar", "Habiganj", "Sunamganj"],
  Rangpur: ["Rangpur", "Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Thakurgaon"],
  Mymensingh: ["Mymensingh", "Jamalpur", "Netrokona", "Sherpur"],
};
