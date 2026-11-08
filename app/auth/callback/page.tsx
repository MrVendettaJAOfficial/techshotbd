// Auth callback page.
//
// Supabase redirects here after email confirmation (or a magic link)
// with a `code` query parameter. The code is exchanged for a session
// server-side via the exchangeAuthCode Server Action in
// lib/auth-server.ts — the exchange must run on the server so the
// session cookies can be set — then the user is sent to /account.
// Without a code (or when the exchange fails) the user is sent to
// sign-in with a generic message.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeAuthCode } from "@/lib/auth-server";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = searchParams.get("code");
    if (!code) {
      router.replace("/auth/sign-in");
      return;
    }
    void exchangeAuthCode(code)
      .then(() => {
        router.replace("/account");
        router.refresh();
      })
      .catch(() => {
        setError("Could not sign you in. Please try signing in again.");
      });
  }, [router, searchParams]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      {error ? (
        <>
          <p className="text-lg font-semibold text-text">Sign-in did not complete</p>
          <p role="alert" className="mt-2 text-sm text-muted">
            {error}
          </p>
          <p className="mt-6">
            <Link href="/auth/sign-in" className="font-medium text-brand hover:underline">
              Go to sign-in
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="text-lg font-semibold text-text">Signing you in…</p>
          <p className="mt-2 text-sm text-muted">
            You will be redirected to your account shortly.
          </p>
          <p className="mt-6">
            <Link href="/" className="font-medium text-brand hover:underline">
              Go home now
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
          <p className="text-lg font-semibold text-text">Signing you in…</p>
        </main>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
