// Auth callback page.
//
// Supabase redirects here after email confirmation (or a magic link)
// with a `code` query parameter. The code is exchanged for a session
// server-side via the exchangeAuthCode Server Action in
// lib/auth-server.ts — the exchange must run on the server so the
// session cookies can be set — then the user is sent on.
//
// Which page they land on depends on the link type
// (lib/password-rules.ts getAuthCallbackDestination):
//   - recovery links (?type=recovery, from a forgot-password
//     request) go to /auth/reset-password to set a new password;
//   - everything else (sign-up confirmation, magic link) goes to
//     /account?signed_in=1, as before.
// The `type` arrives with the code: Supabase appends
// `&type=recovery` to the redirect URL, and the redirect URL we
// send with resetPasswordForEmail already carries `?type=recovery`
// itself, so the callback sees it either way.
//
// Fallback: an older / non-PKCE link arrives as a URL fragment
// (#access_token=...&type=recovery) instead of a code. The browser
// client is @supabase/ssr createBrowserClient, which defaults to
// PKCE flow — it never reads an implicit fragment into a session
// on its own. So the page establishes the session explicitly with
// setSession() from the fragment tokens (validated server-side via
// getUser) instead of waiting for a getSession() that would always
// come back empty. Without a code, a token, or a session, the user
// is sent to sign-in with a generic message.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeAuthCode } from "@/lib/auth-server";
import { setRecoveryMarker } from "@/lib/auth-server/recovery";
import { getAuthCallbackDestination, parseRecoveryHash } from "@/lib/password-rules";
import { createClient } from "@/lib/supabase/client";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = searchParams.get("code");
    const type = searchParams.get("type");
    if (code) {
      // The link type travels with the exchange: a recovery code
      // records the one-time recovery marker (see
      // lib/auth-server/session.ts), which the reset-password page
      // requires — an ordinary sign-in exchange never sets it.
      void exchangeAuthCode(code, type)
        .then(() => {
          router.replace(getAuthCallbackDestination(type));
          router.refresh();
        })
        .catch(() => {
          setError("Could not sign you in. Please try signing in again.");
        });
      return;
    }
    // No code: maybe a legacy implicit-flow link
    // (#access_token=...&type=recovery). The PKCE browser client
    // ignores that fragment, so establish the session explicitly
    // from its tokens (setSession validates the access token via
    // getUser and stores the session in the browser cookies).
    const { isRecovery, hasAccessToken } = parseRecoveryHash(window.location.hash);
    if (!hasAccessToken) {
      router.replace("/auth/sign-in");
      return;
    }
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const { data, error } = await createClient().auth.setSession({
          access_token: params.get("access_token") ?? "",
          refresh_token: params.get("refresh_token") ?? "",
        });
        if (error || !data.session) {
          setError("Could not sign you in. Please try signing in again.");
          return;
        }
        if (isRecovery) {
          // Same marker as the code exchange above, so the
          // reset-password gate accepts this legacy recovery
          // session too. A failure to set it only degrades to the
          // expired-link message — the user requests a fresh link.
          await setRecoveryMarker().catch(() => {});
        }
        router.replace(
          getAuthCallbackDestination(isRecovery ? "recovery" : null),
        );
        router.refresh();
      } catch {
        setError("Could not sign you in. Please try signing in again.");
      }
    })();
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
            <Link href="/auth/sign-in" className="font-medium text-brandDark hover:underline">
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
            <Link href="/" className="font-medium text-brandDark hover:underline">
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
