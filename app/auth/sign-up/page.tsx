// Sign-up page. Sign-up only ever creates a customer account —
// the admin role is never assignable from sign-up (see lib/auth),
// and there is no seller sign-up: TechShot is a single-seller
// store, the owner sells and manages products in /admin.
// Sign-up goes through Supabase Auth; if email confirmation is on,
// the account is created but the user must confirm by email first.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { AuthProvider, signUp, useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, SectionHeading } from "@/components/ui";

const formSchema = z.object({
  displayName: z.string().trim().min(2, "Please enter your name (at least 2 characters)."),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.literal("customer"),
});

function SignUpForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ displayName?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const parsed = formSchema.safeParse({ displayName, email, password, role: "customer" });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof typeof errors;
        next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await signUp(parsed.data);
      refresh();
      router.push("/account?signed_in=1");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign-up failed. Please try again.";
      // Email confirmation: the account was created, this is not a failure.
      if (message.startsWith("Please check your email")) {
        setNotice(message);
      } else {
        setFormError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <SectionHeading
        title="Create your TechShot account"
        description="Shop across Bangladesh with delivery nationwide."
      />
      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Full name" htmlFor="displayName" error={errors.displayName} required>
            <Input
              id="displayName"
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
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
          <Field
            label="Password"
            htmlFor="password"
            error={errors.password}
            hint="At least 8 characters."
            required
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {notice ? (
            <p role="status" className="rounded-lg border border-success/40 bg-success/15 px-3 py-2 text-sm text-success">
              {notice}
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="rounded-lg border border-[#b91c1c]/40 bg-[#b91c1c]/15 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? "Creating your account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-5 border-t border-border pt-5 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-medium text-ink hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <AuthProvider>
      <SignUpForm />
    </AuthProvider>
  );
}
