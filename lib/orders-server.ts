// TechShot marketplace — server-side Supabase orders.
//
// The code moved to lib/orders/server/ (one job per file); this file
// is a thin barrel so every original import path keeps working:
//   server/create.ts   — createSupabaseOrder
//   server/list.ts     — listAdminOrders, listSupabaseOrders
//   server/status.ts   — updateSupabaseOrderStatus, getOrderStatusFromServer
//   server/callback.ts — updateSupabaseOrderFromCallback
//   server/reviews.ts  — submitSupabaseReview
//   server/shared.ts   — shared session / product / payment / audit helpers
//
// NOTE: this barrel deliberately has NO "use server" directive.
// Next.js only allows async-function exports in a "use server" file,
// so a barrel that re-exports actions would fail the build. The
// directive lives in the files where the actions are defined
// (server/*.ts); re-exporting them from here keeps them server actions.

export { createSupabaseOrder, type CreateSupabaseOrderResult } from "./orders/server/create";
export { listAdminOrders, listSupabaseOrders } from "./orders/server/list";
export { getOrderStatusFromServer, updateSupabaseOrderStatus } from "./orders/server/status";
export { updateSupabaseOrderFromCallback } from "./orders/server/callback";
export { submitSupabaseReview } from "./orders/server/reviews";
