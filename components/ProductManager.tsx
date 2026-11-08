// TechShot marketplace — product manager (client component).
//
// Shared by the seller and admin dashboards: the Add / Edit form and
// the product list with Pause / Activate and Delete. All writes go
// through the server actions in lib/products/actions.ts, so changes
// land in Supabase and the public shop reflects them immediately
// (the actions revalidate "/", "/shop" and the product page).
//
// Solid colours only, no gradients, no emoji — same theme as the
// rest of the site.

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createProduct, deleteProduct, setProductStatus, updateProduct } from "@/lib/products/actions";
import { parseVariantsText } from "@/lib/products/validation";
import type { CategoryOption, ProductListItem, ProductStatus } from "@/lib/products/types";
import { formatBDT } from "@/lib/theme";
import { Badge, Button, Card, EmptyState, Field, Input, SectionHeading, Select } from "@/components/ui";

const inputBase =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-50";

function variantsToText(product: ProductListItem): string {
  return product.variants
    .map((variant) =>
      variant.priceTaka === null ? `${variant.name}::${variant.stock}` : `${variant.name}:${variant.priceTaka}:${variant.stock}`,
    )
    .join(", ");
}

function statusTone(status: ProductStatus): "success" | "warning" | "muted" {
  if (status === "active") return "success";
  if (status === "paused") return "warning";
  return "muted";
}

function statusLabel(status: ProductStatus): string {
  if (status === "active") return "Live";
  if (status === "paused") return "Paused";
  return "Draft";
}

interface ProductManagerProps {
  products: ProductListItem[];
  categories: CategoryOption[];
  /** "seller" shows the seller wording; "admin" the moderation wording. */
  mode: "seller" | "admin";
  /** False for a seller waiting for approval: the form is disabled. */
  canPublish: boolean;
  /** False when Supabase is not configured: the form is disabled. */
  configured: boolean;
}

