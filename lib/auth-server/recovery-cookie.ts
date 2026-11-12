// TechShot marketplace — password-recovery marker cookie details.
//
// One job: the name and lifetime of the one-time recovery marker
// cookie (audit run-1, finding #10). These live here, not in
// lib/auth-server/recovery.ts, because that file is a
// "use server" module and Next.js only allows async functions to
// be exported from such a file — exporting these constants there
// fails the production build. recovery.ts imports them from here.

/** Name of the one-time recovery marker cookie. */
export const RECOVERY_COOKIE = "techshot-recovery";

/** The marker lives one hour — the same window the reset page tells
 *  the user a reset link lasts. */
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 60 * 60;
