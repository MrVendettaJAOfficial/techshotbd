// Homepage (server component): hero, trust strip, shop by category,
// trending row, flash deals with live countdown, brand partners, gaming
// collection, why choose us, digital subscriptions, and newsletter.

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Headphones,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Truck,
  Zap,
} from "lucide-react";
import { PRODUCTS } from "../lib/data/catalog";
import { getCatalog } from "../lib/supabase/catalog";
import { formatBDT } from "../lib/theme";
import ProductCard, { TrendingRow } from "../components/ProductCard";
import ProductImage from "../components/ProductImage";
import FlashCountdown from "../components/FlashCountdown";
import NewsletterForm from "../components/NewsletterForm";

const CATEGORY_ICONS: Record<string, typeof Smartphone> = {
  smartphones: Smartphone,
  laptops: Zap,
  audio: Headphones,
  wearables: Smartphone,
  camera: BadgeCheck,
  gaming: Zap,
  accessories: RefreshCcw,
  "smart-home": ShieldCheck,
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { products, categories, subscriptions, flashEndsAt } = await getCatalog();
  // Hero: the iPhone if it is in the live catalogue, else the first
  // active product. PRODUCTS[0] is only a last resort for an empty
  // catalogue, so the hero never renders without a product.
  const heroProduct =
    products.find((p) => p.slug === "apple-iphone-16-pro") ??
    products.find((p) => p.slug.startsWith("apple-iphone")) ??
    products[0] ??
    PRODUCTS[0];
  const trending = products.slice(0, 4);
  const flashProducts = products.filter((p) => p.flash).slice(0, 3);
  const categoryTiles = categories.slice(0, 8);
  const brands = ["Apple", "Samsung", "Sony", "Google", "Bose", "Logitech"];

  return (
    <div className="bg-surface">
      {/* Hero */}
      <section className="mx-auto max-w-shell px-4 pt-8">
        <div className="grid gap-6 rounded-3xl border border-border bg-panel p-6 sm:p-10 lg:grid-cols-2">
          <div className="flex flex-col justify-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brandDark">
              The Pro Collection
            </p>
            <h1 className="mt-3 text-4xl font-bold leading-tight text-text sm:text-5xl">
              Your next upgrade. Anything but ordinary.
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              Flagship phones, laptops and audio — 100% genuine, with official
              warranty and free delivery across Bangladesh on orders above ৳999.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link
                href="/shop"
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-inkLight"
              >
                Shop Now <ArrowRight size={16} />
              </Link>
              <p className="text-sm text-muted">
                <span className="font-semibold text-text">{heroProduct.title}</span>
                <span className="block">
                  starting {formatBDT(heroProduct.price_poisha)}
                </span>
              </p>
            </div>
            <div className="mt-8 flex items-center gap-3 text-sm text-muted">
              <span className="font-mono text-xs tracking-widest">01 / 03</span>
              <span className="h-1 w-8 rounded-full bg-brand" aria-hidden="true" />
              <span className="h-1 w-8 rounded-full bg-border" aria-hidden="true" />
              <span className="h-1 w-8 rounded-full bg-border" aria-hidden="true" />
            </div>
          </div>

          <div className="relative">
            <Link href={`/product/${heroProduct.slug}`}>
              <div className="overflow-hidden rounded-2xl border border-border">
                <ProductImage
                  src={heroProduct.image}
                  alt={heroProduct.title}
                  priority
                />
              </div>
            </Link>
            <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-2xl bg-ink/90 px-4 py-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brandDark text-white">
                <Zap size={20} />
              </span>
              <div>
                <p className="text-sm font-bold text-white">A18 Pro chip</p>
                <p className="text-xs text-mutedNavy">Fastest iPhone chip ever</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="mx-auto max-w-shell px-4 pt-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { icon: BadgeCheck, title: "Only original. Always.", text: "100% genuine products" },
            { icon: Truck, title: "Free shipping above ৳999", text: "Bangladesh-wide delivery" },
            { icon: ShieldCheck, title: "Official brand warranty", text: "On every product" },
            { icon: Headphones, title: "Real people. Real support.", text: "7 days a week" },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-2xl border border-border bg-panel p-4"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brandDark">
                <item.icon size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-text">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Shop by category */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text">Shop by category</h2>
            <p className="mt-1 text-sm text-muted">Find your next upgrade, faster.</p>
          </div>
          <Link href="/shop" className="shrink-0 text-sm font-semibold text-ink hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {categoryTiles.map((category) => {
            const Icon = CATEGORY_ICONS[category.slug] ?? Smartphone;
            return (
              <Link
                key={category.slug}
                href={`/shop?category=${category.slug}`}
                className="group rounded-2xl border border-border bg-panel p-5 transition hover:border-brand"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/15 text-brandDark transition group-hover:bg-brand group-hover:text-white">
                  <Icon size={22} />
                </span>
                <p className="mt-4 text-base font-semibold text-text">{category.name}</p>
                <p className="mt-0.5 text-xs text-muted">{category.tagline}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Trending now */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text">Trending now</h2>
            <p className="mt-1 text-sm text-muted">What Bangladesh is buying this week.</p>
          </div>
          <Link href="/shop" className="shrink-0 text-sm font-semibold text-ink hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-6">
          <TrendingRow products={trending} />
        </div>
      </section>

      {/* Flash deals */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <div className="rounded-3xl border-2 border-accentDark bg-panel p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accentDark">
                Limited time
              </p>
              <h2 className="mt-1 text-2xl font-bold text-text">Flash deals</h2>
              <p className="mt-1 text-sm text-muted">
                Big savings, while stock lasts.
              </p>
            </div>
            <FlashCountdown endsAt={flashEndsAt.getTime()} />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {flashProducts.map((product) => (
              <div key={product.slug}>
                <ProductCard product={product} />
                <div className="mt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accentDark"
                      style={{ width: `${Math.min(100, (product.stock / 30) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Selling fast · {product.stock} left
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Brand partners */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <h2 className="text-center text-sm font-semibold uppercase tracking-[0.2em] text-muted">
          Brand partners
        </h2>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {brands.map((brand) => (
            <span
              key={brand}
              className="rounded-full border border-border bg-panel px-5 py-2.5 text-sm font-bold text-text"
            >
              {brand}
            </span>
          ))}
        </div>
      </section>

      {/* Gaming collection */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-border bg-card p-6 sm:p-10 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brandDark">
              Gaming collection
            </p>
            <h2 className="mt-2 text-3xl font-bold text-text">Less lag. More legendary.</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              Controllers, headsets and consoles built for long sessions and
              close finishes — genuine, warranted and delivered to your door.
            </p>
          </div>
          <Link
            href="/shop?category=gaming"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-ink px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-inkLight"
          >
            Explore gaming <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Why choose us */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <h2 className="text-2xl font-bold text-text">Why choose TechShot</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Truck, title: "Delivery on us", text: "Free delivery on every order above ৳999, anywhere in Bangladesh." },
            { icon: BadgeCheck, title: "Genuine. Guaranteed.", text: "Every product is 100% original with official brand warranty." },
            { icon: RefreshCcw, title: "Upgrade at your pace", text: "Easy returns and 7-day replacement on defective items." },
            { icon: Headphones, title: "We've got your back.", text: "Real support from real people, before and after you buy." },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-border bg-panel p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/15 text-brandDark">
                <item.icon size={22} />
              </span>
              <p className="mt-4 text-base font-semibold text-text">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Digital subscriptions */}
      <section className="mx-auto max-w-shell px-4 pt-12">
        <h2 className="text-2xl font-bold text-text">Digital subscriptions</h2>
        <p className="mt-1 text-sm text-muted">
          Premium plans, delivered to your email within minutes.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {subscriptions.map((plan) => (
            <div
              key={plan.slug}
              className="flex flex-col rounded-2xl border border-border bg-panel p-6"
            >
              <p className="text-lg font-bold text-text">{plan.name}</p>
              <p className="mt-1 text-sm text-muted">{plan.tagline}</p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-text">
                  {formatBDT(plan.price_poisha)}
                </span>
                <span className="text-sm text-muted">{plan.period}</span>
              </p>
              <Link
                href={`/product/${plan.productSlug}`}
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-inkLight"
              >
                Get plan
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="mx-auto max-w-shell px-4 py-12">
        <div className="rounded-3xl border border-border bg-panel p-6 text-center sm:p-10">
          <h2 className="text-2xl font-bold text-text">Get the good drops first.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            New arrivals, flash deals and price drops — once a week, straight to
            your inbox.
          </p>
          <div className="mt-6 flex justify-center">
            <NewsletterForm />
          </div>
        </div>
      </section>
    </div>
  );
}
