// Forgot-password page.
//
// Asks for the account email and sends a recovery link via
// Supabase Auth (requestPasswordReset in lib/auth.ts). The link
// points at /auth/callback?type=recovery; the callback exchanges
// the code and sends the user to /auth/reset-password.
//
// The success message never says whether the email is registered:
// Supabase sends nothing for an unknown email, and saying so would
// let anyone probe which emails have accounts.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth";
import { forgotPasswordSchema, toFieldErrors } from "@/lib/password-rules";
import { Button, Card, Field, Input, SectionHeading } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(toFieldErrors(parsed.error).email ?? null);
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(parsed.data);
      setSent(true);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not send the reset email. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <SectionHeading
        title="Reset your password"
        description="Enter the email address for your TechShot account and we will send you a link to set a new password."
      />
      <Card>
        {sent ? (
          <div>
            <p role="status" className="text-sm text-text">
              If an account exists for <span className="font-semibold">{email}</span>, a
              password reset link is on its way. Please check your email (including the
              spam folder) — the link expires after one hour.
            </p>
            <p className="mt-4 text-sm text-muted">
              Did not get the email?{" "}
              <button
                type="button"
                className="font-medium text-brandDark hover:underline"
                onClick={() => setSent(false)}
              >
                Try again
              </button>
            </p>
            <p className="mt-2 text-sm">
              <Link href="/auth/sign-in" className="font-medium text-brandDark hover:underline">
                Back to sign-in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Field label="Email" htmlFor="email" error={emailError ?? undefined} required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {formError ? (
              <p role="alert" className="rounded-lg border border-[#b91c1c]/40 bg-[#b91c1c]/15 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
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
