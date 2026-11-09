// Account profile section (client component).
//
// The signed-in user's display name, phone and email form. Saving
// goes through lib/account-server.ts saveAccountProfile when the
// Supabase data is live, and falls back to the browser-local profile
// otherwise — the caller (app/account/page.tsx) owns that choice and
// passes its save handler in.
//
// Split from app/account/page.tsx: the profile form lives here, the
// page keeps the profile state and the save handler.

"use client";

import type { AppUser } from "@/lib/auth";
import type { Profile } from "@/lib/checkout-store";
import { btnPrimary, inputCls, labelCls } from "./account-ui";

interface ProfileSectionProps {
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  /** Signed-in user, if any — the sign-in email cannot be changed here. */
  user: AppUser | null;
  saved: boolean;
  error: string | null;
  onSave: (event: React.FormEvent) => void;
}

export default function ProfileSection({
  profile,
  onProfileChange,
  user,
  saved,
  error,
  onSave,
}: ProfileSectionProps) {
  return (
    <section className="mt-8 rounded-2xl border border-border bg-panel p-5" aria-label="Profile">
      <h2 className="text-lg font-bold text-text">Profile</h2>
      <form onSubmit={onSave} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="displayName" className={labelCls}>Display name</label>
          <input
            id="displayName"
            value={profile.displayName}
            onChange={(e) => onProfileChange({ ...profile, displayName: e.target.value })}
            placeholder="Your name"
            className={inputCls}
            autoComplete="name"
          />
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>Phone</label>
          <input
            id="phone"
            type="tel"
            value={profile.phone}
            onChange={(e) => onProfileChange({ ...profile, phone: e.target.value })}
            placeholder="01XXXXXXXXX"
            className={inputCls}
            autoComplete="tel"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="profileEmail" className={labelCls}>Email</label>
          <input
            id="profileEmail"
            type="email"
            value={profile.email}
            onChange={(e) => onProfileChange({ ...profile, email: e.target.value })}
            placeholder="you@example.com"
            className={inputCls}
            autoComplete="email"
            readOnly={!!user}
            aria-readonly={!!user}
          />
          {user && (
            <p className="mt-1 text-xs text-muted">Your sign-in email cannot be changed here.</p>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
        {saved && <p role="status" className="text-sm text-success sm:col-span-2">Profile saved.</p>}
        <div className="sm:col-span-2">
          <button type="submit" className={btnPrimary}>Save profile</button>
        </div>
      </form>
    </section>
  );
}
