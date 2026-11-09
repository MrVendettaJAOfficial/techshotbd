// Shared types + localStorage persistence for the TechShot cart,
// checkout, orders and account flows.
//
// The code moved to lib/checkout/ (one job per file); this file is
// a thin barrel so every original import path keeps working:
//   checkout/types.ts      — types, storage keys, timeline, divisions/districts
//   checkout/storage.ts    — localStorage helpers (saved-for-later, coupon,
//                            orders, profile, addresses, wishlist)
//   checkout/validation.ts — zod schemas validating stored orders

export { DISTRICTS, DIVISIONS, ORDER_TIMELINE_STEPS, STORAGE_KEYS, type Address, type DeliveryOption, type OrderItem, type OrderStatus, type PaymentMethod, type PaymentStatus, type Profile, type SavedItem, type StoredOrder, type WishlistItem } from "./checkout/types";
export { addAddress, addToWishlist, clearCouponCode, deleteAddress, getAddresses, getCouponCode, getDefaultAddress, getOrder, getProfile, getSavedForLater, getWishlist, listOrders, removeFromWishlist, removeSaved, saveAddresses, saveForLater, saveOrder, saveProfile, setCouponCode, updateAddress, updateOrderStatus } from "./checkout/storage";
export { storedOrderSchema, validateStoredOrders } from "./checkout/validation";
