// Shop loading skeleton. Mirrors app/shop/page.tsx — title and
// result count, category pills, then the filters sidebar beside the
// product grid (9 cards on page one) — so navigating to /shop (or
// changing a filter) shows the shop's shape instantly instead of a
// blank page while the live catalogue loads.
// Solid colours only, no gradients, no emoji.
export default function Loading() {
  return (
    <div className="mx-auto max-w-shell px-4 py-8" aria-label="Loading">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-border" />
      <div className="mt-2 h-4 w-32 animate-pulse rounded bg-border" />

      <div className="mt-6 flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-panel" />
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="hidden rounded-2xl border border-border bg-panel p-5 lg:block">
          <div className="h-5 w-24 animate-pulse rounded bg-border" />
          <div className="mt-4 h-10 animate-pulse rounded-lg bg-border" />
          <div className="mt-6 h-5 w-20 animate-pulse rounded bg-border" />
          <div className="mt-3 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-border" />
            ))}
          </div>
          <div className="mt-6 h-5 w-20 animate-pulse rounded bg-border" />
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-border" />
            ))}
          </div>
          <div className="mt-6 h-11 animate-pulse rounded-xl bg-border" />
        </aside>

        <div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-panel p-4">
                <div className="aspect-square animate-pulse rounded-lg bg-border" />
                <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-border" />
                <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-border" />
                <div className="mt-3 h-5 w-1/3 animate-pulse rounded bg-border" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
