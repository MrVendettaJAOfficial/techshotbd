// Admin messages section (client component).
//
// The Messages tab of the admin dashboard: a compose form that
// sends a broadcast announcement to ALL signed-in users, and the
// list of sent messages, newest first, with delete.
//
// Sending and deleting go through the server actions in
// lib/announcements-server.ts, which enforce Owner / co-admin
// only (lib/roles.ts canSendBroadcasts) on every call — hiding
// the form here is presentation only, never the enforcement.
// A manager sees the sent list and a note that only the owner
// and co-admins can send. When Supabase is not configured, or
// migration 0009 has not been applied yet, sending is unavailable
// and the section says so instead of failing.
//
// After a send or a delete the handlers call router.refresh()
// so the list shows fresh server data — and that refresh
// remounts this section, wiping a notice kept only in React
// state (proven by the Playwright run, 2026-11-09). The section
// therefore uses the pending-notice pattern from AdminUsers /
// ProductManager (see pendingMessageNotice below): the notice is
// stored outside React state as well as in it, and the remounted
// component consumes it once. Dropping the refresh was tried
// first and did not help — the server action's
// revalidatePath("/admin") triggers the same remount on its own.
//
// Split from the dashboard shell like ./coupons-section: the tab
// shell lives in ./dashboard-shell, this section owns the compose
// form and the sent list. Colours come from the theme tokens only
// (no hard-coded colours), so the section follows the site theme.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  deleteAnnouncement,
  sendAnnouncement,
} from "@/lib/announcements-server";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementKindLabel,
  validateAnnouncementInput,
  type Announcement,
  type AnnouncementKind,
} from "@/lib/announcements";
import { Badge, Button, Card, Field, Input, SectionHeading, Select } from "@/components/ui";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// A notice left by the previous mount, consumed once below — the
// same pattern as AdminUsers' pendingUserNotice. After a send or a
// delete the handlers call router.refresh() so the list shows the
// new server data, and that refresh remounts this component,
// wiping plain React state: a notice kept only in state would
// never be seen (proven by the Playwright run, 2026-11-09).
let pendingMessageNotice: string | null = null;

export default function MessagesSection({
  announcements,
  canSend,
  configured,
}: {
  /** Sent announcements, newest first (from the server page). */
  announcements: Announcement[];
  /** True only for the Owner and co-admins (decided server-side). */
  canSend: boolean;
  /** False when Supabase is not configured (preview fallback). */
  configured: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<AnnouncementKind>("notification");
  const [error, setError] = useState<string | null>(null);
  // Initial state consumes a notice left by the previous mount (see
  // pendingMessageNotice above).
  const [notice, setNotice] = useState<string | null>(() => {
    const pending = pendingMessageNotice;
    pendingMessageNotice = null;
    return pending;
  });
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const validated = validateAnnouncementInput({ title, body, kind });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setSending(true);
    const result = await sendAnnouncement(validated.value).catch(() => ({
      ok: false as const,
      error: "Something went wrong. Please try again.",
    }));
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle("");
    setBody("");
    setKind("notification");
    // Stored outside React state as well as in it: the refresh
    // below remounts this component, so the notice would otherwise
    // never be seen (see pendingMessageNotice above).
    pendingMessageNotice = "Message sent to all users.";
    setNotice("Message sent to all users.");
    router.refresh();
  }

  async function handleDelete(id: string) {
    setError(null);
    setNotice(null);
    setDeletingId(id);
    const result = await deleteAnnouncement(id).catch(() => ({
      ok: false as const,
      error: "Something went wrong. Please try again.",
    }));
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Same pending-notice pattern as a send (see above).
    pendingMessageNotice = "Message deleted.";
    setNotice("Message deleted.");
    router.refresh();
  }

  return (
    <div>
      <SectionHeading
        title="Messages"
        description="Send a message to all users — a notification or an offer. It appears in every signed-in user's inbox."
      />

      {!configured && (
        <p role="status" className="mb-4 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-muted">
          Broadcasts need the live database. Migration 0009 has not been applied yet, so messages
          cannot be sent from here.
        </p>
      )}

      {canSend ? (
        <Card>
          <form onSubmit={(event) => { void handleSend(event); }} noValidate className="grid gap-3">
            <Field label="Title" htmlFor="announcement-title" required>
              <Input
                id="announcement-title"
                value={title}
                maxLength={ANNOUNCEMENT_TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Eid offer — 10% off all phones"
              />
            </Field>
            <Field label="Message" htmlFor="announcement-body" required>
              <textarea
                id="announcement-body"
                value={body}
                maxLength={ANNOUNCEMENT_BODY_MAX}
                rows={4}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write the message every user will see in their inbox."
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-50"
              />
            </Field>
            <Field label="Type" htmlFor="announcement-kind" required>
              <Select
                id="announcement-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as AnnouncementKind)}
              >
                <option value="notification">Notification</option>
                <option value="offer">Offer</option>
              </Select>
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={sending || !configured}>
                {sending ? "Sending…" : "Send to all users"}
              </Button>
              <p className="text-sm text-muted">
                {title.length}/{ANNOUNCEMENT_TITLE_MAX} title · {body.length}/{ANNOUNCEMENT_BODY_MAX} message
              </p>
            </div>
            {error ? (
              <p role="alert" className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm text-success">
                {notice}
              </p>
            ) : null}
          </form>
        </Card>
      ) : (
        <p role="status" className="mb-4 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-muted">
          Only the owner and co-admins can send messages. You can read the sent messages below.
        </p>
      )}

      <div className="mt-6 space-y-3">
        {announcements.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              No messages sent yet. Sent messages appear here, newest first, and in every
              user&apos;s inbox.
            </p>
          </Card>
        ) : (
          announcements.map((announcement) => (
            <Card key={announcement.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text">
                    {announcement.title}{" "}
                    <Badge tone={announcement.kind === "offer" ? "accent" : "brand"}>
                      {announcementKindLabel(announcement.kind)}
                    </Badge>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{announcement.body}</p>
                  <p className="mt-2 text-sm text-muted">{formatDateTime(announcement.createdAt)}</p>
                </div>
                {canSend && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={deletingId === announcement.id}
                    onClick={() => { void handleDelete(announcement.id); }}
                  >
                    {deletingId === announcement.id ? "Deleting…" : "Delete"}
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
