// Account security section (client component).
//
// Change password for the signed-in user: current password, new
// password, confirm new password. The current password is verified
// first (re-authentication via signInWithPassword) and only then is
// the password updated — see changePassword in lib/auth.ts. The
// validation rules live in lib/password-rules.ts.
//
// A signed-out visitor gets the sign-in prompt instead of a working
// form, matching the account page's signed-out behaviour.
//
// Split from app/account/page.tsx: the form lives here, the page
// keeps the account state and composes the sections. The section
// carries id="security" so the header dropdown can deep-link to
// /account#security.

"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { changePassword, type AppUser } from "@/lib/auth";
import { changePasswordSchema, toFieldErrors } from "@/lib/password-rules";
import { btnPrimary, errCls, inputCls, labelCls } from "./account-ui";

interface SecuritySectionProps {
  /** Signed-in user, if any — signed-out visitors see a prompt, not a form. */
  user: AppUser | null;
}

export default function SecuritySection({ user }: SecuritySectionProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setChanged(false);
    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await changePassword(parsed.data);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setChanged(true);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not change your password. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="security"
      className="mt-6 scroll-mt-20 rounded-2xl border border-border bg-panel p-5"
      aria-label="Security"
    >
      <h2 className="text-lg font-bold text-text">Security</h2>
      {!user ? (
        <div className="mt-3">
          <p className="text-sm text-muted">
            Sign in to change your password.
          </p>
          <Link href="/auth/sign-in" className={`${btnPrimary} mt-4`}>
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="currentPassword" className={labelCls}>
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Your current password"
              className={inputCls}
              autoComplete="current-password"
            />
            {errors.currentPassword && (
              <p className={errCls}>{errors.currentPassword}</p>
            )}
          </div>
          <div>
            <label htmlFor="newPassword" className={labelCls}>
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={inputCls}
              autoComplete="new-password"
            />
            {errors.newPassword && <p className={errCls}>{errors.newPassword}</p>}
          </div>
          <div>
            <label htmlFor="confirmNewPassword" className={labelCls}>
              Confirm new password
            </label>
            <input
              id="confirmNewPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your new password"
              className={inputCls}
              autoComplete="new-password"
            />
            {errors.confirmPassword && (
              <p className={errCls}>{errors.confirmPassword}</p>
            )}
          </div>
          {formError && (
            <p role="alert" className="text-sm text-red-700 sm:col-span-2">
              {formError}
            </p>
          )}
          {changed && (
            <p role="status" className="text-sm text-success sm:col-span-2">
              Your password has been changed.
            </p>
          )}
          <div className="sm:col-span-2">
            <button type="submit" className={btnPrimary} disabled={submitting}>
              {submitting ? "Changing password…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
