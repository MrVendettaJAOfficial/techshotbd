// Set-new-password page (recovery flow).
//
// Reached from /auth/callback after a recovery link's code has
// been exchanged for a session (see lib/password-rules.ts for the
// full flow). The form sets the new password via
// updatePasswordAfterReset (supabase.auth.updateUser), then signs
// the user out — the recovery session must not linger — and sends
// them to sign-in with a success note (?reset=1).
//
// The form is gated on the server-verified recovery marker
// (hasRecoverySession in lib/auth-server/recovery.ts), NOT on "is
// there any live session": an ordinary signed-in user has no
// recovery marker, so landing here directly shows the expired-link
// message instead of a form that would change their password
// without the current one (audit #10). Such a user changes their
// password from their account's security settings, which verifies
// the current password first (changePassword).
//
// Landing here without a recovery marker (direct visit, expired or
// already-used link) shows an expired-link message with a link to
// request a fresh one, instead of a form that can only fail.
"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, updatePasswordAfterReset } from "@/lib/auth";
import { hasRecoverySession } from "@/lib/auth-server/recovery";
import { resetPasswordSchema, toFieldErrors } from "@/lib/password-rules";
import { Button, Card, Field, Input, SectionHeading } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Server-verified recovery gate: true only for a session
    // established by a recovery exchange. An ordinary signed-in
    // session has no recovery marker, so this is false for it — the
    // client-side "any session" check this replaced was the hole
    // (audit #10).
    void hasRecoverySession()
      .then((ok) => {
        if (cancelled) return;
        setHasSession(ok);
        setChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHasSession(false);
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await updatePasswordAfterReset(parsed.data);
      await signOut();
      router.push("/auth/sign-in?reset=1");
      router.refresh();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not change your password. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <SectionHeading
        title="Set a new password"
        description="Choose a new password for your TechShot account."
      />
      <Card>
        {checking ? (
          <p className="text-sm text-muted">Checking your reset link…</p>
        ) : !hasSession ? (
          <div>
            <p role="alert" className="text-sm text-text">
              This password reset link has expired or was already used.
            </p>
            <p className="mt-2 text-sm text-muted">
              Reset links work once and expire after one hour. Request a new one to continue.
            </p>
            <p className="mt-2 text-sm text-muted">
              Already signed in? Change your password from your{" "}
              <Link
                href="/account#security"
                className="font-medium text-brandDark hover:underline"
              >
                account security settings
              </Link>{" "}
              instead.
            </p>
            <p className="mt-4">
              <Link
                href="/auth/forgot-password"
                className="font-medium text-brandDark hover:underline"
              >
                Request a new reset link
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Field label="New password" htmlFor="password" error={errors.password} required>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="confirmPassword"
              error={errors.confirmPassword}
              required
            >
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
            {formError ? (
              <p role="alert" className="rounded-lg border border-[#b91c1c]/40 bg-[#b91c1c]/15 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? "Changing password…" : "Change password"}
            </Button>
          </form>
        )}
        <div className="mt-5 space-y-2 border-t border-border pt-5 text-center text-sm">
          <p>
            <Link href="/auth/sign-in" className="font-medium text-brandDark hover:underline">
              Back to sign-in
            </Link>
          </p>
        </div>
      </Card>
    </main>
  );
}
