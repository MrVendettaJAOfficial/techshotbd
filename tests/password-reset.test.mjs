// Forgot / reset / change password rule tests — TechShot.
//
// The validation schemas and the auth-callback routing rules live
// in lib/password-rules.ts (a pure module, no imports except zod),
// so these tests import the real rules directly — the same pattern
// as tests/profile.test.mjs and tests/account.test.mjs.
//
// The Supabase calls themselves (resetPasswordForEmail,
// updateUser, signInWithPassword) cannot run against the mock
// Supabase used by the e2e tests — it cannot send real email — so
// the wiring is pinned by source assertions: the call must exist,
// in the right file, in the right order (re-authentication before
// update), with the recovery redirect the callback expects.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildRecoveryRedirectTo,
  changePasswordSchema,
  forgotPasswordSchema,
  getAuthCallbackDestination,
  parseRecoveryHash,
  resetPasswordSchema,
  toFieldErrors,
} from "../lib/password-rules.ts";

function readSource(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// Forgot password: email validation.
// ---------------------------------------------------------------------------

test("forgot-password accepts a valid email and normalises it", () => {
  const parsed = forgotPasswordSchema.safeParse({ email: "  MD@Example.com " });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.email, "md@example.com");
});

test("forgot-password rejects a missing or invalid email", () => {
  assert.equal(forgotPasswordSchema.safeParse({ email: "" }).success, false);
  assert.equal(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success, false);
  assert.equal(forgotPasswordSchema.safeParse({ email: "md@" }).success, false);
  const parsed = forgotPasswordSchema.safeParse({ email: "not-an-email" });
  assert.match(
    parsed.error.issues[0].message,
    /valid email address/,
  );
});

// ---------------------------------------------------------------------------
// Reset password: new password + confirmation.
// ---------------------------------------------------------------------------

test("reset-password accepts a matching password of 8 or more characters", () => {
  const parsed = resetPasswordSchema.safeParse({
    password: "newpass1",
    confirmPassword: "newpass1",
  });
  assert.equal(parsed.success, true);
});

test("reset-password rejects a password shorter than 8 characters", () => {
  const parsed = resetPasswordSchema.safeParse({
    password: "short1",
    confirmPassword: "short1",
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /at least 8 characters/);
});

test("reset-password rejects mismatched confirmation", () => {
  const parsed = resetPasswordSchema.safeParse({
    password: "newpassword",
    confirmPassword: "different1",
  });
  assert.equal(parsed.success, false);
  const errors = toFieldErrors(parsed.error);
  assert.equal(errors.confirmPassword, "Passwords do not match.");
});

test("reset-password requires the confirmation field", () => {
  const parsed = resetPasswordSchema.safeParse({
    password: "newpassword",
    confirmPassword: "",
  });
  assert.equal(parsed.success, false);
  assert.equal(toFieldErrors(parsed.error).confirmPassword, "Please confirm your new password.");
});

// ---------------------------------------------------------------------------
// Change password: current + new + confirmation.
// ---------------------------------------------------------------------------

test("change-password accepts a valid current / new / confirm set", () => {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "oldpassword",
    newPassword: "brandnew12",
    confirmPassword: "brandnew12",
  });
  assert.equal(parsed.success, true);
});

test("change-password requires the current password", () => {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "",
    newPassword: "brandnew12",
    confirmPassword: "brandnew12",
  });
  assert.equal(parsed.success, false);
  assert.equal(
    toFieldErrors(parsed.error).currentPassword,
    "Please enter your current password.",
  );
});

test("change-password rejects a new password shorter than 8 characters", () => {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "oldpassword",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(parsed.success, false);
  assert.match(toFieldErrors(parsed.error).newPassword, /at least 8 characters/);
});

test("change-password rejects a mismatched confirmation", () => {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "oldpassword",
    newPassword: "brandnew12",
    confirmPassword: "brandnew13",
  });
  assert.equal(parsed.success, false);
  assert.equal(toFieldErrors(parsed.error).confirmPassword, "Passwords do not match.");
});

test("change-password rejects a new password identical to the current one", () => {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "samepass1",
    newPassword: "samepass1",
    confirmPassword: "samepass1",
  });
  assert.equal(parsed.success, false);
  assert.match(
    toFieldErrors(parsed.error).newPassword,
    /different from your current password/,
  );
});

// ---------------------------------------------------------------------------
// Recovery redirect + callback routing.
// ---------------------------------------------------------------------------

test("recovery redirect points at the auth callback marked as a recovery link", () => {
  assert.equal(
    buildRecoveryRedirectTo("https://techshot.example"),
    "https://techshot.example/auth/callback?type=recovery",
  );
  assert.equal(
    buildRecoveryRedirectTo("http://localhost:3000/"),
    "http://localhost:3000/auth/callback?type=recovery",
  );
});

test("callback sends recovery links to the set-new-password page", () => {
  assert.equal(getAuthCallbackDestination("recovery"), "/auth/reset-password");
});

