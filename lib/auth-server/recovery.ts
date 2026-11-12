// TechShot marketplace — one-time password-recovery marker.
//
// SERVER ONLY. This file is a server-actions module ("use server"):
// it is imported by the client auth module (lib/auth.ts) and by the
// reset-password and auth-callback pages, exactly like the other
// lib/auth-server/* modules.
//
// Why this exists (audit run-1 finding #10, "reset-password page
// changes the password for any signed-in session"): the reset page
// used to show its form for ANY live session, and
// updatePasswordAfterReset called supabase.auth.updateUser with no
// proof the session came from a recovery link. An ordinary
// signed-in user — or anyone holding a live session for the account
// — could change the password without knowing the current one.
//
// The fix records a one-time marker when a recovery code is
// exchanged, and requires + consumes it before any password change:
//
//   * exchangeAuthCode (lib/auth-server/session.ts) sets the marker
//     — a short-lived httpOnly cookie — when it exchanges a code
//     for type=recovery. The legacy implicit-flow branch of the auth
//     callback sets the same marker (no code is exchanged there).
//     The client cannot forge the marker: it is httpOnly, so browser
//     JavaScript cannot read or set it, and only these server
//     actions write it.
//   * hasRecoverySession() is the gate the reset page uses instead
//     of "is there any session". It returns true only for a session
//     established by a recovery exchange: the marker must be present
//     AND the session must still look like a recovery session.
//     The second half is GoTrue's `amr` claim — a recovery session
//     carries amr [{ method: "recovery" }] — and it only ever VETOES:
//     when the session positively identifies as an ordinary
//     (non-recovery) session, a stale marker left behind by an
//     abandoned reset is not enough. When the amr cannot be read
//     (Supabase unreachable, no amr on the session) the marker alone
//     decides, exactly as the cookie design prescribes; the marker
//     is never trusted without a live session check on consume.
//   * consumeRecoveryMarker() is called by updatePasswordAfterReset
//     before updateUser: it deletes the marker (single use — a
//     second call finds no marker) and returns ok only when the
//     marker was present. The reset page still signs the user out
//     after a successful reset, so the recovery session itself is
//     destroyed too.
//
// Ordinary signed-in users who want a new password go through
// changePassword (lib/auth.ts), which verifies the current
// password first.

"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "../supabase/server";

import { isRecoveryAmr } from "../password-rules";

// The cookie name and lifetime live in recovery-cookie.ts: a
// "use server" file may only export async functions, so constants
// cannot be exported from this file (the production build rejects
// them).
import { RECOVERY_COOKIE, RECOVERY_COOKIE_MAX_AGE_SECONDS } from "./recovery-cookie";

function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * Record the recovery marker: a random value in a short-lived
 * httpOnly cookie. Called server-side by the recovery exchange
 * (and by the auth callback's legacy implicit-flow branch). Never
 * throws: if the cookie cannot be set, the exchange itself has
 * already succeeded and the caller reports the sign-in as usual —
 * the reset page then shows its expired-link message and the user
 * requests a fresh link.
 */
export async function setRecoveryMarker(): Promise<void> {
  try {
    const store = cookies();
    store.set(RECOVERY_COOKIE, randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // Cookie store unavailable in this context — see above.
  }
}

function hasMarker(): boolean {
  try {
    return Boolean(cookies().get(RECOVERY_COOKIE)?.value);
  } catch {
    return false;
  }
}

/**
 * The session's recovery assurance, as one of three states:
 *   "recovery"     — the live session's amr includes recovery;
 *   "not-recovery" — the live session positively identifies as an
 *                     ordinary (non-recovery) session;
 *   "unverifiable" — the session's amr cannot be read (Supabase
 *                     unreachable, or the session carries no amr).
 *                     The marker alone decides.
 */
async function recoveryAssurance(): Promise<"recovery" | "not-recovery" | "unverifiable"> {
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error) return "unverifiable";
    // No live session at all: definitely not a recovery session.
    if (!data.user) return "not-recovery";
    const amr = (data.user as { amr?: unknown }).amr;
    if (!Array.isArray(amr)) return "unverifiable";
    return isRecoveryAmr(amr) ? "recovery" : "not-recovery";
  } catch {
    return "unverifiable";
  }
}

/**
 * Server-verified recovery gate for the reset-password page.
 * True only when the one-time marker is present and the live
 * session does not contradict it: a marker left behind by an
 * abandoned reset does not open the form for an ordinary session
 * (the amr veto), and a recovery session with no marker — a link
 * exchanged before this fix, or a marker already consumed — shows
 * the expired-link message instead of a form that can only fail.
 */
export async function hasRecoverySession(): Promise<boolean> {
  if (!hasMarker()) return false;
  const assurance = await recoveryAssurance();
  if (assurance === "not-recovery") return false;
  return true;
}

/**
 * Consume the marker (single use). Returns ok only when the marker
 * was present and the live session did not contradict it — the
 * caller (updatePasswordAfterReset) must refuse the password change
 * otherwise. Consuming deletes the cookie, so a second call — a
 * double-click, a replayed request — finds no marker and fails.
 * Never throws: any failure reads back as "no usable marker".
 */
export async function consumeRecoveryMarker(): Promise<{ ok: boolean }> {
  try {
    if (!(await hasRecoverySession())) return { ok: false };
    try {
      cookies().delete(RECOVERY_COOKIE);
    } catch {
      // The marker could not be deleted; the gate above already
      // passed, so the consume still counts — the reset page signs
      // the user out immediately afterwards, destroying the session.
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
