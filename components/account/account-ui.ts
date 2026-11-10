// Shared form + button styles for the account page sections.
//
// One place for the class strings the profile, addresses, orders
// and wishlist sections all use, so the sections stay in sync.
// Split from app/account/page.tsx with the section components.

export const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-text outline-none focus:border-brand";
export const labelCls = "mb-1 block text-sm font-medium text-text";
export const errCls = "mt-1 text-sm text-red-700";
export const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-brandDark px-5 py-3 font-semibold text-white transition hover:bg-brandDarker disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-text hover:border-brand";
