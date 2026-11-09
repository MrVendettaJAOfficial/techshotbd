// TechShot marketplace — slug and money helpers.
//
// Lowercase slugs, slug de-duplication and BDT taka <->
// integer poisha conversion (100 poisha = 1 BDT). Pure
// functions, no imports.

/** Lowercase slug: non-alphanumerics become "-", runs collapse, ends trimmed. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "product";
}

/** Append -2, -3, ... until the slug is not in `taken`. */
export function dedupeSlug(base: string, taken: Iterable<string>): string {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  let n = 2;
  while (takenSet.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** BDT taka -> integer poisha, rounded to the nearest poisha. */
export function takaToPoisha(taka: number): number {
  return Math.round(taka * 100);
}

/** Integer poisha -> BDT taka. */
export function poishaToTaka(poisha: number): number {
  return poisha / 100;
}
