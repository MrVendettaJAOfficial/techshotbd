// Profile creation rules — TechShot.
//
// Pure module, no imports: the exact rules the server actions in
// lib/auth-server.ts run, so tests/profile.test.mjs can import this
// file directly (Node strips the erasable types, as with
// lib/catalog-rules.ts).
//
// Background (bug fixed 2026-11-08): after sign-up with email
// confirmation on, signUp returns no session, so the old
// ensureProfile — which required a session for the same user id —
// threw, signUp swallowed the error, and no profiles row was ever
// created. The profile table then looked empty and the user could
// not be made admin. The fix has three layers, all using these
// rules:
//   1. a database trigger (supabase/migrations/0002_profile_trigger.sql)
//      creates the row when the auth.users row is inserted;
//   2. ensureCurrentUserProfile() (lib/auth-server.ts) creates a
//      missing row on every sign-in and on every session load;
//   3. sign-up still tries ensureProfile immediately when a session
//      exists (confirmation off).
//
// Single-seller store (2026-11-08): TechShot has one seller — the
// owner, who manages products in /admin. Sign-up / sign-in can only
// ever create role "customer". "admin" is never assigned here; it is
// only granted manually in the database. The old "seller" role no
// longer exists in the app: any "seller" value (e.g. a legacy
// user_metadata role, or a legacy profiles row created before this
// change) is sanitized to "customer" here, and the app never treats
// it as a selling account. The seller_profiles table still exists
// in the database as legacy/unused (see README) but nothing reads
// or writes it any more.

export type ProfileRole = "customer";

/** Every value sanitizes to "customer": "seller" and "admin" included. */
export function sanitizeProfileRole(_value: unknown): ProfileRole {
  return "customer";
}

/**
 * Display name from user_metadata, falling back to the email local
 * part, then to a generic name. Never returns a name shorter than
 * 2 characters (the profiles upsert requires at least 2).
 */
export function deriveDisplayName(
  metadata: Record<string, unknown> | null | undefined,
  email: string | null | undefined,
): string {
  const fromMetadata = metadata?.["display_name"];
  if (typeof fromMetadata === "string" && fromMetadata.trim().length >= 2) {
    return fromMetadata.trim();
  }
  const localPart = typeof email === "string" ? email.split("@")[0]?.trim() ?? "" : "";
  if (localPart.length >= 2) return localPart;
  return "TechShot customer";
}

export interface ProfileRow {
  id: string;
  display_name: string;
  role: ProfileRole;
}

/**
 * Build the profiles row for a user. Throws a generic error when the
 * user id is missing or no usable display name can be derived.
 * The role is always "customer": "admin" and "seller" can never come
 * out of here.
 */
export function buildProfileRow(
  userId: string,
  displayName: string,
  role: unknown,
): ProfileRow {
  const genericError = new Error("Could not create your profile. Please try again.");
  const cleanName = displayName.trim();
  if (!userId || cleanName.length < 2) throw genericError;
  return { id: userId, display_name: cleanName, role: sanitizeProfileRole(role) };
}

/**
 * Build the profiles row from a Supabase auth user: id + metadata +
 * email. This is the whole input sign-up returns even when email
 * confirmation is on and there is no session yet, so a profile that
 * could not be created at sign-up time can still be created on the
 * first sign-in — nothing about the user is lost in between.
 */
export function deriveProfileFromMetadata(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
  email: string | null | undefined,
): ProfileRow {
  return buildProfileRow(
    userId,
    deriveDisplayName(metadata, email),
    sanitizeProfileRole(metadata?.["role"]),
  );
}
