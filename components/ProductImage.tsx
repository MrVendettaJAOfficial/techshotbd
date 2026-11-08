"use client";

// Product image with a solid-colour fallback. If the product photo fails
// to load (for example before product photos are uploaded), a solid card
// background with the product's initial letter is shown instead. No emoji.

import Image from "next/image";
import { useState } from "react";

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

  if (failed) {
    return (
      <div
        className={`flex aspect-square items-center justify-center bg-[#151f33] ${className ?? ""}`}
        aria-label={alt}
        role="img"
      >
        <span className="text-5xl font-bold text-brand">{alt.charAt(0)}</span>
      </div>
    );
  }

  return (
    <div className={`relative aspect-square overflow-hidden bg-[#151f33] ${className ?? ""}`}>
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