export default function ProductManager({ products, categories, mode, canPublish, configured }: ProductManagerProps) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [description, setDescription] = useState("");
  const [priceTaka, setPriceTaka] = useState("");
  const [compareAtTaka, setCompareAtTaka] = useState("");
  const [stock, setStock] = useState("");
  const [status, setStatus] = useState<ProductStatus>("draft");
  const [imagePath, setImagePath] = useState("");
  const [variantsText, setVariantsText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const formDisabled = !configured || !canPublish;
  const editingProduct = editingId ? products.find((product) => product.id === editingId) ?? null : null;

  function resetForm(): void {
    setTitle("");
    setCategorySlug("");
    setDescription("");
    setPriceTaka("");
    setCompareAtTaka("");
    setStock("");
    setStatus("draft");
    setImagePath("");
    setVariantsText("");
    setEditingId(null);
    setFormError(null);
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
    setImagePath(product.imagePath ?? "");
    setVariantsText(variantsToText(product));
    setFormError(null);
    setFormNotice(null);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    let variants: Array<{ name: string; priceTaka?: number; stock: number }> = [];
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
      imagePath,
      variants,
    };
    setSaving(true);
    const result = editingId ? await updateProduct(editingId, input) : await createProduct(input);
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    const savedTitle = input.title;
    resetForm();
    setFormNotice(
      editingId
        ? `"${savedTitle}" was updated.`
        : `"${savedTitle}" was added. It is now live in the shop when its status is Live.`,
    );
    router.refresh();
  }

  async function handleToggleStatus(product: ProductListItem): Promise<void> {
    setRowError(null);
    setBusyId(product.id);
    const next = product.status === "active" ? "paused" : "active";
    const result = await setProductStatus(product.id, next);
    setBusyId(null);
    if (!result.ok) {
      setRowError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(product: ProductListItem): Promise<void> {
    setRowError(null);
    setBusyId(product.id);
    const result = await deleteProduct(product.id);
    setBusyId(null);
    setConfirmDeleteId(null);
    if (!result.ok) {
      setRowError(result.error);
      return;
    }
    if (editingId === product.id) resetForm();
    router.refresh();
  }

  return (
    <div>
      <SectionHeading
        title={mode === "admin" ? "Add a product" : "Add a product"}
        description={
          mode === "admin"
            ? "Products added here are platform-owned and appear in the shop when their status is Live. Prices are in Bangladeshi Taka (৳)."
            : "Prices are in Bangladeshi Taka (৳). Stock is the number of units you have available."
        }
      />
      {!configured ? (
        <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text" role="alert">
          Live product data is not configured yet, so products cannot be added or changed here. Ask an admin to connect Supabase.
        </div>
      ) : null}
      {mode === "seller" && !canPublish && configured ? (
        <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text" role="alert">
          Your seller account is waiting for admin approval. You can view your products below, but adding or publishing new products is disabled until an admin approves your account.
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
              label="Image path"
              htmlFor="product-image"
              hint="A storage path such as /images/products/<slug>.jpg, or an https URL. Never a Figma link."
            >
              <Input id="product-image" value={imagePath} onChange={(e) => setImagePath(e.target.value)} placeholder="/images/products/example.jpg" disabled={formDisabled} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Variants"
              htmlFor="product-variants"
              hint='Optional. Comma-separated "Name:price:stock", e.g. "128GB:89900:10, 256GB:99900:5". Leave the price empty to use the product price.'
            >
              <Input id="product-variants" value={variantsText} onChange={(e) => setVariantsText(e.target.value)} placeholder="128GB:89900:10, 256GB:99900:5" disabled={formDisabled} />
            </Field>
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

      <SectionHeading
        title={mode === "admin" ? "Product moderation" : "Your products"}
        description={
          mode === "admin"
            ? "Every product in the catalogue, including drafts and paused products. Pause hides a product from shoppers; Delete removes it."
            : "Your products, live in the shop when their status is Live. Pause hides a product from shoppers; Edit changes it in the shop."
        }
      />
      {rowError ? (
        <p role="alert" className="mb-4 text-sm text-[#f87171]">{rowError}</p>
      ) : null}
      {products.length === 0 ? (
        <EmptyState
          title={mode === "admin" ? "No products to moderate" : "No products yet"}
          description={
            configured
              ? "Add your first product with the form above."
              : "Live product data is not configured yet, so no products can be listed here."
          }
        />
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <Card key={product.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">
                    {product.title} <Badge tone={statusTone(product.status)}>{statusLabel(product.status)}</Badge>{" "}
                    {mode === "admin" && product.sellerId === null ? <Badge tone="brand">Platform</Badge> : null}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formatBDT(product.pricePoisha)}
                    {product.compareAtPoisha !== null ? ` (was ${formatBDT(product.compareAtPoisha)})` : ""} · Stock: {product.stock} ·{" "}
                    {product.categoryName}
                    {mode === "admin" && product.sellerId !== null ? " · Seller product" : ""}
                  </p>
                  {product.description ? <p className="mt-1 text-sm text-muted">{product.description}</p> : null}
                  {product.variants.length > 0 ? (
                    <p className="mt-1 text-sm text-muted">
                      Variants:{" "}
                      {product.variants
                        .map((variant) => `${variant.name}${variant.priceTaka === null ? "" : ` (${formatBDT(Math.round(variant.priceTaka * 100))})`} × ${variant.stock}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(product)} disabled={!configured}>
                    Edit
                  </Button>
                  {product.status !== "draft" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleToggleStatus(product)}
                      disabled={!configured || busyId === product.id || (product.status === "paused" && !canPublish)}
                    >
                      {product.status === "active" ? "Pause" : "Activate"}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleToggleStatus(product)}
                      disabled={!configured || busyId === product.id || !canPublish}
                    >
                      Activate
                    </Button>
                  )}
                  {confirmDeleteId === product.id ? (
                    <>
                      <Button variant="danger" size="sm" onClick={() => void handleDelete(product)} disabled={busyId === product.id}>
                        Confirm delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button variant="danger" size="sm" onClick={() => setConfirmDeleteId(product.id)} disabled={!configured}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
