// Admin users section (client component). Owner-only: the page
// never renders this tab for anyone else, and this component also
// refuses to render the list when the caller is not the owner.
//
// Each user shows their role as Owner / Co-admin / Manager /
// Customer, a role selector that writes through changeUserRole, and
// a remove button (two-step confirm) that writes through removeUser.
// Both actions are server-enforced Owner-only. The owner cannot
// change their own role or remove themselves — those controls are
// disabled on their own row.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeUserRole, removeUser } from "@/lib/auth-server";
import { isOwner, roleLabel } from "@/lib/roles";
import { Badge, Button, Card, EmptyState, SectionHeading, Select } from "@/components/ui";
import TabBar from "@/components/TabBar";
import {
  USER_ROLE_OPTIONS,
  USER_ROLE_TABS,
  countByStatus,
  filterByStatus,
} from "@/components/admin-helpers";
import type { AdminUserItem } from "@/lib/products/queries";

interface AdminUsersProps {
  users: AdminUserItem[];
  /** The signed-in caller's user id, for disabling their own row. */
  currentUserId: string | null;
  /** The signed-in caller's role string (owner "admin", "co_admin", "manager", ...). */
  callerRole: string | null;
}

// A notice left by the previous mount, consumed once below — the
// same pattern as ProductManager's pendingSaveNotice. After a role
// change or a removal the handlers call router.refresh() so the list
// shows the new server data, and that refresh remounts this
// component, wiping plain React state: a notice kept only in state
// would never be seen (proven by the Playwright run, 2026-11-09).
let pendingUserNotice: string | null = null;

export default function AdminUsers({ users, currentUserId, callerRole }: AdminUsersProps) {
  const router = useRouter();
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [userError, setUserError] = useState<string | null>(null);
  // Initial state consumes a notice left by the previous mount (see
  // pendingUserNotice above).
  const [userNotice, setUserNotice] = useState<string | null>(() => {
    const notice = pendingUserNotice;
    pendingUserNotice = null;
    return notice;
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  if (!isOwner(callerRole)) {
    return (
      <div>
        <SectionHeading title="Users" description="Registered accounts (profiles)." />
        <p role="alert" className="rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          Only the owner can view and manage users.
        </p>
      </div>
    );
  }

  const counts = countByStatus(users, (account) => account.role);
  const filteredUsers = filterByStatus(users, roleFilter, (account) => account.role);

  async function handleChangeRole(account: AdminUserItem, nextRole: string) {
    if (nextRole === account.role) return;
    setUserError(null);
    setUserNotice(null);
    setBusyId(account.id);
    let result: Awaited<ReturnType<typeof changeUserRole>>;
    try {
      result = await changeUserRole(account.id, nextRole);
    } catch {
      setUserError("Could not change the role. Please try again.");
      setBusyId(null);
      return;
    }
    setBusyId(null);
    if (!result.ok) {
      setUserError(result.error);
      return;
    }
    const notice = `Role for ${account.displayName} was changed to ${roleLabel(nextRole)}.`;
    setUserNotice(notice);
    // Stored outside React state as well as in it: the refresh below
    // remounts this component, so the notice would otherwise never
    // be seen (see pendingUserNotice above).
    pendingUserNotice = notice;
    router.refresh();
  }

  async function handleRemove(account: AdminUserItem) {
    setUserError(null);
    setUserNotice(null);
    setBusyId(account.id);
    let result: Awaited<ReturnType<typeof removeUser>>;
    try {
      result = await removeUser(account.id);
    } catch {
      setUserError("Could not remove the user. Please try again.");
      setBusyId(null);
      return;
    }
    setBusyId(null);
    setConfirmRemoveId(null);
    if (!result.ok) {
      setUserError(result.error);
      return;
    }
    const notice = `${account.displayName} was removed.`;
    setUserNotice(notice);
    // Stored outside React state as well as in it: the refresh below
    // remounts this component, so the notice would otherwise never
    // be seen (see pendingUserNotice above).
    pendingUserNotice = notice;
    router.refresh();
  }

  return (
    <div>
      <SectionHeading title="Users" description="Registered accounts (profiles). Emails live in Supabase Auth, not in profiles, so only the display name and role are shown here." />
      <TabBar
        tabs={USER_ROLE_TABS.map((tab) => ({
          ...tab,
          count: tab.id === "all" ? users.length : (counts[tab.id] ?? 0),
        }))}
        activeId={roleFilter}
        ariaLabel="Filter users by role"
        onSelect={setRoleFilter}
      />
      {userError ? (
        <p role="alert" className="mt-4 text-sm text-[#f87171]">{userError}</p>
      ) : null}
      {userNotice ? (
        <p role="status" className="mt-4 text-sm text-success">{userNotice}</p>
      ) : null}
      {users.length === 0 ? (
        <EmptyState
          title="No registered users yet"
          description="Customers who sign up appear here."
          className="mt-4"
        />
      ) : filteredUsers.length === 0 ? (
        <EmptyState
          title="No users with this role"
          description="No registered user currently has this role."
          className="mt-4"
        />
      ) : (
        <div className="mt-4 space-y-3">
          {filteredUsers.map((account) => {
            const isSelf = account.id === currentUserId;
            const selectValue = USER_ROLE_OPTIONS.some((option) => option.value === account.role)
              ? account.role
              : "customer";
            return (
              <Card key={account.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text">
                      {account.displayName}
                      {isSelf ? <span className="ml-2 text-sm font-normal text-muted">(you)</span> : null}
                    </p>
                    <p className="text-sm text-muted">
                      Joined {new Date(account.createdAt).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={account.role === "admin" ? "warning" : "default"}>
                      {roleLabel(account.role)}
                    </Badge>
                    <label htmlFor={`user-role-${account.id}`} className="sr-only">
                      Change role for {account.displayName}
                    </label>
                    <Select
                      id={`user-role-${account.id}`}
                      value={selectValue}
                      disabled={isSelf || busyId === account.id}
                      onChange={(e) => void handleChangeRole(account, e.target.value)}
                      aria-label={`Change role for ${account.displayName}`}
                    >
                      {USER_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {confirmRemoveId === account.id ? (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleRemove(account)}
                          disabled={isSelf || busyId === account.id}
                        >
                          Confirm remove
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveId(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmRemoveId(account.id)}
                        disabled={isSelf}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {isSelf ? (
                  <p className="mt-2 text-xs text-muted">
                    You cannot change your own role or remove yourself.
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
