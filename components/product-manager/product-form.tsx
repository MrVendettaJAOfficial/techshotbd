"use client";

// TechShot marketplace — product manager (client component).
//
// Used by the admin dashboard only (single-seller store: the owner
// manages every product in /admin). The Add / Edit form and the
// product list with Pause / Activate and Delete. All writes go
// through the server actions in lib/products/actions.ts, so changes
// land in Supabase and the public shop reflects them immediately
// (the actions revalidate "/", "/shop" and the product page).
//
// Solid colours only, no gradients, no emoji — same theme as the
// rest of the site.

// Split 2026-11-09: the moderation list lives in
// ./product-list.tsx and the shared helpers in ./helpers.ts.
// ProductForm owns the form state and the shared editing state
// (the list's Edit button populates this form through onEdit),
// so it renders ProductList below the form.

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Upload, X } from "lucide-react";

import {
  createProduct,
  updateProduct,
  uploadProductImages,
} from "@/lib/products/actions";
import { MAX_PRODUCT_IMAGES, parseVariantsText } from "@/lib/products/validation";
import type { CategoryOption, ProductListItem, ProductStatus } from "@/lib/products/types";
import { canManageProducts } from "@/lib/roles";
import { Button, Card, Field, Input, SectionHeading, Select } from "@/components/ui";
import { cleanSpecifications, type SpecificationRow } from "@/components/admin-helpers";
import { inputBase, variantsToText, type ProductManagerProps } from "./helpers";
import { ProductList } from "./product-list";

// The save confirmation must survive router.refresh(): refreshing the
// admin page re-renders the server tree and this form's state is
// reset — typed text is lost too (verified by probing: typing a
// title, then Pause/Activate on another product, clears the title).
// That is pre-existing behaviour, not caused by this form. The
// notice is therefore kept in module scope, which survives the
// remount, and is consumed once by the next mount's initial state —
// so the confirmation is still there after the product list
// refreshes. It is cleared on read, so navigating away and back
// never shows a stale notice.
let pendingSaveNotice: string | null = null;

