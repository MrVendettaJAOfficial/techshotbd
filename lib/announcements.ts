// Announcement (admin broadcast) rules — TechShot.
//
// Pure module, no imports: the exact rules the server actions in
// lib/announcements-server.ts enforce and the admin Messages tab
// renders, so tests can import this file directly (Node strips the
// erasable types, as with lib/profile-rules.ts).
//
// A broadcast is a message from the store to ALL signed-in users:
// a notification (order / delivery / store news) or an offer
// (a discount or promotion). It lives in the `announcements`
// table (supabase/migrations/0009_announcements.sql — NOT applied
// live yet; see that file). There is no per-user targeting and no
// scheduling: a sent announcement is visible to every signed-in
// user in their inbox until it is deleted.

export type AnnouncementKind = "notification" | "offer";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  /** profiles.id of the staff member who sent it; null when unknown. */
  createdBy: string | null;
  createdAt: string;
}

export const ANNOUNCEMENT_KINDS: AnnouncementKind[] = [
  "notification",
  "offer",
];

export const ANNOUNCEMENT_KIND_LABELS: Record<AnnouncementKind, string> = {
  notification: "Notification",
  offer: "Offer",
};

/** Display label for an announcement kind; unknown values pass through. */
export function announcementKindLabel(kind: string): string {
  return (
    (ANNOUNCEMENT_KIND_LABELS as Record<string, string>)[kind] ?? kind
  );
}

export const ANNOUNCEMENT_TITLE_MAX = 200;
export const ANNOUNCEMENT_BODY_MAX = 2000;

/**
 * Validate a compose-form submission. Trims both fields; the title
 * must be 1–200 characters, the body 1–2000, and the kind one of
 * "notification" / "offer". The server action runs this same
 * check — the browser is never trusted.
 */
export function validateAnnouncementInput(input: {
  title: unknown;
  body: unknown;
  kind: unknown;
}):
  | {
      ok: true;
      value: { title: string; body: string; kind: AnnouncementKind };
    }
  | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (title.length === 0) return { ok: false, error: "Please enter a title." };
  if (title.length > ANNOUNCEMENT_TITLE_MAX) {
    return {
      ok: false,
      error: `The title must be ${ANNOUNCEMENT_TITLE_MAX} characters or fewer.`,
    };
  }
  if (body.length === 0) return { ok: false, error: "Please enter a message." };
  if (body.length > ANNOUNCEMENT_BODY_MAX) {
    return {
      ok: false,
      error: `The message must be ${ANNOUNCEMENT_BODY_MAX} characters or fewer.`,
    };
  }
  if (input.kind !== "notification" && input.kind !== "offer") {
    return { ok: false, error: "Please choose Notification or Offer." };
  }
  return { ok: true, value: { title, body, kind: input.kind } };
}
