// Home-page loading skeleton (also the fallback for routes without
// their own loading.tsx). Mirrors the home layout in app/page.tsx —
// hero (two columns), trust strip, category tiles, trending product
// row — so navigation to / shows the shape of the page instantly
// instead of a blank page while the live catalogue loads.
// Solid colours only, no gradients, no emoji.
export default function Loading() {
  return (
    <div className="bg-surface" aria-label="Loading">
      <section className="mx-auto max-w-shell px-4 pt-8">
        <div className="grid gap-6 rounded-3xl border border-border bg-panel p-6 sm:p-10 lg:grid-cols-2">
          <div>
            <div className="h-3 w-32 animate-pulse rounded bg-border" />
            <div className="mt-4 h-10 w-full max-w-md animate-pulse rounded-lg bg-border" />
            <div className="mt-3 h-10 w-3/4 animate-pulse rounded-lg bg-border" />
            <div className="mt-4 h-4 w-full max-w-md animate-pulse rounded bg-border" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-border" />
            <div className="mt-6 flex gap-4">
              <div className="h-12 w-32 animate-pulse rounded-xl bg-border" />
              <div className="h-12 w-40 animate-pulse rounded-xl bg-border" />
            </div>
          </div>
          <div className="aspect-square animate-pulse rounded-2xl bg-border" />
        </div>
      </section>

      <section className="mx-auto max-w-shell px-4 pt-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-panel" />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-shell px-4 pt-12">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-border" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-panel" />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-shell px-4 pt-12">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-border" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-border bg-panel p-4">
              <div className="aspect-square animate-pulse rounded-lg bg-border" />
              <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-border" />
              <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-border" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
