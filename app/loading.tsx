// Loading skeleton. Solid colours only, no gradients.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-panel" />
      <div className="mt-2 h-4 w-80 animate-pulse rounded-lg bg-panel" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="h-24 animate-pulse rounded-2xl bg-panel" />
        <div className="h-24 animate-pulse rounded-2xl bg-panel" />
        <div className="h-24 animate-pulse rounded-2xl bg-panel" />
      </div>
      <div className="mt-8 h-64 animate-pulse rounded-2xl bg-panel" />
    </main>
  );
}
