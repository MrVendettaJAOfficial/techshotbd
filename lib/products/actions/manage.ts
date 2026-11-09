// TechShot marketplace — pause / activate / delete product actions.
//
// Pause (hide from shoppers) or re-activate a product, and
// delete a product. Owner / co-admin only for pause, any
// staff role for delete — see the staff gate in
// lib/products/actions/shared.ts.

"use server";

import type { ProductActionResult } from "../types";
import { productStatusSchema } from "../validation";
import {
  GENERIC_ERROR,
  adminClient,
  requireStaff,
  revalidateProductPages,
  writeAudit,
} from "./shared";

/** Pause (hide from shoppers) or re-activate a product. Owner / co-admin only. */
export async function setProductStatus(id: string, rawStatus: unknown): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const parsed = productStatusSchema.safeParse(rawStatus);
  if (!parsed.success) {
    return { ok: false, error: "Please choose a valid status." };
  }
  const status = parsed.data;

  const actor = await requireStaff("edit");
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const { data: existing, error: loadError } = await admin
    .from("products")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return { ok: false, error: "Product not found." };
  }

  const { error } = await admin.from("products").update({ status }).eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };
  await writeAudit(admin, user.id, "product.status", existing.id);

  revalidateProductPages(existing.slug);
  return { ok: true, slug: existing.slug };
}

/** Delete a product (images and variants cascade in the database). Owner / co-admin / manager. */
export async function deleteProduct(id: string): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const actor = await requireStaff("manage");
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const { data: existing, error: loadError } = await admin
    .from("products")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return { ok: false, error: "Product not found." };
  }

  const { error } = await admin.from("products").delete().eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };
  await writeAudit(admin, user.id, "product.delete", existing.id);

  revalidateProductPages(existing.slug);
  return { ok: true, slug: existing.slug };
}
