"use client";

// Newsletter signup. Validates the email address with a regex and, on
// submit, shows a success message. No backend is wired yet and no fake
// API call is made — the signup is stored only as local UI state until
// the newsletter backend is connected.

import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    setDone(true);
  }

  if (done) {
    return (
      <p className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium text-success">
        Thanks — you are on the list.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full max-w-md">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-500"
        >
          Subscribe
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        One email a week. No spam, unsubscribe anytime.
      </p>
    </form>
  );
}
