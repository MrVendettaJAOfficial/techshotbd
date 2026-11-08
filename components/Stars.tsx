// Rating stars. Solid colours only, no emoji. Filled stars use the
// accent colour; empty stars use the muted border colour.

import { Star } from "lucide-react";

export default function Stars({
  rating,
  reviewCount,
  size = 16,
}: {
  rating: number;
  reviewCount?: number;
  size?: number;
}) {
  const safeRating = Math.max(0, Math.min(5, Number.isFinite(rating) ? rating : 0));
  return (
    <span
      className="inline-flex items-center gap-1"
      role="img"
      aria-label={`Rated ${safeRating} out of 5${reviewCount !== undefined ? ` based on ${reviewCount} reviews` : ""}`}
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = safeRating >= star - 0.25;
          const half = !filled && safeRating >= star - 0.75;
          return (
            <Star
              key={star}
              size={size}
              className={filled || half ? "fill-accent text-accent" : "fill-transparent text-muted"}
            />
          );
        })}
      </span>
      {reviewCount !== undefined ? (
        <span className="text-xs text-muted">
          {safeRating.toFixed(1)} ({reviewCount.toLocaleString("en-IN")} reviews)
        </span>
      ) : (
        <span className="text-xs text-muted">{safeRating.toFixed(1)}</span>
      )}
    </span>
  );
}
