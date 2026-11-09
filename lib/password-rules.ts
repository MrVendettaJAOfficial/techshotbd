// Password rules for TechShot — forgot / reset / change password.
//
// Pure module (no imports except zod): the validation schemas and
// the auth-callback routing rules live here so the pages in
// app/auth/*, the client auth helpers in lib/auth.ts and the
// account security section all share exactly the same rules, and so
// tests can import the real rules directly (same pattern as
// lib/profile-rules.ts and lib/account-rules.ts).
//
// Recovery flow (Supabase Auth, PKCE — the flow this app already
// uses for sign-up confirmation):
//   1. requestPasswordReset() calls resetPasswordForEmail with
//      redirectTo = buildRecoveryRedirectTo(origin), i.e.
//      <origin>/auth/callback?type=recovery.
//   2. Supabase emails a link; clicking it returns the user to that
//      URL with `?code=<one-time code>&type=recovery` appended
//      (Supabase appends both the code and type=recovery; the type
//      is also already in the redirectTo we sent, so the callback
//      sees it either way).
//   3. app/auth/callback exchanges the code server-side
//      (exchangeAuthCode) and routes with
//      getAuthCallbackDestination(type): recovery links go to
//      /auth/reset-password, everything else to /account.
//   4. /auth/reset-password runs while the recovery session is
//      live and calls updateUser({ password }).
//   Older / non-PKCE links instead arrive as a URL fragment
//   (#access_token=...&type=recovery); parseRecoveryHash() detects
//   those so the callback can still route them.

import { z } from "zod";

/** Minimum password length, matching the sign-up rule in lib/auth.ts. */
export const MIN_PASSWORD_LENGTH = 8;

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address.");

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Please enter your current password."),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "Your new password must be different from your current password.",
    path: ["newPassword"],
  });

/** Map a zod error to the per-field messages the forms display. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const next: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!next[key]) next[key] = issue.message;
  }
  return next;
}

/**
 * The redirect Supabase sends the recovery email link to: the auth
 * callback, marked as a recovery link so the callback can tell it
 * apart from a sign-up confirmation. The `type=recovery` marker is
 * part of the URL we send (not something we rely on Supabase to
 * add), and Supabase appends `?code=...` to it.
 */
export function buildRecoveryRedirectTo(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth/callback?type=recovery`;
}

/**
 * Where the auth callback sends the user after a successful code
 * exchange. Recovery links go to the set-new-password page; every
 * other link (sign-up confirmation, magic link) goes to the
 * account page, as before.
 */
export function getAuthCallbackDestination(type: string | null): string {
  return type === "recovery" ? "/auth/reset-password" : "/account?signed_in=1";
}

/**
 * Detect a legacy implicit-flow recovery link, which arrives as a
 * URL fragment instead of a `?code=` query parameter:
 * `#access_token=...&refresh_token=...&type=recovery`.
 */
export function parseRecoveryHash(hash: string): {
  isRecovery: boolean;
  hasAccessToken: boolean;
} {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  return {
    isRecovery: params.get("type") === "recovery",
    hasAccessToken: Boolean(params.get("access_token")),
  };
}
