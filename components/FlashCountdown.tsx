"use client";

// Live flash-deal countdown. Updates every second and shows hours,
// minutes and seconds in solid boxes. Accepts the deal end time as a
// millisecond timestamp or an ISO string.
//
// Hydration safety: the remaining time depends on Date.now(), so it
// can never be rendered during the first (server) render — the server
// renders one second value and the client hydrates a second later
// with a different one, which throws minified React errors #425/#422
// on the home page. The component therefore renders a static
// placeholder (00:00:00, identical server-side and client-side) until
// it has mounted, and only then starts the live countdown in an
// effect. The placeholder uses the exact same markup and boxes as the
// live countdown, so there is no layout shift on mount.

import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

function remainingParts(endsAtMs: number) {
  const diff = Math.max(0, endsAtMs - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

// Static placeholder shown before mount: deterministic, so the HTML
// the server sends and the HTML React hydrates are byte-identical.
const PLACEHOLDER = { hours: 0, minutes: 0, seconds: 0 };

export default function FlashCountdown({
  endsAt,
}: {
  endsAt: number | string;
}) {
  const endsAtMs =
    typeof endsAt === "string" ? new Date(endsAt).getTime() : endsAt;
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(PLACEHOLDER);

  useEffect(() => {
    setMounted(true);
    // Tick immediately on mount (the interval alone would leave the
    // placeholder showing for a full second) and then every second.
    setNow(remainingParts(endsAtMs));
    const timer = window.setInterval(
      () => setNow(remainingParts(endsAtMs)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [endsAtMs]);

  // Before mount, render the placeholder; after mount, the live time.
  // `mounted` is false on both the server render and the first client
  // render, so hydration always matches.
  const parts = mounted ? now : PLACEHOLDER;
  const boxes = [
    { value: pad(parts.hours), label: "Hours" },
    { value: pad(parts.minutes), label: "Minutes" },
    { value: pad(parts.seconds), label: "Seconds" },
  ];

  return (
    <div
      className="flex items-center gap-2"
      role="timer"
      aria-label="Time left in flash deals"
    >
      {boxes.map((box, i) => (
        <div key={box.label} className="flex items-center gap-2">
          <div className="flex min-w-14 flex-col items-center rounded-xl bg-ink px-2 py-2">
            <span className="text-xl font-bold tabular-nums text-white">
              {box.value}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-mutedNavy">
              {box.label}
            </span>
          </div>
          {i < boxes.length - 1 && (
            <span className="text-lg font-bold text-text">:</span>
          )}
        </div>
      ))}
    </div>
  );
}
