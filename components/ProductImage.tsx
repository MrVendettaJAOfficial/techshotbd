"use client";

// Product image with a branded fallback. A product with no photo at
// all (empty src — the subscription products have none) or a photo
// that fails to load shows the TechShot logo placeholder instead of
// a blank area or a bare initial letter, so a broken or missing
// image URL degrades to the logo rather than an empty box. No emoji.

import Image from "next/image";
import { useState } from "react";
import ProductPlaceholder from "./ProductPlaceholder";

export default function ProductImage({
  src,
  alt,
  className,
  priority,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  // Empty src must never reach next/image: an empty src renders
  // nothing (and a guessed URL for a file that does not exist is
  // what used to produce the image-optimizer 400s — see
  // lib/catalog/mapping.ts). The placeholder covers both cases.
  if (!src?.trim() || failed) {
    return (
      <ProductPlaceholder
        className={`aspect-square ${className ?? ""}`}
        label={alt}
      />
    );
  }

  return (
    <div className={`relative aspect-square overflow-hidden bg-panel ${className ?? ""}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 50vw, 33vw"
        className="object-cover"
        priority={priority}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
