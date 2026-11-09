// Account loading skeleton. Mirrors app/account/page.tsx — title,
// signed-in user card, profile form, then the addresses / orders /
// wishlist sections — so navigating to /account shows its shape
// instantly instead of a blank page. The account data itself still
// loads client-side after mount (see lib/account-server.ts); the
// skeleton covers the navigation, not the data fetch.
// Solid colours only, no gradients, no emoji.
export default function Loading() {
  return (
    <main className="mx-auto max-w-[900px] px-4 py-10" aria-label="Loading">
      <div className="h-9 w-44 animate-pulse rounded-lg bg-border" />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-panel p-5">
        <div>
          <div className="h-6 w-44 animate-pulse rounded bg-border" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-border" />
          <div className="mt-2 h-4 w-28 animate-pulse rounded bg-border" />
        </div>
        <div className="h-10 w-24 animate-pulse rounded-lg bg-border" />
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-panel p-5" aria-label="Profile">
        <div className="h-6 w-24 animate-pulse rounded bg-border" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="h-11 animate-pulse rounded-lg bg-border" />
          <div className="h-11 animate-pulse rounded-lg bg-border" />
          <div className="h-11 animate-pulse rounded-lg bg-border sm:col-span-2" />
          <div className="h-11 w-32 animate-pulse rounded-lg bg-border sm:col-span-2" />
        </div>
      </section>

      {[0, 1].map((i) => (
        <section key={i} className="mt-8 rounded-2xl border border-border bg-panel p-5">
          <div className="h-6 w-32 animate-pulse rounded bg-border" />
          <div className="mt-4 space-y-3">
            <div className="h-14 animate-pulse rounded-xl bg-border" />
            <div className="h-14 animate-pulse rounded-xl bg-border" />
          </div>
        </section>
      ))}
    </main>
  );
}
