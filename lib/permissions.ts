import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import type { Session } from "next-auth";

export function hasRole(session: Session, roles: UserRole[]): boolean {
  return roles.includes(session.user.role);
}

const EDITOR_ROLES: UserRole[] = [UserRole.Admin, UserRole.Editor];

/** True for the roles requireEditor() lets through; for hiding editor-only UI. */
export function isEditorSession(session: Session | null): boolean {
  return session !== null && hasRole(session, EDITOR_ROLES);
}

/**
 * Any signed-in user. Every page under app/(app) must call this (or
 * requireRole) itself, before reading data: the proxy only checks that a
 * session cookie exists and the layout is not guaranteed to run for every
 * render (Next.js can skip it on RSC partial rendering).
 */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(roles: UserRole[]): Promise<Session> {
  const session = await auth();
  if (!session) redirect("/login");
  if (!roles.includes(session.user.role)) redirect("/dashboard");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  return requireRole([UserRole.Admin]);
}

export async function requireEditor(): Promise<Session> {
  return requireRole(EDITOR_ROLES);
}
