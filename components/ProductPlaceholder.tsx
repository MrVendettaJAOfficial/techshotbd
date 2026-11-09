// Branded product placeholder — the TechShot logo on the logo navy.
//
// Shown wherever a product has no photo (the subscription products
// have none) and whenever a photo fails to load, so a product never
// shows a blank image area or a bare initial letter again. It reuses
// the Logo component's monogram (LogoMark, no link wrapper — this
// often renders inside a product card link, where a nested link
// would be invalid HTML). Flat logo colours only, no gradients.
//
// `compact` renders the mark alone, for the small 40–48px thumbnails
// in order items, the wishlist and the checkout summary, where the
// wordmark would not fit. The full lockup (mark + "TechShot") is for
// cards, the gallery and cart lines.
import { LogoMark } from "./Logo";

export default function ProductPlaceholder({
  className,
  compact,
  label,
}: {
  className?: string;
  compact?: boolean;
  label?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 overflow-hidden bg-logoNavy ${className ?? ""}`}
      role="img"
      aria-label={label ?? "TechShot"}
      data-testid="product-placeholder"
    >
      <LogoMark className={compact ? "h-6 w-6" : "h-12 w-12 sm:h-16 sm:w-16"} />
      {!compact && (
        <span className="px-1 text-center text-[10px] font-extrabold tracking-wide text-logoWhite sm:text-xs">
          TechShot
        </span>
      )}
    </div>
  );
}