test("callback sends every other link to the account page, as before", () => {
  assert.equal(getAuthCallbackDestination(null), "/account?signed_in=1");
  assert.equal(getAuthCallbackDestination("signup"), "/account?signed_in=1");
  assert.equal(getAuthCallbackDestination("magiclink"), "/account?signed_in=1");
  assert.equal(getAuthCallbackDestination(""), "/account?signed_in=1");
});

test("legacy implicit-flow recovery links are detected from the URL fragment", () => {
  const recovery = parseRecoveryHash("#access_token=abc&refresh_token=def&type=recovery");
  assert.equal(recovery.isRecovery, true);
  assert.equal(recovery.hasAccessToken, true);

  const other = parseRecoveryHash("#access_token=abc&type=signup");
  assert.equal(other.isRecovery, false);
  assert.equal(other.hasAccessToken, true);

  const none = parseRecoveryHash("");
  assert.equal(none.isRecovery, false);
  assert.equal(none.hasAccessToken, false);
});

// ---------------------------------------------------------------------------
// Wiring: the Supabase calls live in the right files, in the right order.
// ---------------------------------------------------------------------------

const authClient = readSource("lib/auth.ts");
const callbackPage = readSource("app/auth/callback/page.tsx");
const forgotPage = readSource("app/auth/forgot-password/page.tsx");
const resetPage = readSource("app/auth/reset-password/page.tsx");
const signInPage = readSource("app/auth/sign-in/page.tsx");
const securitySection = readSource("components/account/security-section.tsx");
const accountPage = readSource("app/account/page.tsx");

test("forgot-password sends the recovery email with the callback redirect", () => {
  assert.match(authClient, /resetPasswordForEmail/);
  assert.match(authClient, /buildRecoveryRedirectTo\(window\.location\.origin\)/);
  assert.match(forgotPage, /requestPasswordReset/);
  // The success message never reveals whether the email is registered.
  assert.match(forgotPage, /If an account exists for/);
});

test("reset-password page updates the password and signs the recovery session out", () => {
  assert.match(authClient, /updateUser\(\{\s*password/);
  assert.match(resetPage, /updatePasswordAfterReset/);
  assert.match(resetPage, /signOut\(\)/);
  assert.match(resetPage, /\/auth\/sign-in\?reset=1/);
  // No session (expired / already-used link) shows the expired
  // message instead of a form that can only fail.
  assert.match(resetPage, /has expired or was already used/);
  assert.match(resetPage, /\/auth\/forgot-password/);
});

test("change-password re-authenticates with the current password before updating", () => {
  assert.match(authClient, /signInWithPassword/);
  assert.match(authClient, /updateUser\(\{\s*password: parsed\.data\.newPassword/);
  const reauthAt = authClient.indexOf("signInWithPassword", authClient.indexOf("changePassword"));
  const updateAt = authClient.indexOf(
    "updateUser({ password: parsed.data.newPassword })",
  );
  assert.ok(reauthAt > -1 && updateAt > -1 && reauthAt < updateAt);
  assert.match(authClient, /Your current password is incorrect/);
  assert.match(securitySection, /changePassword/);
  assert.match(securitySection, /id="security"/);
});

test("callback routes recovery links to reset-password and keeps the old account route", () => {
  assert.match(callbackPage, /getAuthCallbackDestination\(type\)/);
  assert.match(callbackPage, /searchParams\.get\("type"\)/);
  assert.match(callbackPage, /parseRecoveryHash\(window\.location\.hash\)/);
  assert.match(callbackPage, /exchangeAuthCode\(code, type\)/);
});

test("sign-in page links to forgot-password and shows the reset success note", () => {
  assert.match(signInPage, /href="\/auth\/forgot-password"/);
  assert.match(signInPage, /Forgot password\?/);
  assert.match(signInPage, /searchParams\.get\("reset"\)/);
  assert.match(signInPage, /Your password has been changed/);
});

test("account page wires the security section and anchors wishlist + security", () => {
  assert.match(accountPage, /SecuritySection/);
  assert.match(accountPage, /<SecuritySection user=\{user\} \/>/);
  assert.match(accountPage, /id="wishlist"/);
  assert.match(securitySection, /id="security"/);
  // Signed-out visitors get a sign-in prompt, not a working form.
  assert.match(securitySection, /Sign in to change your password/);
  assert.match(securitySection, /!user/);
});

test("new password pages use the existing dark theme classes, no gradients, no emoji", () => {
  for (const source of [forgotPage, resetPage, securitySection]) {
    assert.equal(/gradient/i.test(source), false);
    assert.equal(/bg-panel|bg-surface|text-text|text-muted/.test(source), true);
  }
  // No emoji anywhere in the new or edited auth files.
  for (const source of [forgotPage, resetPage, callbackPage, signInPage, securitySection]) {
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(source), false);
  }
});
