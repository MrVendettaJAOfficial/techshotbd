// TechShot marketplace — server-side auth helpers + profile action.
//
// This file is a thin re-export barrel: the code moved to
// lib/auth-server/session.ts (current user, caller role, auth-code
// exchange), lib/auth-server/profile.ts (profile creation) and
// lib/auth-server/admin-users.ts (Owner-only user management).
// Import paths are unchanged — import from "@/lib/auth-server" as
// before.
//
// NOTE: this barrel deliberately has NO "use server" directive.
// Next.js only allows async-function exports in a "use server" file,
// so a barrel that re-exports actions would fail the build. The
// directive lives in the files where the actions are defined
// (auth-server/*.ts); re-exporting them from here keeps them server
// actions.

export { exchangeAuthCode, getCallerRole, getCurrentUser } from "./auth-server/session";
export { ensureCurrentUserProfile, ensureProfile } from "./auth-server/profile";
export { changeUserRole, listUsers, removeUser } from "./auth-server/admin-users";
export type { ChangeUserRoleResult, ListedUser, RemoveUserResult } from "./auth-server/admin-users";
