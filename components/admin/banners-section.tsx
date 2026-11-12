// Admin banners section (client component).
//
// The Banners tab of the admin dashboard: an add / edit form for
// the home-page hero carousel slides, and the list of banners,
// lowest sort_order first, with show / hide and delete.
//
// IMAGE-ONLY since the 2026-11-10 redesign: the carousel shows
// just the banner photo, so the form asks for a photo, a kind
// (Promotion / Offer) and the sort order — the promotion / offer
// text must be INSIDE the image itself. The headline, subcopy and
// button text are no longer shown anywhere.
//
// NOTE: the headline / subcopy / cta_label / cta_href columns are
// UNUSED for visible rendering since that redesign (kept in the
// database for existing rows, never dropped). The server derives
// the stored headline from the kind ("Promotion banner" / "Offer
// banner") — it is only the slide's alt text. Do not add form
// fields for them back.
//
// Adding, editing, toggling and deleting go through the server
// actions in lib/banners-server.ts, which enforce any-staff
// (lib/roles.ts canManageBanners) on every call — hiding the form
// here is presentation only, never the enforcement. When Supabase
// is not configured, or migration 0011 has not been applied yet,
// managing is unavailable and the section says so instead of
// failing.
//
// After a save, a toggle or a delete the handlers call
// router.refresh() so the list shows fresh server data — and that
// refresh remounts this section, wiping a notice kept only in
// React state (proven by the Playwright run, 2026-11-09, for the
// Messages tab). The section therefore uses the pending-notice
// pattern from MessagesSection / ProductManager (see
// pendingBannerNotice below): the notice is stored outside React
// state as well as in it, and the remounted component consumes it
// once. Dropping the refresh was tried first for Messages and did
// not help — the server action's revalidatePath("/admin") triggers
// the same remount on its own.
//
// Split from the dashboard shell like ./messages-section and
// ./coupons-section: the tab shell lives in ./dashboard-shell,
// this section owns the form and the list. Colours come from the
// theme tokens only (no hard-coded colours), so the section
// follows the site theme.

"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import {
  cleanupOrphanBannerPhotos,
  createBanner,
  deleteBanner,
  setBannerActive,
  updateBanner,
  uploadBannerImage,
} from "@/lib/banners-server";
import {
  BANNER_IMAGE_SIZE_NOTE,
  BANNER_KIND_LABELS,
  BANNER_KINDS,
  bannerImageSrc,
  validateBannerInput,
  type Banner,
  type BannerKind,
} from "@/lib/banners";
import { Badge, Button, Card, Field, Input, SectionHeading, Select } from "@/components/ui";
import ProductImage from "@/components/ProductImage";

// A notice left by the previous mount, consumed once below — the
// same pattern as MessagesSection's pendingMessageNotice. After a
// save, toggle or delete the handlers call router.refresh() so the
// list shows the new server data, and that refresh remounts this
// component, wiping plain React state: a notice kept only in state
// would never be seen.
let pendingBannerNotice: string | null = null;

