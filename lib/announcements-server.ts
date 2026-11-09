// TechShot marketplace — admin broadcast announcements.
//
// SERVER ACTIONS ("use server"). One job: the server-side reads and
// writes for the `announcements` table (migration 0009 — NOT
// applied live yet; until it is, every function below returns an
// empty list / a generic error and the Messages tab says broadcasts
// are unavailable, instead of failing the page).
//
// Enforcement is two layers, following the same pattern as
// lib/orders/actions.ts:
//   * Server action: the caller's profiles.role is re-read from the
//     database on every call (getCallerRole, never trusted from
//     the browser). Sending and deleting need lib/roles.ts
//     canSendBroadcasts — Owner ('admin') and co-admins only; a
//     manager is staff but may NOT send, and a customer calling
//     sendAnnouncement gets an error, never a silent success.
//     Listing for the admin tab needs isStaff.
//   * RLS (migration 0009): insert / delete policies allow only
//     is_admin() or is_co_admin(); every authenticated user may
//     SELECT. The service-role client below bypasses RLS, so the
//     role checks above are the enforcement point here — they
//     must never be removed.
//   * Input is validated by the pure rules in lib/announcements.ts
//     (title 1–200 chars, body 1–2000, kind notification / offer).
//
// The customer inbox read (listAnnouncementsForInbox) uses the
// request-scoped client, so the authenticated SELECT policy
// applies — the honest RLS path, not the service role. Errors
// returned to the client are generic on purpose: never a stack
// trace, SQL, or table name, and never which environment variable
// is missing when Supabase is not configured.

"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "./supabase/server";
import { getCallerRole, getCurrentUser } from "./auth-server";
import { canSendBroadcasts, isStaff } from "./roles";
import {
  validateAnnouncementInput,
  type Announcement,
  type AnnouncementKind,
} from "./announcements";

const ANNOUNCEMENT_GENERIC_ERROR = "Something went wrong. Please try again.";
const SEND_NOT_ALLOWED_ERROR = "Only the owner and co-admins can send messages.";

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/orders-server.ts),
 * so this file talks to the untyped client and casts rows to the
 * local shape below. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function isAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function mapRow(row: Record<string, unknown>): Announcement {
  const kind =
    row.kind === "offer" ? ("offer" as const) : ("notification" as const);
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    kind: kind as AnnouncementKind,
    createdBy: typeof row.created_by === "string" ? row.created_by : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

const ANNOUNCEMENT_COLUMNS = "id, title, body, kind, created_by, created_at";

/**
 * Every announcement, newest first, for the admin Messages tab.
 * Staff only (Owner, co-admin, manager): anyone else gets an
 * empty list. Empty when Supabase is not configured or migration
 * 0009 has not been applied yet.
 */
export async function listAnnouncements(): Promise<Announcement[]> {
  if (!isAdminConfigured()) return [];
  const role = await getCallerRole().catch(() => null);
  if (!isStaff(role)) return [];
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return [];
  }
  try {
    const { data, error } = await admin
      .from("announcements")
      .select(ANNOUNCEMENT_COLUMNS)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(mapRow);
  } catch {
    return [];
  }
}

/**
 * Every announcement, newest first, for the signed-in user's
 * inbox. Any signed-in user may read broadcasts (authenticated
 * SELECT policy); signed-out callers get an empty list. Read with
 * the request-scoped client so RLS applies. Empty when Supabase
 * is not configured or migration 0009 has not been applied yet.
 */
export async function listAnnouncementsForInbox(): Promise<Announcement[]> {
  if (!isConfigured()) return [];
  const user = await getCurrentUser().catch(() => null);
  if (!user) return [];
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select(ANNOUNCEMENT_COLUMNS)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(mapRow);
  } catch {
    return [];
  }
}

export type SendAnnouncementResult =
  | { ok: true; announcement: Announcement }
  | { ok: false; error: string };

/**
 * Send a broadcast to all users. Owner and co-admins only — a
 * manager or customer gets an error, never a silent success.
 * Revalidates /admin and /inbox so the message appears at once.
 */
export async function sendAnnouncement(input: {
  title: string;
  body: string;
  kind: string;
}): Promise<SendAnnouncementResult> {
  const validated = validateAnnouncementInput(input);
  if (!validated.ok) return { ok: false, error: validated.error };
  if (!isAdminConfigured()) return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: SEND_NOT_ALLOWED_ERROR };
  const role = await getCallerRole().catch(() => null);
  if (!canSendBroadcasts(role)) return { ok: false, error: SEND_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  }
  try {
    const { data, error } = (await admin
      .from("announcements")
      .insert({
        title: validated.value.title,
        body: validated.value.body,
        kind: validated.value.kind,
        created_by: user.id,
      })
      .select(ANNOUNCEMENT_COLUMNS)
      .single()) as {
      data: Record<string, unknown> | null;
      error: unknown;
    };
    if (error || !data) return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
    revalidatePath("/admin");
    revalidatePath("/inbox");
    return { ok: true, announcement: mapRow(data) };
  } catch {
    return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  }
}

export type DeleteAnnouncementResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Delete a sent broadcast. Owner and co-admins only — same gate
 * as sending. Revalidates /admin and /inbox.
 */
export async function deleteAnnouncement(
  id: string,
): Promise<DeleteAnnouncementResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  }
  if (!isAdminConfigured()) return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  const role = await getCallerRole().catch(() => null);
  if (!canSendBroadcasts(role)) return { ok: false, error: SEND_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  }
  try {
    const { error } = await admin
      .from("announcements")
      .delete()
      .eq("id", id);
    if (error) return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
    revalidatePath("/admin");
    revalidatePath("/inbox");
    return { ok: true };
  } catch {
    return { ok: false, error: ANNOUNCEMENT_GENERIC_ERROR };
  }
}
