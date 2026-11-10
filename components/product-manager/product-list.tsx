"use client";

// Product moderation list for the admin dashboard: status tabs
// (All / Live / Paused / Draft), the product rows with Pause /
// Activate and two-step Delete, and the empty states. Writes go
// through the server actions in lib/products/actions.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteProduct,
  setProductStatus,
} from "@/lib/products/actions";
import type { ProductListItem } from "@/lib/products/types";
import { canEditProducts, canManageProducts } from "@/lib/roles";
import { formatBDT } from "@/lib/theme";
import { Badge, Button, Card, EmptyState, SectionHeading } from "@/components/ui";
import TabBar from "@/components/TabBar";
import {
  PRODUCT_STATUS_TABS,
  countByStatus,
  filterByStatus,
} from "@/components/admin-helpers";
import { statusLabel, statusTone } from "./helpers";

export function ProductList({
  products,
  configured,
  canPublish,
  callerRole,
  onEdit,
  onDeleted,
}: {
  products: ProductListItem[];
  configured: boolean;
  canPublish: boolean;
  callerRole: string | null;
  /** Start editing a product (populates the form in ProductForm). */
  onEdit: (product: ProductListItem) => void;
  /** Called after a product is deleted, so the form can clear
   *  itself when the deleted product was the one being edited. */
  onDeleted?: (product: ProductListItem) => void;
}) {
  const router = useRouter();

  // Edit and pause / activate are available to every staff role
  // (owner, co-admin, manager — 2026-11-10 decision).
  const canEdit = canEditProducts(callerRole);
  const canManage = canManageProducts(callerRole);

  const [productFilter, setProductFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const productCounts = countByStatus(products, (product) => product.status);
  const filteredProducts = filterByStatus(products, productFilter, (product) => product.status);

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
    // The form owns the edit state: deleting the product being
    // edited clears the form (same as the old inline check).
    onDeleted?.(product);
    router.refresh();
  }

  return (
    <>
      <SectionHeading
        title="Product moderation"
        description="Every product in the catalogue, including drafts and paused products. Pause hides a product from shoppers; Delete removes it."
      />
      <TabBar
        tabs={PRODUCT_STATUS_TABS.map((tab) => ({
          ...tab,
          count: tab.id === "all" ? products.length : (productCounts[tab.id] ?? 0),
        }))}
        activeId={productFilter}
        ariaLabel="Filter products by status"
        onSelect={setProductFilter}
      />
      {rowError ? (
        <p role="alert" className="mb-4 mt-4 text-sm text-red-700">{rowError}</p>
      ) : null}
      {products.length === 0 ? (
        <EmptyState
          title="No products to moderate"
          description={
            configured
              ? "Add your first product with the form above."
              : "Live product data is not configured yet, so no products can be listed here."
          }
          className="mt-4"
        />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          title={`No ${productFilter === "active" ? "live" : productFilter} products`}
          description="No products currently have this status."
          className="mt-4"
        />
      ) : (
        <div className="mt-4 space-y-3">
          {filteredProducts.map((product) => (
            <Card key={product.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">
                    {product.title} <Badge tone={statusTone(product.status)}>{statusLabel(product.status)}</Badge>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formatBDT(product.pricePoisha)}
                    {product.compareAtPoisha !== null ? ` (was ${formatBDT(product.compareAtPoisha)})` : ""} · Stock: {product.stock} ·{" "}
                    {product.categoryName}
                  </p>
                  {product.description ? <p className="mt-1 text-sm text-muted">{product.description}</p> : null}
                  {product.variants.length > 0 ? (
                    <p className="mt-1 text-sm text-muted">
                      Variants:{" "}
                      {product.variants
                        .map((variant) => `${variant.name}${variant.priceTaka === null ? "" : ` (${formatBDT(Math.round(variant.priceTaka * 100))})`} × ${variant.stock}${variant.imagePath ? " · photo set" : ""}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Edit and Pause / Activate are shown to every
                      staff role (owner, co-admin, manager). */}
                  {canEdit ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => onEdit(product)} disabled={!configured}>
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
                    </>
                  ) : null}
                  {canManage ? (
                    confirmDeleteId === product.id ? (
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
                    )
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
