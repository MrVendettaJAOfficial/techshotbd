// Product detail page (server component). Fetches the product from the
// live Supabase catalogue when configured, renders the interactive
// detail client component, and lists related products below. A product
// that is missing or paused / draft is a 404. When Supabase is not
// configured, or a live lookup fails, the local seed catalogue is used
// instead, so the page keeps working.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProduct, getRelated } from "../../../lib/data/catalog";
import type { Product } from "../../../lib/data/catalog";
import {
  getLiveProduct,
  getLiveRelated,
  isSupabaseConfigured,
} from "../../../lib/supabase/catalog";
import ProductCard from "../../../components/ProductCard";
import ProductDetail from "../../../components/ProductGallery";

export const dynamic = "force-dynamic";

/**
 * Resolve one product by slug: live (active only) when Supabase is
 * configured, local seed catalogue otherwise. A live query failure
 * falls back to the local catalogue rather than failing the page; a
 * live "not found" (missing or paused) stays a 404.
 */
async function resolveProduct(slug: string): Promise<Product | undefined> {
  if (!isSupabaseConfigured()) return getProduct(slug);
  try {
    return await getLiveProduct(slug);
  } catch (error) {
    console.warn(
      "TechShot: live product lookup failed, using local catalogue.",
      error instanceof Error ? error.message : error,
    );
    return getProduct(slug);
  }
}

async function resolveRelated(product: Product, n: number): Promise<Product[]> {
  if (!isSupabaseConfigured()) return getRelated(product, n);
  try {
    return await getLiveRelated(product, n);
  } catch (error) {
    console.warn(
      "TechShot: live related-products lookup failed, using local catalogue.",
      error instanceof Error ? error.message : error,
    );
    return getRelated(product, n);
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const product = await resolveProduct(params.slug);
  if (!product) return { title: "Product not found — TechShot" };
  return {
    title: `${product.title} — TechShot`,
    description: product.description,
  };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await resolveProduct(params.slug);
  if (!product) notFound();

  const related = await resolveRelated(product, 4);

  return (
    <div className="mx-auto max-w-shell px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-brand">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-brand">
          Shop
        </Link>
        <span className="mx-2">/</span>
        <Link
          href={`/shop?category=${product.category}`}
          className="hover:text-brand"
        >
          {product.category}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text">{product.title}</span>
      </nav>

      <ProductDetail product={product} />

      <section className="mt-16">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-bold text-text">You may also like</h2>
          <Link href="/shop" className="shrink-0 text-sm font-semibold text-brand hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {related.map((item) => (
            <ProductCard key={item.slug} product={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
