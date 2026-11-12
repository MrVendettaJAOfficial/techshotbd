// Staff-user stub for `node --test` (test-only).
//
// Replaces lib/auth-server (barrel) and lib/auth-server/session
// when the stub hook is registered, so the real server actions can
// run under `node --test` as a chosen staff user instead of failing
// on cookies() (unavailable outside a request). The default user is
// the store owner; tests switch it with __setUser() — e.g. to null
// (signed out) or to a customer — and restore it afterwards. This
// stub never touches a real session: it is only reachable through
// the test-only resolve hook.

let user = {
  id: "staff-1",
  email: "staff@techshot.test",
  displayName: "Staff Owner",
  role: "admin",
};

/** Run the following calls as this user (null = signed out). */
export function __setUser(next) {
  user = next;
}

export function __getUser() {
  return user;
}

/** The signed-in user, or null when nobody is signed in. */
export async function getCurrentUser() {
  return user;
}

/** The caller's profiles.role, or null when signed out. */
export async function getCallerRole() {
  return user?.role ?? null;
}

export async function exchangeAuthCode() {
  throw new Error("exchangeAuthCode() is not available in unit tests");
}
