// Shop listing (server component). Every control actually filters the
// catalog on the server via searchParams — nothing here is show-only:
// search (q), category pills, flash deals, price range, brand checkboxes,
// minimum rating, condition, in-stock only, sort, and pagination.

import Link from "next/link";
import { SearchX } from "lucide-react";
import { getCatalog } from "../../lib/supabase/catalog";
import ProductCard from "../../components/ProductCard";

const PAGE_SIZE = 9;

type SearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildHref(
  params: SearchParams,
  overrides: Record<string, string | string[] | undefined>,
): string {
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) next[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `/shop?${query}` : "/shop";
}

export const dynamic = "force-dynamic";

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const { products, categories } = await getCatalog();
  const categoryName = (slug: string): string =>
    categories.find((c) => c.slug === slug)?.name ?? slug;
  const q = (first(searchParams.q) ?? "").trim();
  const category = first(searchParams.category) ?? "";
  const flash = first(searchParams.flash) === "1";
  const selectedBrands = all(searchParams.brand);
  const minTaka = toNumber(first(searchParams.min));
  const maxTaka = toNumber(first(searchParams.max));
  const minRating = toNumber(first(searchParams.rating));
  const condition = first(searchParams.condition) ?? "";
  const inStockOnly = first(searchParams.inStock) === "1";
  const sort = first(searchParams.sort) ?? "featured";
  const page = Math.max(1, toNumber(first(searchParams.page)) ?? 1);

  // Brand counts across the full catalog.
  const brandCounts = new Map<string, number>();
  for (const p of products) {
    brandCounts.set(p.brand, (brandCounts.get(p.brand) ?? 0) + 1);
  }
  const brands = [...brandCounts.keys()].sort();

  let results = products.filter((p) => {
    if (flash && !p.flash) return false;
    if (category && p.category !== category) return false;
    if (q) {
      const haystack = [p.title, p.brand, p.variant, p.description, p.category]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q.toLowerCase())) return false;
    }
    if (selectedBrands.length > 0 && !selectedBrands.includes(p.brand)) return false;
    if (minTaka !== undefined && p.price_poisha < minTaka * 100) return false;
    if (maxTaka !== undefined && p.price_poisha > maxTaka * 100) return false;
    if (minRating !== undefined && p.rating < minRating) return false;
    if (condition && p.condition !== condition) return false;
    if (inStockOnly && p.stock <= 0) return false;
    return true;
  });

  if (sort === "price-asc") results = [...results].sort((a, b) => a.price_poisha - b.price_poisha);
  else if (sort === "price-desc") results = [...results].sort((a, b) => b.price_poisha - a.price_poisha);
  else if (sort === "rating") results = [...results].sort((a, b) => b.rating - a.rating || b.review_count - a.review_count);

  const total = results.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = results.slice(start, start + PAGE_SIZE);

  const activeCategory = category || "all";

  return (
    <div className="mx-auto max-w-shell px-4 py-8">
      <h1 className="text-3xl font-bold text-text">
        {flash ? "Flash deals" : q ? `Results for "${q}"` : category ? categoryName(category) : "Shop all"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {total} {total === 1 ? "product" : "products"}
        {flash ? " on flash deal" : ""}
      </p>

      {/* Category pills */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={buildHref(searchParams, { category: undefined, page: undefined })}
          className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
            activeCategory === "all" && !flash
              ? "border-brand bg-brand text-white"
              : "border-border bg-panel text-text hover:border-brand"
          }`}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={buildHref(searchParams, { category: c.slug, page: undefined, flash: undefined })}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              activeCategory === c.slug
                ? "border-brand bg-brand text-white"
                : "border-border bg-panel text-text hover:border-brand"
            }`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Filters — a GET form, so every control re-runs the server filter. */}
        <aside>
          <form method="get" action="/shop" className="space-y-6 rounded-2xl border border-border bg-panel p-5 lg:sticky lg:top-40">
            {q && <input type="hidden" name="q" value={q} />}
            {category && <input type="hidden" name="category" value={category} />}
            {flash && <input type="hidden" name="flash" value="1" />}

            <div>
              <h2 className="text-sm font-semibold text-text">Price (BDT)</h2>
              <div className="mt-3 flex items-center gap-2">
                <label className="sr-only" htmlFor="min-price">Minimum price</label>
                <input
                  id="min-price"
                  type="number"
                  name="min"
                  min={0}
                  placeholder="Min"
                  defaultValue={minTaka ?? ""}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none"
                />
                <span className="text-muted">–</span>
                <label className="sr-only" htmlFor="max-price">Maximum price</label>
                <input
                  id="max-price"
                  type="number"
                  name="max"
                  min={0}
                  placeholder="Max"
                  defaultValue={maxTaka ?? ""}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">Enter amounts in taka (৳).</p>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-text">Brand</h2>
              <ul className="mt-3 space-y-2">
                {brands.map((brand) => (
                  <li key={brand}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        name="brand"
                        value={brand}
                        defaultChecked={selectedBrands.includes(brand)}
                        className="h-4 w-4 accent-[#3b82f6]"
                      />
                      {brand}
                      <span className="ml-auto text-xs text-muted">
                        ({brandCounts.get(brand)})
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-text">Rating</h2>
              <div className="mt-3 space-y-2">
                {[
                  { value: "", label: "Any rating" },
                  { value: "4", label: "4.0 and up" },
                  { value: "4.5", label: "4.5 and up" },
                  { value: "4.8", label: "4.8 and up" },
                ].map((opt) => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                    <input
                      type="radio"
                      name="rating"
                      value={opt.value}
                      defaultChecked={(minRating?.toString() ?? "") === opt.value}
                      className="h-4 w-4 accent-[#3b82f6]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-text">Condition</h2>
              <div className="mt-3 space-y-2">
                {[
                  { value: "", label: "Any condition" },
                  { value: "New", label: "New" },
                  { value: "Refurbished", label: "Refurbished" },
                ].map((opt) => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                    <input
                      type="radio"
                      name="condition"
                      value={opt.value}
                      defaultChecked={condition === opt.value}
                      className="h-4 w-4 accent-[#3b82f6]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-text">
              <input
                type="checkbox"
                name="inStock"
                value="1"
                defaultChecked={inStockOnly}
                className="h-4 w-4 accent-[#3b82f6]"
              />
              In stock only
            </label>

            <div>
              <label htmlFor="sort" className="text-sm font-semibold text-text">
                Sort by
              </label>
              <select
                id="sort"
                name="sort"
                defaultValue={sort}
                className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand focus:outline-none"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="rating">Rating</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Apply filters
              </button>
              <Link
                href="/shop"
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text transition hover:border-brand"
              >
                Clear
              </Link>
            </div>
          </form>
        </aside>

        {/* Results */}
        <div>
          {pageItems.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-border bg-panel px-6 py-16 text-center">
              <SearchX size={40} className="text-muted" />
              <h2 className="mt-4 text-lg font-semibold text-text">No products found</h2>
              <p className="mt-1 max-w-sm text-sm text-muted">
                Try a different search, a wider price range, or clear the
                filters to see everything.
              </p>
              <Link
                href="/shop"
                className="mt-5 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Clear all filters
              </Link>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pageItems.map((product) => (
                  <ProductCard key={product.slug} product={product} />
                ))}
              </div>

              <div className="mt-8 flex flex-col items-center justify-between gap-4 sm:flex-row">
                <p className="text-sm text-muted">
                  Showing {total === 0 ? 0 : start + 1}–{Math.min(start + PAGE_SIZE, total)} of{" "}
                  {total} products
                </p>
                <nav aria-label="Pagination" className="flex items-center gap-2">
                  {currentPage > 1 ? (
                    <Link
                      href={buildHref(searchParams, { page: String(currentPage - 1) })}
                      className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium text-text hover:border-brand"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium text-muted opacity-50">
                      Previous
                    </span>
                  )}
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <Link
                      key={n}
                      href={buildHref(searchParams, { page: String(n) })}
                      aria-current={n === currentPage ? "page" : undefined}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                        n === currentPage
                          ? "border-brand bg-brand text-white"
                          : "border-border bg-panel text-text hover:border-brand"
                      }`}
                    >
                      {n}
                    </Link>
                  ))}
                  {currentPage < totalPages ? (
                    <Link
                      href={buildHref(searchParams, { page: String(currentPage + 1) })}
                      className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium text-text hover:border-brand"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium text-muted opacity-50">
                      Next
                    </span>
                  )}
                </nav>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
