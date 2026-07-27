import { describe, it, expect, vi, beforeEach } from "vitest";

class MockAuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError: MockAuthError }));

const mockSignIn = vi.fn();
vi.mock("@/lib/auth", () => ({ signIn: (...args: unknown[]) => mockSignIn(...args) }));

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("login", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
  });

  it("returns no error and signs in on valid credentials", async () => {
    mockSignIn.mockResolvedValue(undefined);
    const { login } = await import("@/app/(auth)/login/actions");

    const res = await login(undefined, formData({ email: "a@example.com", password: "hunter2" }));

    expect(res).toEqual({});
    expect(mockSignIn).toHaveBeenCalledWith("credentials", {
      email: "a@example.com",
      password: "hunter2",
      totpCode: "",
      redirectTo: "/dashboard",
    });
  });

  it("returns a generic error when signIn throws a plain AuthError", async () => {
    mockSignIn.mockRejectedValue(new MockAuthError("CredentialsSignin"));
    const { login } = await import("@/app/(auth)/login/actions");

    const res = await login(undefined, formData({ email: "a@example.com", password: "wrong" }));

    expect(res.error).toBe("Ungültige Anmeldedaten.");
    expect(res.totpRequired).toBeUndefined();
  });

  it("flags totpRequired without an error when the account has TOTP enabled", async () => {
    const err = new MockAuthError("CredentialsSignin") as MockAuthError & { code: string };
    err.code = "totp_required";
    mockSignIn.mockRejectedValue(err);
    const { login } = await import("@/app/(auth)/login/actions");

    const res = await login(undefined, formData({ email: "a@example.com", password: "correct" }));

    expect(res).toEqual({ totpRequired: true });
  });

  it("flags totpRequired with an error when the TOTP code is wrong", async () => {
    const err = new MockAuthError("CredentialsSignin") as MockAuthError & { code: string };
    err.code = "totp_invalid";
    mockSignIn.mockRejectedValue(err);
    const { login } = await import("@/app/(auth)/login/actions");

    const res = await login(
      undefined,
      formData({ email: "a@example.com", password: "correct", totpCode: "000000" })
    );

    expect(res).toEqual({ totpRequired: true, error: "Ungültiger Code." });
  });

  it("rethrows non-AuthError errors (e.g. NEXT_REDIRECT)", async () => {
    mockSignIn.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const { login } = await import("@/app/(auth)/login/actions");

    await expect(login(undefined, formData({ email: "a@example.com", password: "hunter2" }))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
  });
});