export default function BannersSection({
  banners,
  canManage,
  configured,
}: {
  /** Every banner, lowest sort_order first (from the server page). */
  banners: Banner[];
  /** True for any staff role (decided server-side). */
  canManage: boolean;
  /** False when Supabase is not configured (preview fallback). */
  configured: boolean;
}) {
  const router = useRouter();

  const [imagePath, setImagePath] = useState("");
  const [kind, setKind] = useState<BannerKind>("promotion");
  const [sortOrder, setSortOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Initial state consumes a notice left by the previous mount (see
  // pendingBannerNotice above).
  const [notice, setNotice] = useState<string | null>(() => {
    const pending = pendingBannerNotice;
    pendingBannerNotice = null;
    return pending;
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formDisabled = !configured || !canManage;

  function resetForm(): void {
    setImagePath("");
    setKind("promotion");
    setSortOrder("0");
    setActive(true);
    setEditingId(null);
    setError(null);
    setUploadError(null);
    setUploadNotice(null);
  }

  function startEdit(banner: Banner): void {
    setEditingId(banner.id);
    setImagePath(banner.imagePath);
    setKind(banner.kind);
    setSortOrder(String(banner.sortOrder));
    setActive(banner.active);
    setError(null);
    setNotice(null);
    setUploadError(null);
    setUploadNotice(null);
  }

  /** Upload the chosen photo straight to Storage and fill the
   *  returned filename into the image path. The file is uploaded
   *  immediately; the banners row is only written when the banner
   *  itself is saved, so uploading without saving leaves an
   *  unreferenced file in the bucket (harmless — never deleted
   *  automatically). */
  async function handleUpload(): Promise<void> {
    const input = fileInputRef.current;
    const files = input?.files;
    if (!files || files.length === 0) {
      setUploadError("Choose a photo to upload first.");
      return;
    }
    setUploadError(null);
    setUploadNotice(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("kind", kind);
    formData.append("banner", files[0]);
    const result = await uploadBannerImage(formData).catch(() => ({
      ok: false as const,
      error: "Something went wrong. Please try again.",
    }));
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    setImagePath(result.file);
    setUploadNotice("Photo uploaded. Save the banner to keep it.");
    if (input) input.value = "";
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const validated = validateBannerInput({
      imagePath,
      kind,
      sortOrder: Number(sortOrder),
      active,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setSaving(true);
    const result = editingId
      ? await updateBanner(editingId, validated.value).catch(() => ({
          ok: false as const,
          error: "Something went wrong. Please try again.",
        }))
      : await createBanner(validated.value).catch(() => ({
          ok: false as const,
          error: "Something went wrong. Please try again.",
        }));
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The stored headline is derived from the kind (see
    // lib/banners-server.ts) — it is the slide's alt text, and the
    // notice names the banner by it.
    const savedHeadline = `${BANNER_KIND_LABELS[validated.value.kind]} banner`;
    const message = editingId
      ? `Banner "${savedHeadline}" was updated.`
      : `Banner "${savedHeadline}" was added. It shows on the home page when it is active.`;
    resetForm();
    // Stored outside React state as well as in it: the refresh below
    // resets this section's state, so the notice would otherwise
    // never be seen (see pendingBannerNotice above).
    pendingBannerNotice = message;
    setNotice(message);
    router.refresh();
  }

  async function handleToggle(banner: Banner): Promise<void> {
    setError(null);
    setNotice(null);
    setTogglingId(banner.id);
    const result = await setBannerActive(banner.id, !banner.active).catch(() => ({
      ok: false as const,
      error: "Something went wrong. Please try again.",
    }));
    setTogglingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const message = banner.active
      ? `Banner "${banner.headline}" is now hidden from the home page.`
      : `Banner "${banner.headline}" is now showing on the home page.`;
    pendingBannerNotice = message;
    setNotice(message);
    router.refresh();
  }

  async function handleDelete(banner: Banner): Promise<void> {
    setError(null);
    setNotice(null);
    setDeletingId(banner.id);
    const result = await deleteBanner(banner.id).catch(() => ({
      ok: false as const,
      error: "Something went wrong. Please try again.",
    }));
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const message = `Banner "${banner.headline}" was deleted.`;
    pendingBannerNotice = message;
    setNotice(message);
    router.refresh();
  }

  // Remove banner photos in Storage that no banner row references
  // and that are older than a day (audit run-1, finding #13). The
  // sweep itself lives in lib/banners-server.ts; this only wires
  // the button to it and reports what it did. Photos uploaded
  // moments ago are never swept — a banner still being composed
  // keeps its photo.
  async function handleCleanupOrphans(): Promise<void> {
    setError(null);
    setNotice(null);
    setCleaning(true);
    const result = await cleanupOrphanBannerPhotos().catch(() => ({
      ok: false as const,
      error: "Something went wrong. Please try again.",
    }));
    setCleaning(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const message =
      result.removed > 0
        ? `Cleaned up ${result.removed} unused banner photo${result.removed === 1 ? "" : "s"} (${result.kept} kept).`
        : "No unused banner photos to clean up.";
    pendingBannerNotice = message;
    setNotice(message);
    router.refresh();
  }

  return (
    <div>
      <SectionHeading
        title="Banners"
        description="The slides of the home-page hero carousel, lowest sort order first. The carousel shows only the banner photo — put the promotion or offer text INTO the image itself; no headline, subcopy or button text is shown any more. When no banner is active, the home page shows the top products instead — it never shows an empty hero."
      />
      {!configured ? (
        <div className="mb-6 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-text" role="alert">
          Live banner data is not configured yet, so banners cannot be added or changed here. Ask an admin to connect Supabase.
        </div>
      ) : null}
      {configured && canManage ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-muted">
            Banner photos uploaded but never attached to a banner stay in Storage. Clean up removes ones no banner uses that are older than a day.
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleCleanupOrphans()}
            disabled={cleaning}
            data-testid="banner-cleanup-orphans"
          >
            {cleaning ? "Cleaning up…" : "Clean up unused banner photos"}
          </Button>
        </div>
      ) : null}
      <Card className="mb-10">
        <form onSubmit={handleSave} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Photo"
              htmlFor="banner-image-path"
              hint="A Supabase Storage filename such as banner-sale.jpg, a storage path such as /images/products/banner-sale.jpg, or an https URL. Leave it empty for the TechShot logo placeholder — a banner never shows a blank area."
            >
              <Input
                id="banner-image-path"
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                placeholder="e.g. banner-eid-sale.jpg (or leave empty)"
                disabled={formDisabled}
                data-testid="banner-image-path"
              />
            </Field>
            <div className="mt-3 rounded-xl border border-border bg-surface p-3">
              <p className="text-sm font-medium text-text">Upload a banner photo to Storage</p>
              <p className="mt-0.5 text-xs text-muted">
                {configured
                  ? "JPG, PNG or WebP, up to 5 MB. The filename is filled in above automatically."
                  : "Upload is unavailable until Supabase is connected."}
              </p>
              <p className="mt-1.5 text-xs text-muted" data-testid="banner-image-size-note">
                {BANNER_IMAGE_SIZE_NOTE}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={formDisabled || uploading}
                  aria-label="Choose a banner photo to upload"
                  data-testid="banner-upload-input"
                  className="max-w-full text-sm text-text file:mr-2 file:rounded-lg file:border file:border-border file:bg-panel file:px-3 file:py-2 file:text-sm file:font-medium file:text-text hover:file:border-brand disabled:opacity-50"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleUpload()}
                  disabled={formDisabled || uploading}
                  data-testid="banner-upload-button"
                >
                  <Upload size={15} className="mr-1.5" />
                  {uploading ? "Uploading…" : "Upload photo"}
                </Button>
              </div>
              {uploadError ? (
                <p role="alert" className="mt-2 text-sm text-red-700">{uploadError}</p>
              ) : null}
              {uploadNotice ? (
                <p role="status" className="mt-2 text-sm text-success">{uploadNotice}</p>
              ) : null}
            </div>
            {imagePath.trim() !== "" ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-border">
                <ProductImage src={bannerImageSrc({ imagePath })} alt={BANNER_KIND_LABELS[kind] + " banner"} />
              </div>
            ) : null}
          </div>
          <Field label="Kind" htmlFor="banner-kind" hint="Promotion or Offer — the badge the saved banner shows, and the alt text of the slide.">
            <Select
              id="banner-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as BannerKind)}
              disabled={formDisabled}
              data-testid="banner-kind"
            >
              {BANNER_KINDS.map((value) => (
                <option key={value} value={value}>
                  {BANNER_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort order" htmlFor="banner-sort-order">
            <Input
              id="banner-sort-order"
              type="number"
              min="0"
              step="1"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="0"
              disabled={formDisabled}
              data-testid="banner-sort-order"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text sm:col-span-2">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={formDisabled}
              data-testid="banner-active"
              className="h-4 w-4 accent-[#0B7A55]"
            />
            Active — show this banner on the home page
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-success sm:col-span-2">{notice}</p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={formDisabled || saving} data-testid="banner-save">
              {saving ? "Saving…" : editingId ? "Save changes" : "Add banner"}
            </Button>
            {editingId ? (
              <Button type="button" variant="ghost" onClick={resetForm} disabled={saving} data-testid="banner-cancel-edit">
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <SectionHeading title="Saved banners" description={`${banners.length} banner${banners.length === 1 ? "" : "s"} — lowest sort order first.`} />
      {banners.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No banners yet. The home page is showing the top products instead — add a banner above
            and it takes over the hero carousel.
          </p>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="banner-list">
          {banners.map((banner) => (
            <Card key={banner.id} data-testid="banner-item">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-text">
                    <Badge tone={banner.kind === "offer" ? "accent" : "brand"}>
                      {BANNER_KIND_LABELS[banner.kind]}
                    </Badge>{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${banner.active ? "bg-brand/15 text-brandDark" : "bg-panel text-muted"}`}>
                      {banner.active ? "Active" : "Hidden"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {banner.headline} · Order: {banner.sortOrder}
                    {banner.imagePath === "" ? " · No photo (logo placeholder)" : ` · Photo: ${banner.imagePath}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startEdit(banner)}
                    disabled={formDisabled}
                    data-testid="banner-edit"
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleToggle(banner)}
                    disabled={formDisabled || togglingId === banner.id}
                    data-testid="banner-toggle-active"
                  >
                    {togglingId === banner.id ? "Saving…" : banner.active ? "Hide" : "Show"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDelete(banner)}
                    disabled={formDisabled || deletingId === banner.id}
                    data-testid="banner-delete"
                  >
                    {deletingId === banner.id ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
