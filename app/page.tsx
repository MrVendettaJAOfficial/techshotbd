// Homepage (server component): hero banner carousel, trust strip,
// shop by category, trending row, flash deals with live countdown,
// brand partners, gaming collection, why choose us, digital
// subscriptions, and newsletter.
//
// STATIC: no `export const dynamic = "force-dynamic"` here — the page
// has no per-user data (getCatalog + listActiveBanners only, both
// shared-cache reads), so it prerenders at build time and serves
// from the edge with no function run and no database read at all.
// A product or banner write revalidates it on demand
// (revalidatePath("/") + the "catalog" / "banners" tags in
// lib/storefront-cache.ts), so an admin edit still shows
// immediately on the next visit. The flash countdown is a client
// component (components/FlashCountdown) and keeps ticking in the
// browser; the countdown end itself comes from the cached catalogue
// (see lib/supabase/catalog.ts earliestFlashEndsAt).

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
import { listActiveBanners } from "../lib/banners-server";
import { bannerToSlide, fallbackSlides } from "../lib/hero-slides";
import { formatBDT } from "../lib/theme";
import { HeroCarousel } from "../components/HeroCarousel";
import ProductCard, { TrendingRow } from "../components/ProductCard";
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

export default async function HomePage() {
  const [{ products, categories, subscriptions, flashEndsAt }, banners] = await Promise.all([
    getCatalog(),
    listActiveBanners(),
  ]);
  // Hero carousel: admin banners when at least one is active,
  // otherwise the top three products as slides (lib/hero-slides.ts)
  // — the home page never shows an empty hero. The local seed
  // PRODUCTS are the last resort for a genuinely empty live
  // catalogue; getCatalog() already falls back to them when
  // Supabase is not configured.
  const categoryNameFor = (slug: string): string =>
    categories.find((category) => category.slug === slug)?.name ?? slug;
  const heroSlides =
    banners.length > 0
      ? banners.map((banner) => bannerToSlide(banner))
      : fallbackSlides(products.length > 0 ? products : PRODUCTS, categoryNameFor);
  const trending = products.slice(0, 4);
  const flashProducts = products.filter((p) => p.flash).slice(0, 3);
  const categoryTiles = categories.slice(0, 8);
  const brands = ["Apple", "Samsung", "Sony", "Google", "Bose", "Logitech"];

  return (
    <div className="bg-surface">
      {/* Hero banner carousel — capped at 380px tall on desktop, so
          the banners stay a strip, not a full-viewport takeover. */}
      <section className="mx-auto max-w-shell px-4 pt-8">
        <HeroCarousel slides={heroSlides} />
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
          <Link href="/shop" className="shrink-0 text-sm font-semibold text-brandDark hover:underline">
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
          <Link href="/shop" className="shrink-0 text-sm font-semibold text-brandDark hover:underline">
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
              // The card stretches to the row height and the stock
              // meter sits at the bottom of the cell (flex-1 card +
              // mt-2 meter): titles wrap to different line counts,
              // and before this the meter sat at a different height
              // under each card instead of lining up across the row.
              // The meter is ONLY the visual bar — the card itself
              // already says "Selling fast · N left" under the price
              // (ProductCard, stock 12 or fewer), so repeating the
              // sentence below the card showed it twice per product.
              // The cards themselves are ProductCard — the same
              // 220px square thumbnails and mt-auto button as
              // everywhere else.
              <div key={product.slug} className="flex h-full flex-col">
                <div className="flex-1">
                  <ProductCard product={product} />
                </div>
                <div className="mt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accentDark"
                      style={{ width: `${Math.min(100, (product.stock / 30) * 100)}%` }}
                    />
                  </div>
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
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brandDark px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-brandDarker"
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
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-brandDark px-5 py-3 text-sm font-semibold text-white transition hover:bg-brandDarker"
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
