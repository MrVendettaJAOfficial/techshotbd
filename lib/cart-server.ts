// Server-side cart actions for TechShot.
//
// The code moved to lib/cart/server/ (one job per file); this file
// is a thin barrel so every original import path keeps working:
//   server/lines.ts — getPricedCartLines
//   server/sync.ts  — getServerCart, syncCartItem, clearServerCart
//   server/shared.ts — shared session / product-resolution helpers
//
// NOTE: this barrel deliberately has NO "use server" directive.
// Next.js only allows async-function exports in a "use server" file,
// so a barrel that re-exports actions would fail the build. The
// directive lives in the files where the actions are defined
// (server/*.ts); re-exporting them from here keeps them server actions.

export { getPricedCartLines, type PricedCartLines } from "./cart/server/lines";
export { clearServerCart, getServerCart, syncCartItem, type SyncCartResult } from "./cart/server/sync";
