// Product-detail loading skeleton. Mirrors
// app/product/[slug]/page.tsx + components/ProductGallery.tsx —
// breadcrumb, then the gallery beside the info column (title, price,
// colour / storage selectors, quantity and buy buttons), then the
// tabs row — so opening a product shows its shape instantly instead
// of a blank page while the live product loads.
// Solid colours only, no gradients, no emoji.
export default function Loading() {
  return (
    <div className="mx-auto max-w-shell px-4 py-8" aria-label="Loading">
      <div className="h-4 w-64 animate-pulse rounded bg-border" />

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="aspect-square animate-pulse rounded-2xl bg-panel" />
          <div className="mt-3 flex gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 w-20 animate-pulse rounded-xl bg-panel" />
            ))}
          </div>
        </div>

        <div>
          <div className="h-4 w-40 animate-pulse rounded bg-border" />
          <div className="mt-3 h-8 w-full max-w-md animate-pulse rounded-lg bg-border" />
          <div className="mt-2 h-8 w-2/3 animate-pulse rounded-lg bg-border" />
          <div className="mt-4 h-5 w-48 animate-pulse rounded bg-border" />
          <div className="mt-5 h-9 w-44 animate-pulse rounded-lg bg-border" />
          <div className="mt-8 h-5 w-24 animate-pulse rounded bg-border" />
          <div className="mt-3 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 w-24 animate-pulse rounded-full bg-panel" />
            ))}
          </div>
          <div className="mt-6 h-5 w-24 animate-pulse rounded bg-border" />
          <div className="mt-3 flex gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 w-24 animate-pulse rounded-xl bg-panel" />
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <div className="h-12 w-32 animate-pulse rounded-xl bg-border" />
            <div className="h-12 flex-1 animate-pulse rounded-xl bg-border" />
            <div className="h-12 flex-1 animate-pulse rounded-xl bg-border" />
          </div>
          <div className="mt-6 h-24 animate-pulse rounded-2xl bg-panel" />
        </div>
      </div>

      <div className="mt-12 flex gap-2 border-b border-border pb-0">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 w-28 animate-pulse rounded-t-xl bg-panel" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-b-2xl bg-panel" />
    </div>
  );
}