export default function ProductForm({ products, categories, canPublish, configured, callerRole }: ProductManagerProps) {
  const router = useRouter();

  const canManage = canManageProducts(callerRole);

  const [title, setTitle] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [description, setDescription] = useState("");
  const [priceTaka, setPriceTaka] = useState("");
  const [compareAtTaka, setCompareAtTaka] = useState("");
  const [stock, setStock] = useState("");
  const [status, setStatus] = useState<ProductStatus>("draft");
  // Every photo for the product, in display order — the first is the
  // main photo. One row per photo; rows can be added, removed and
  // reordered, and photos can be uploaded straight to Storage (the
  // filenames are filled in automatically). Always at least one row,
  // even if it is empty: a product with no photos is allowed.
  const [imagePaths, setImagePaths] = useState<string[]>([""]);
  const [variantsText, setVariantsText] = useState("");
  // Warranty (one line of text) and specifications (a key/value
  // list) for the product. Both are optional; empty rows are
  // dropped on save, so a product with no specs stores none and
  // the product page honestly says so instead of inventing any.
  const [warranty, setWarranty] = useState("");
  const [specifications, setSpecifications] = useState<SpecificationRow[]>([{ key: "", value: "" }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Initial state consumes a save notice left by the previous mount
  // (see pendingSaveNotice above): after a save + refresh the form
  // remounts, and this is what makes the confirmation visible.
  const [formNotice, setFormNotice] = useState<string | null>(() => {
    const notice = pendingSaveNotice;
    pendingSaveNotice = null;
    return notice;
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formDisabled = !configured || !canPublish || !canManage;
  const editingProduct = editingId ? products.find((product) => product.id === editingId) ?? null : null;

  function resetForm(): void {
    setTitle("");
    setCategorySlug("");
    setDescription("");
    setPriceTaka("");
    setCompareAtTaka("");
    setStock("");
    setStatus("draft");
    setImagePaths([""]);
    setVariantsText("");
    setWarranty("");
    setSpecifications([{ key: "", value: "" }]);
    setEditingId(null);
    setFormError(null);
    setUploadError(null);
    setUploadNotice(null);
  }

  function startEdit(product: ProductListItem): void {
    setEditingId(product.id);
    setTitle(product.title);
    setCategorySlug(product.categorySlug ?? "");
    setDescription(product.description);
    setPriceTaka(String(product.pricePoisha / 100));
    setCompareAtTaka(product.compareAtPoisha === null ? "" : String(product.compareAtPoisha / 100));
    setStock(String(product.stock));
    setStatus(product.status);
    // The whole photo list, in display order; a product saved before
    // multi-photo support has one photo in `imagePath` only.
    setImagePaths(
      product.imagePaths.length > 0
        ? [...product.imagePaths]
        : product.imagePath
          ? [product.imagePath]
          : [""],
    );
    setVariantsText(variantsToText(product));
    setWarranty(product.warranty ?? "");
    setSpecifications(
      product.specifications.length > 0
        ? product.specifications.map((row) => ({ key: row.key, value: row.value }))
        : [{ key: "", value: "" }],
    );
    setFormError(null);
    setFormNotice(null);
    setUploadError(null);
    setUploadNotice(null);
  }

  function setSpecification(index: number, field: "key" | "value", value: string): void {
    setSpecifications((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  function addSpecificationRow(): void {
    setSpecifications((current) => [...current, { key: "", value: "" }]);
  }

  function removeSpecification(index: number): void {
    setSpecifications((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length === 0 ? [{ key: "", value: "" }] : next;
    });
  }

  function setPhoto(index: number, value: string): void {
    setImagePaths((current) => current.map((path, i) => (i === index ? value : path)));
  }

  function addPhotoRow(): void {
    setImagePaths((current) =>
      current.length >= MAX_PRODUCT_IMAGES ? current : [...current, ""],
    );
  }

  function removePhoto(index: number): void {
    setImagePaths((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length === 0 ? [""] : next;
    });
  }

  function movePhoto(index: number, direction: -1 | 1): void {
    setImagePaths((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }

  /** Upload the chosen files straight to Storage and fill the
   *  returned filenames into the photo list. The files are uploaded
   *  immediately; the product_images rows are only written when the
   *  product itself is saved, so uploading without saving leaves
   *  unreferenced files in the bucket (harmless — never deleted
   *  automatically). */
  async function handleUpload(): Promise<void> {
    const input = fileInputRef.current;
    const files = input?.files;
    if (!files || files.length === 0) {
      setUploadError("Choose photos to upload first.");
      return;
    }
    setUploadError(null);
    setUploadNotice(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("title", title);
    for (const file of Array.from(files)) formData.append("photos", file);
    const result = await uploadProductImages(formData);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    setImagePaths((current) => {
      const existing = current.map((path) => path.trim()).filter((path) => path !== "");
      return [...new Set([...existing, ...result.files])];
    });
    setUploadNotice(
      `Uploaded ${result.files.length} photo${result.files.length === 1 ? "" : "s"}. Save the product to keep them.`,
    );
    if (input) input.value = "";
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    let variants: Array<{ name: string; priceTaka?: number; stock: number; imagePath?: string }> = [];
    try {
      variants = parseVariantsText(variantsText);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Please check the variants and try again.");
      return;
    }
    const input = {
      title,
      categorySlug,
      description,
      priceTaka: Number(priceTaka),
      compareAtTaka: compareAtTaka.trim() === "" ? null : Number(compareAtTaka),
      stock: Number(stock),
      status,
      // The whole photo list, in display order — the first is the
      // main photo. Empty rows are dropped; duplicates are removed
      // server-side by mergeImagePaths.
      imagePaths: imagePaths.map((path) => path.trim()).filter((path) => path !== ""),
      variants,
      // Warranty text and the specifications list, for the product
      // page's warranty and specs tabs. Empty specs rows are dropped
      // by cleanSpecifications, so a product with no specs stores
      // an empty list. The actions take the raw input and validate
      // it with the product input schema (warranty / specifications
      // are optional there), so no cast is needed.
      warranty: warranty.trim(),
      specifications: cleanSpecifications(specifications),
    };
    setSaving(true);
    const result = editingId ? await updateProduct(editingId, input) : await createProduct(input);
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    const savedTitle = input.title;
    const notice = editingId
      ? `"${savedTitle}" was updated.`
      : `"${savedTitle}" was added. It is now live in the shop when its status is Live.`;
    resetForm();
    // Stored outside React state as well as in it: the refresh below
    // resets this form's state, so the notice would otherwise never
    // be seen (see pendingSaveNotice above).
    pendingSaveNotice = notice;
    setFormNotice(notice);
    router.refresh();
  }

  return (
    <div>
      <SectionHeading
        title="Add a product"
        description="Products added here are store-owned and appear in the shop when their status is Live. Prices are in Bangladeshi Taka (৳)."
      />
      {!configured ? (
        <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text" role="alert">
          Live product data is not configured yet, so products cannot be added or changed here. Ask an admin to connect Supabase.
        </div>
      ) : null}
      <Card className="mb-10">
        <form onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="product-title" required>
            <Input id="product-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product title" disabled={formDisabled} />
          </Field>
          <Field label="Category" htmlFor="product-category" required>
            <Select id="product-category" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} disabled={formDisabled}>
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price (৳)" htmlFor="product-price" required>
            <Input id="product-price" type="number" min="0" step="1" value={priceTaka} onChange={(e) => setPriceTaka(e.target.value)} placeholder="e.g. 1499" disabled={formDisabled} />
          </Field>
          <Field label="Compare-at price (৳)" htmlFor="product-compare-at">
            <Input id="product-compare-at" type="number" min="0" step="1" value={compareAtTaka} onChange={(e) => setCompareAtTaka(e.target.value)} placeholder="Optional, e.g. 1999" disabled={formDisabled} />
          </Field>
          <Field label="Stock" htmlFor="product-stock" required>
            <Input id="product-stock" type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="e.g. 25" disabled={formDisabled} />
          </Field>
          <Field label="Status" htmlFor="product-status" required>
            <Select id="product-status" value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)} disabled={formDisabled}>
              <option value="draft">Draft</option>
              <option value="active">Live</option>
              <option value="paused">Paused</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="product-description">
              <textarea
                id="product-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description for shoppers"
                disabled={formDisabled}
                rows={3}
                className={inputBase}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Photos"
              htmlFor="product-photo-0"
              hint="One row per photo, in display order — the first is the main photo. Each row takes a Supabase Storage filename such as <slug>.jpg, a storage path such as /images/products/<slug>.jpg, or an https URL. Never a Figma link."
            >
              <div className="space-y-2">
                {imagePaths.map((path, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      id={`product-photo-${index}`}
                      value={path}
                      onChange={(e) => setPhoto(index, e.target.value)}
                      placeholder={
                        index === 0
                          ? "Main photo — e.g. apple-iphone-16-pro.jpg"
                          : `Photo ${index + 1} — e.g. apple-iphone-16-pro-2.jpg`
                      }
                      disabled={formDisabled}
                      aria-label={index === 0 ? "Main photo" : `Photo ${index + 1}`}
                      data-testid={`product-photo-${index}`}
                    />
                    <button
                      type="button"
                      onClick={() => movePhoto(index, -1)}
                      disabled={formDisabled || index === 0}
                      aria-label={`Move photo ${index + 1} up`}
                      title="Move up"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(index, 1)}
                      disabled={formDisabled || index === imagePaths.length - 1}
                      aria-label={`Move photo ${index + 1} down`}
                      title="Move down"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronDown size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      disabled={formDisabled}
                      aria-label={`Remove photo ${index + 1}`}
                      title="Remove photo"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </Field>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPhotoRow}
                disabled={formDisabled || imagePaths.length >= MAX_PRODUCT_IMAGES}
                data-testid="add-photo-row"
              >
                Add another photo
              </Button>
              <span className="text-xs text-muted">
                {imagePaths.length >= MAX_PRODUCT_IMAGES
                  ? `At most ${MAX_PRODUCT_IMAGES} photos per product.`
                  : `${imagePaths.filter((path) => path.trim() !== "").length} photo${imagePaths.filter((path) => path.trim() !== "").length === 1 ? "" : "s"} set.`}
              </span>
            </div>
            <div className="mt-3 rounded-xl border border-border bg-surface p-3">
              <p className="text-sm font-medium text-text">Upload photos to Storage</p>
              <p className="mt-0.5 text-xs text-muted">
                {configured
                  ? "JPG, PNG or WebP, up to 5 MB each, at most 10 at a time. The filenames are filled in above automatically — no need to open the Supabase dashboard."
                  : "Upload is unavailable until Supabase is connected."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={formDisabled || uploading}
                  aria-label="Choose photos to upload"
                  data-testid="photo-upload-input"
                  className="max-w-full text-sm text-text file:mr-2 file:rounded-lg file:border file:border-border file:bg-panel file:px-3 file:py-2 file:text-sm file:font-medium file:text-text hover:file:border-brand disabled:opacity-50"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleUpload()}
                  disabled={formDisabled || uploading}
                  data-testid="photo-upload-button"
                >
                  <Upload size={15} className="mr-1.5" />
                  {uploading ? "Uploading…" : "Upload photos"}
                </Button>
              </div>
              {uploadError ? (
                <p role="alert" className="mt-2 text-sm text-[#f87171]">{uploadError}</p>
              ) : null}
              {uploadNotice ? (
                <p role="status" className="mt-2 text-sm text-success">{uploadNotice}</p>
              ) : null}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Variants"
              htmlFor="product-variants"
              hint='Optional. Comma-separated "Name:price:stock", e.g. "128GB:89900:10, 256GB:99900:5". Leave the price empty to use the product price. A variant photo is an optional fourth part — "Black Titanium::10:iphone-black.jpg" — a Storage filename, storage path or https URL, same rule as the image path above; the gallery shows that photo when the colour is selected.'
            >
              <Input id="product-variants" value={variantsText} onChange={(e) => setVariantsText(e.target.value)} placeholder="128GB:89900:10, Black Titanium::5:iphone-black.jpg" disabled={formDisabled} />
            </Field>
          </div>
          <Field label="Warranty" htmlFor="product-warranty">
            <Input
              id="product-warranty"
              value={warranty}
              onChange={(e) => setWarranty(e.target.value)}
              placeholder="e.g. 1-year official brand warranty"
              disabled={formDisabled}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Specifications"
              hint="Optional. One row per specification — a key and a value, shown on the product page's Specifications tab. Rows left blank are not saved."
            >
              <div className="space-y-2">
                {specifications.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) => setSpecification(index, "key", e.target.value)}
                      placeholder="e.g. Display"
                      disabled={formDisabled}
                      aria-label={`Specification ${index + 1} key`}
                    />
                    <Input
                      value={row.value}
                      onChange={(e) => setSpecification(index, "value", e.target.value)}
                      placeholder="e.g. 6.1-inch OLED"
                      disabled={formDisabled}
                      aria-label={`Specification ${index + 1} value`}
                    />
                    <button
                      type="button"
                      onClick={() => removeSpecification(index)}
                      disabled={formDisabled}
                      aria-label={`Remove specification ${index + 1}`}
                      title="Remove specification"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </Field>
            <div className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSpecificationRow}
                disabled={formDisabled}
                data-testid="add-specification-row"
              >
                Add a specification
              </Button>
            </div>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-[#f87171] sm:col-span-2">{formError}</p>
          ) : null}
          {formNotice ? (
            <p role="status" className="text-sm text-success sm:col-span-2">{formNotice}</p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={formDisabled || saving}>
              {saving ? "Saving…" : editingProduct ? "Save changes" : "Add product"}
            </Button>
            {editingProduct ? (
              <Button type="button" variant="ghost" onClick={resetForm} disabled={saving}>
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <ProductList
        products={products}
        configured={configured}
        canPublish={canPublish}
        callerRole={callerRole}
        onEdit={startEdit}
        onDeleted={(product) => {
          if (product.id === editingId) resetForm();
        }}
      />
    </div>
  );
}
