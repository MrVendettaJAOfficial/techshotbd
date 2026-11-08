"use client";

// Live flash-deal countdown. Updates every second and shows hours,
// minutes and seconds in solid boxes. Accepts the deal end time as a
// millisecond timestamp or an ISO string.

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

export default function FlashCountdown({
  endsAt,
}: {
  endsAt: number | string;
}) {
  const endsAtMs =
    typeof endsAt === "string" ? new Date(endsAt).getTime() : endsAt;
  const [now, setNow] = useState(() => remainingParts(endsAtMs));

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(remainingParts(endsAtMs)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [endsAtMs]);

  const boxes = [
    { value: pad(now.hours), label: "Hours" },
    { value: pad(now.minutes), label: "Minutes" },
    { value: pad(now.seconds), label: "Seconds" },
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
            <span className="text-xl font-bold tabular-nums text-text">
              {box.value}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
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
