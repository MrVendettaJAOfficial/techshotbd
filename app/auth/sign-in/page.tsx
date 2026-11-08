// Sign-in page. Uses Supabase Auth (lib/auth); when Supabase is not
// configured, sign-in reports that it is unavailable.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { AuthProvider, signIn, useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, SectionHeading } from "@/components/ui";

const formSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password."),
});

function SignInForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = formSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await signIn(parsed.data);
      refresh();
      router.push("/account?signed_in=1");
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <SectionHeading
        title="Sign in to TechShot"
        description="Welcome back. Sign in to shop, sell, and track your orders."
      />
      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Email" htmlFor="email" error={errors.email} required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password} required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {formError ? (
            <p role="alert" className="rounded-lg border border-[#b91c1c]/40 bg-[#b91c1c]/15 px-3 py-2 text-sm text-[#f87171]">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="mt-5 space-y-2 border-t border-border pt-5 text-center text-sm">
          <p className="text-muted">
            No account yet?{" "}
            <Link href="/auth/sign-up" className="font-medium text-brand hover:underline">
              Create one
            </Link>
          </p>
          <p>
            <Link href="/shop" className="font-medium text-brand hover:underline">
              Continue as guest
            </Link>
          </p>
          <p className="text-xs text-muted">
            Admin access is granted manually in the database.
          </p>
        </div>
      </Card>
    </main>
  );
}

export default function SignInPage() {
  return (
    <AuthProvider>
      <SignInForm />
    </AuthProvider>
  );
}
