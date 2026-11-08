// Sign-up page. Roles offered here are customer and seller only — the
// admin role is never assignable from sign-up (see lib/auth). Seller
// accounts need admin approval before they can publish products.
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
  role: z.enum(["customer", "seller"]),
});

function SignUpForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"customer" | "seller">("customer");
  const [errors, setErrors] = useState<{ displayName?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const parsed = formSchema.safeParse({ displayName, email, password, role });
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
      router.push("/account");
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
        description="Shop across Bangladesh, or sell your products to customers nationwide."
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
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-text">
              Account type <span className="text-accent">*</span>
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`cursor-pointer rounded-lg border px-3 py-3 text-sm ${
                  role === "customer" ? "border-brand bg-brand/10 text-text" : "border-border bg-surface text-muted"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="customer"
                  checked={role === "customer"}
                  onChange={() => setRole("customer")}
                  className="sr-only"
                />
                <span className="block font-medium text-text">Customer</span>
                <span className="mt-0.5 block text-xs">Shop and order products.</span>
              </label>
              <label
                className={`cursor-pointer rounded-lg border px-3 py-3 text-sm ${
                  role === "seller" ? "border-brand bg-brand/10 text-text" : "border-border bg-surface text-muted"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="seller"
                  checked={role === "seller"}
                  onChange={() => setRole("seller")}
                  className="sr-only"
                />
                <span className="block font-medium text-text">Seller</span>
                <span className="mt-0.5 block text-xs">Sell on TechShot.</span>
              </label>
            </div>
          </fieldset>
          {role === "seller" ? (
            <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
              Seller accounts need admin approval before publishing products. You can sign in and
              set up your shop right away, but your products stay hidden from shoppers until an
              admin approves your account.
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="rounded-lg border border-[#5bd4a0]/40 bg-[#5bd4a0]/15 px-3 py-2 text-sm text-[#5bd4a0]">
              {notice}
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="rounded-lg border border-[#b91c1c]/40 bg-[#b91c1c]/15 px-3 py-2 text-sm text-[#f87171]">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? "Creating your account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-5 border-t border-border pt-5 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-medium text-brand hover:underline">
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
