// Auth callback page.
//
// NOTE: this is a placeholder for the demo auth flow. When Supabase Auth
// is configured, this page is replaced by the real Supabase Auth callback
// (exchange the `code` query parameter for a session server-side, then
// redirect to /account). Until then it simply redirects home.
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setTimeout(() => router.replace("/"), 1500);
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <p className="text-lg font-semibold text-text">Signing you in…</p>
      <p className="mt-2 text-sm text-muted">
        You will be redirected to the TechShot home page shortly.
      </p>
      <p className="mt-6">
        <Link href="/" className="font-medium text-brand hover:underline">
          Go home now
        </Link>
      </p>
    </main>
  );
}
