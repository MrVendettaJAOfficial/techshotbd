"use client";

// Seller-added products, shown on the shop page.
//
// The base catalogue is rendered on the server from lib/data/catalog.
// Seller-added products live in the demo store (lib/demo-store, browser
// localStorage) until Supabase is connected, so they are merged here on
// the client. When the Supabase-backed catalogue lands, seller products
// come from the database instead and this section is removed.
import { useEffect, useState } from "react";
import type { Product } from "../lib/data/catalog";
import { getSellerProductsOverride, type DemoProduct } from "../lib/demo-store";
import ProductCard from "./ProductCard";

function toProduct(p: DemoProduct): Product {
  return {
    slug: p.id,
    title: p.title,
    variant: p.description.slice(0, 60),
    price_poisha: p.pricePoisha,
    compare_at_poisha: p.pricePoisha,
    rating: 0,
    review_count: 0,
    stock: p.stock,
    category: p.category,
    brand: "TechShot seller",
    condition: "New",
    // Seller products have no photo until the seller uploads one to
    // Supabase Storage. This path does not exist, so ProductImage shows
    // its solid-colour initial-letter fallback instead of a wrong photo.
    image: "/images/products/not-uploaded.jpg",
    description: p.description,
    specs: {},
  };
}

export default function SellerProductsSection() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    const override = getSellerProductsOverride();
    const added = override.added
      .filter((p) => !p.paused && !override.removedIds.includes(p.id))
      .map(toProduct);
    setProducts(added);
  }, []);

  if (products.length === 0) return null;

  return (
    <section className="mt-12" aria-label="New from sellers">
      <h2 className="text-xl font-bold text-text">New from sellers</h2>
      <p className="mt-1 text-sm text-muted">
        Products added by approved sellers on TechShot.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.slug} product={product} />
        ))}
      </div>
    </section>
  );
}
