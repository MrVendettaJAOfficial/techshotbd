// Admin orders section (client component).
//
// This file is a thin re-export barrel: the code moved to
// components/admin-orders/orders-list.tsx (list, status tabs and
// server-action handlers) and
// components/admin-orders/status-controls.tsx (per-order status
// selector, Advance, Cancel / Refund). Import paths are unchanged —
// import from "@/components/AdminOrders" as before.

"use client";

export { default, fromStoredOrder } from "./admin-orders/orders-list";
export type { ListedOrder } from "./admin-orders/orders-list";
