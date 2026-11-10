// Admin loading skeleton. Mirrors the tabbed dashboard shell
// (components/admin/dashboard-shell.tsx — max-w-5xl, px-4 py-12,
// header with title + signed-in line + Sign out button, TabBar,
// content mt-8), so a full-page /admin load shows the dashboard's
// shape instantly instead of a blank page while the middleware
// gate and the live data load.
//
// NOTE: this skeleton does NOT render during client-side ?tab=
// navigation in this Next 14.2.5 setup — the tab switch is served
// by the already-mounted shell, so the instant feedback on a tab
// tap comes from the TabBar's own pending state (see
// components/TabBar.tsx), not from here.
// Solid colours only, no gradients, no emoji.

const TAB_LABELS = ["Overview", "Products", "Banners", "Orders", "Messages", "Users"];

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12" aria-label="Loading">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="h-8 w-48 animate-pulse rounded-lg bg-border" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-border" />
        </div>
        <div className="h-10 w-24 animate-pulse rounded-lg bg-border" />
      </div>

      <div
        className="flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label="Admin sections"
      >
        {TAB_LABELS.map((label, i) => (
          <div
            key={label}
            role="tab"
            aria-selected={i === 0}
            className={`shrink-0 whitespace-nowrap rounded-t-xl px-4 py-3 ${
              i === 0 ? "border-b-2 border-brand bg-panel" : ""
            }`}
          >
            <div className="h-5 w-16 animate-pulse rounded bg-border" />
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        <div className="rounded-2xl border border-border bg-panel p-5">
          <div className="h-6 w-32 animate-pulse rounded bg-border" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-border" />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-border" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-panel p-5">
          <div className="h-6 w-40 animate-pulse rounded bg-border" />
          <div className="mt-4 h-16 animate-pulse rounded-xl bg-border" />
        </div>
      </div>
    </main>
  );
}
