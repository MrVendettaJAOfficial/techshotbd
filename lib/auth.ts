// Demo authentication for TechShot.
//
// PRODUCTION NOTE: this is a local demo store, not the real auth system.
// Production auth is Supabase Auth (see lib/supabase/*, written by a
// parallel workstream). When Supabase is configured, this file is replaced
// by Supabase Auth calls and this demo store is deleted; no demo account
// or demo password must ever be treated as a real credential.
//
// Demo store design:
// - Accounts and sessions live in localStorage only, per browser.
// - Passwords are never stored in plain text. Each password is stored as
//   a salted SHA-256 hash (WebCrypto): hash = SHA-256(salt + ":" +
//   password), with a fresh random 16-byte salt per account. SHA-256 is
//   used here only because it is what WebCrypto offers in the browser;
//   production Supabase Auth uses proper password hashing server-side.
// - The `admin` role can NEVER be assigned at sign-up. Sign-up only
//   offers `customer` or `seller`. Admin access is granted manually —
//   in production, in the database — and in this demo through the
//   clearly labelled "Sign in as demo admin" button on /admin, which
//   creates a local-only admin session. There is no demo admin password.
// - Seller accounts need admin approval before they can publish
//   products. Signing up as a seller creates a pending approval record
//   (see lib/demo-store); the seller dashboard enforces it.

"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { addSellerApproval } from "./demo-store";

export type UserRole = "customer" | "seller" | "admin";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSession {
  user: AppUser;
  createdAt: string;
}

const SESSION_KEY = "techshot-auth-v1";
const USERS_KEY = "techshot-auth-users-v1";

const signUpSchema = z.object({
  displayName: z.string().trim().min(2, "Please enter your name (at least 2 characters)."),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(["customer", "seller"]),
});

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password."),
});

interface StoredUser {
  id: string;
  email: string;
  displayName: string;
  role: Exclude<UserRole, "admin">;
  salt: string;
  passwordHash: string;
  createdAt: string;
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  window.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newId(): string {
  if (typeof window !== "undefined" && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `user-${Date.now()}-${randomHex(8)}`;
}

function readUsers(): StoredUser[] {
  return readJSON<StoredUser[]>(USERS_KEY, []);
}

function readSession(): AuthSession | null {
  return readJSON<AuthSession | null>(SESSION_KEY, null);
}

function writeSession(session: AuthSession | null): void {
  if (typeof window === "undefined") return;
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

/** Synchronous session read for client components. Returns null on the
 *  server (no localStorage there) and when nobody is signed in. */
export function getSession(): AuthSession | null {
  return readSession();
}

export async function signUp(input: {
  displayName: string;
  email: string;
  password: string;
  role: "customer" | "seller";
}): Promise<AuthSession> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }
  const { displayName, email, password, role } = parsed.data;
  const users = readUsers();
  if (users.some((u) => u.email === email)) {
    throw new Error("An account with this email already exists. Please sign in instead.");
  }
  const salt = randomHex(16);
  const passwordHash = await hashPassword(salt, password);
  const user: StoredUser = {
    id: newId(),
    email,
    displayName,
    role,
    salt,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  writeJSON(USERS_KEY, [...users, user]);
  const session: AuthSession = {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    createdAt: new Date().toISOString(),
  };
  writeSession(session);
  if (role === "seller") {
    // A seller signup is a pending approval until an admin approves it.
    addSellerApproval({
      id: `approval-${user.id}`,
      displayName,
      email,
      status: "pending",
      createdAt: user.createdAt,
      decidedAt: null,
    });
  }
  return session;
}

export async function signIn(input: { email: string; password: string }): Promise<AuthSession> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }
  const { email, password } = parsed.data;
  const user = readUsers().find((u) => u.email === email);
  if (!user) {
    throw new Error("No account was found for this email. Please sign up first.");
  }
  const attempt = await hashPassword(user.salt, password);
  if (attempt !== user.passwordHash) {
    throw new Error("The password is incorrect. Please try again.");
  }
  const session: AuthSession = {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    createdAt: new Date().toISOString(),
  };
  writeSession(session);
  return session;
}

/**
 * Demo admin sign-in. Local only, no password: it creates an admin
 * session in this browser so the admin dashboard can be tried before
 * Supabase is connected. In production this function is deleted and
 * admin accounts are created in the database by an existing admin.
 */
export function signInAsDemoAdmin(): AuthSession {
  const session: AuthSession = {
    user: {
      id: "demo-admin",
      email: "demo-admin@techshot.local",
      displayName: "Demo Admin",
      role: "admin",
    },
    createdAt: new Date().toISOString(),
  };
  writeSession(session);
  return session;
}

export function signOut(): void {
  writeSession(null);
}

/** Registered demo users, without password hashes or salts. For the
 *  admin dashboard's user list. Demo admin sessions are not registered
 *  users and are not listed here. */
export function listDemoUsers(): Array<Pick<StoredUser, "id" | "email" | "displayName" | "role" | "createdAt">> {
  return readUsers().map(({ id, email, displayName, role, createdAt }) => ({
    id,
    email,
    displayName,
    role,
    createdAt,
  }));
}

interface AuthContextValue {
  session: AuthSession | null;
  user: AppUser | null;
  loading: boolean;
  refresh: () => void;
  signOutUser: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  refresh: () => {},
  signOutUser: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => setSession(readSession());

  useEffect(() => {
    refresh();
    setLoading(false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      refresh,
      signOutUser: () => {
        signOut();
        setSession(null);
      },
    }),
    [session, loading],
  );

  // createElement (not JSX): this file is lib/auth.ts, and .ts files
  // cannot contain JSX. The provider renders exactly the same tree.
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
