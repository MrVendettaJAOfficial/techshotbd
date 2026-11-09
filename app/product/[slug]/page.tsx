// Product detail page (server component). Fetches the product from
// the live Supabase catalogue when configured, renders the interactive
// detail client component, and lists related products below. A product
// that is missing or paused / draft is a 404. When Supabase is not
// configured, or a live lookup fails, the local seed catalogue is used
// instead, so the page keeps working.
//
// One catalogue fetch per visit: the product, the related products
// and the metadata all resolve from a single getCatalog() call (which
// is itself per-request cached in lib/supabase/catalog.ts). The page
// used to fetch the catalogue three times per visit — once for the
// product, once for related products (which re-fetched the whole
// list), and once more for metadata — so a product page cost up to
// six Supabase round trips; it now costs two (categories + products,
// in parallel).

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Product } from "../../../lib/data/catalog";
import { getCatalog } from "../../../lib/supabase/catalog";
import { relatedProducts } from "../../../lib/catalog-rules";
import { getCurrentUser } from "../../../lib/auth-server";
import { listProductReviews } from "../../../lib/reviews";
import ProductCard from "../../../components/ProductCard";
import ProductDetail from "../../../components/ProductGallery";

export const dynamic = "force-dynamic";

/**
 * Resolve one product by slug from one catalogue fetch: the exact
 * slug first, then the `<slug>-…` prefix — the live database uses
 * longer slugs than the seed catalogue for some products (live
 * `apple-iphone-16-pro-256gb-natural-titanium` vs seed
 * `apple-iphone-16-pro`), so a link using the shorter seed slug
 * still resolves instead of 404ing. The prefixed match takes the
 * alphabetically-first slug, exactly as the old per-product query
 * did (order by slug, limit 1). The catalogue only ever holds
 * active products, so a paused / draft product is a 404 here.
 */
async function resolveProduct(slug: string): Promise<Product | undefined> {
  const { products } = await getCatalog();
  const exact = products.find((p) => p.slug === slug);
  if (exact) return exact;
  const prefixed = products
    .filter((p) => p.slug.startsWith(`${slug}-`))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return prefixed[0];
}

async function resolveRelated(product: Product, n: number): Promise<Product[]> {
  const { products } = await getCatalog();
  return relatedProducts(products, product, n);
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

  // Real reviews only: the average, count and review list come from
  // the reviews table (listProductReviews), and anyone can read
  // them. Writing a review needs a signed-in user — the page checks
  // the session server-side and the detail component shows the form
  // only then. Either fetch failing shows "No reviews yet" rather
  // than invented numbers.
  const [reviews, signedIn] = await Promise.all([
    listProductReviews(product.slug).catch(() => null),
    getCurrentUser()
      .then((user) => user !== null)
      .catch(() => false),
  ]);

  return (
    <div className="mx-auto max-w-shell px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-brandDark">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-brandDark">
          Shop
        </Link>
        <span className="mx-2">/</span>
        <Link
          href={`/shop?category=${product.category}`}
          className="hover:text-brandDark"
        >
          {product.category}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text">{product.title}</span>
      </nav>

      <ProductDetail product={product} initialReviews={reviews} signedIn={signedIn} />

      <section className="mt-16">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-bold text-text">You may also like</h2>
          <Link href="/shop" className="shrink-0 text-sm font-semibold text-ink hover:underline">
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
