// Admin loading skeleton. Mirrors app/admin/page.tsx +
// app/admin/AdminDashboard.tsx — title, the Add-product form card,
// the product list, then the Orders / Coupons / Users sections — so
// navigating to /admin shows its shape instantly instead of a blank
// page while the middleware gate and the live data load.
// Solid colours only, no gradients, no emoji.
export default function Loading() {
  return (
    <main className="mx-auto max-w-shell px-4 py-8" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-border" />
      <div className="mt-2 h-4 w-80 animate-pulse rounded bg-border" />

      <div className="mb-10 mt-6 rounded-2xl border border-border bg-panel p-5">
        <div className="h-6 w-40 animate-pulse rounded bg-border" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-border" />
          ))}
          <div className="h-11 w-36 animate-pulse rounded-lg bg-border sm:col-span-2" />
        </div>
      </div>

      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-panel p-5">
            <div className="flex-1">
              <div className="h-5 w-64 animate-pulse rounded bg-border" />
              <div className="mt-2 h-4 w-48 animate-pulse rounded bg-border" />
            </div>
            <div className="h-9 w-20 animate-pulse rounded-lg bg-border" />
          </div>
        ))}
      </div>

      {[0, 1, 2].map((i) => (
        <section key={i} className="mt-10 rounded-2xl border border-border bg-panel p-5">
          <div className="h-6 w-32 animate-pulse rounded bg-border" />
          <div className="mt-4 h-16 animate-pulse rounded-xl bg-border" />
        </section>
      ))}
    </main>
  );
}
