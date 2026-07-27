import { describe, it, expect, vi } from "vitest";
import { UserRole } from "@prisma/client";
import type { Session } from "next-auth";

// Prevent next-auth → next/server from loading in the test environment
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { hasRole } from "@/lib/permissions";

function session(role: UserRole): Session {
  return {
    user: { id: "1", name: "Test", email: "test@example.com", role },
    expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  };
}

describe("hasRole", () => {
  it("returns true when session role is in the allowed list", () => {
    expect(hasRole(session(UserRole.Admin), [UserRole.Admin])).toBe(true);
    expect(hasRole(session(UserRole.Editor), [UserRole.Admin, UserRole.Editor])).toBe(true);
    expect(hasRole(session(UserRole.Viewer), [UserRole.Viewer])).toBe(true);
  });

  it("returns false when session role is not in the allowed list", () => {
    expect(hasRole(session(UserRole.Viewer), [UserRole.Admin])).toBe(false);
    expect(hasRole(session(UserRole.Editor), [UserRole.Admin])).toBe(false);
    expect(hasRole(session(UserRole.Viewer), [UserRole.Admin, UserRole.Editor])).toBe(false);
  });

  it("Admin passes Editor-level checks", () => {
    expect(hasRole(session(UserRole.Admin), [UserRole.Admin, UserRole.Editor])).toBe(true);
  });

  it("Viewer does not pass Editor-level checks", () => {
    expect(hasRole(session(UserRole.Viewer), [UserRole.Admin, UserRole.Editor])).toBe(false);
  });

  it("returns false for empty roles list", () => {
    expect(hasRole(session(UserRole.Admin), [])).toBe(false);
  });
});
