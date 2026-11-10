"use client";

// Write-a-review form for a product, plus the average-rating
// helper its parent uses to update the shown average when a
// review is just submitted. Anyone can read reviews; writing
// one requires sign-in and a delivered order (enforced
// server-side by submitReview).

import { useState } from "react";
import { submitReview, type ProductReviewItem } from "../../lib/reviews";

/** Average rating rounded to 1 decimal, 0 when there are no reviews. */
export function averageOf(reviews: ProductReviewItem[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((total, review) => total + review.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

/** Write-a-review form, shown only to signed-in users. Anyone can
 *  read reviews; writing one requires login — and a delivered order
 *  containing the product (enforced server-side by submitReview).
 *  A rating on its own is a review: the comment is optional. On
 *  success the new review is handed to the parent through
 *  onReviewSaved, which shows it immediately from local state — the
 *  form deliberately does NOT call router.refresh(): the refresh
 *  remounts this component, which wipes the thank-you notice and
 *  resets the tab to Description, hiding the review just written
 *  (proven by the Playwright run, 2026-11-09). The next navigation
 *  loads the server copy, which includes the saved row. */
export function ReviewForm({
  productSlug,
  onReviewSaved,
}: {
  productSlug: string;
  onReviewSaved?: (review: ProductReviewItem) => void;
}) {
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    let result: Awaited<ReturnType<typeof submitReview>>;
    try {
      result = await submitReview(productSlug, Number(rating), comment.trim());
    } catch {
      setError("Could not save your review. Please try again.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const savedComment = comment.trim();
    setComment("");
    setNotice("Thank you — your review was saved.");
    onReviewSaved?.({
      // A local id: the server row's id is only known on the next
      // load, and this entry is replaced by it then.
      id: `local-${Date.now()}`,
      // The author name resolves server-side on the next load; until
      // then the reviewer sees their own review as their own.
      authorName: "You",
      rating: Number(rating),
      comment: savedComment,
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-base font-semibold text-text">Write a review</h3>
      <p className="mt-1 text-sm text-muted">
        You can review products from an order that was delivered.
      </p>
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="review-rating" className="block text-sm font-medium text-text">
            Your rating
          </label>
          <select
            id="review-rating"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          >
            <option value="5">5 stars — Excellent</option>
            <option value="4">4 stars — Good</option>
            <option value="3">3 stars — Average</option>
            <option value="2">2 stars — Poor</option>
            <option value="1">1 star — Very poor</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="review-comment" className="block text-sm font-medium text-text">
            Your review (optional)
          </label>
          <textarea
            id="review-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you think of this product?"
            disabled={submitting}
            rows={4}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-700">{error}</p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-success">{notice}</p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-lg bg-brandDark px-4 py-2 text-sm font-medium text-white transition hover:bg-brandDarker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Submit review"}
        </button>
      </div>
    </form>
  );
}
