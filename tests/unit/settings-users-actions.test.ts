import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOtp = vi.hoisted(() => ({
  generateSecret: vi.fn().mockReturnValue("MOCKSECRET32CHARS"),
  verifySync: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("bcryptjs", () => ({ hash: vi.fn() }));
vi.mock("@/lib/password", () => ({ validatePasswordPolicy: vi.fn() }));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: vi.fn((v: string) => `enc:${v}`),
  decryptSecret: vi.fn((v: string) => v.replace("enc:", "")),
}));
vi.mock("@/lib/backup-codes", () => ({
  generateBackupCodes: vi.fn().mockReturnValue(Array(8).fill("backup")),
  hashBackupCodes: vi.fn().mockReturnValue(Array(8).fill("hashed")),
}));
vi.mock("@/lib/config", () => ({
  config: { bcrypt: { rounds: 10 } },
}));
vi.mock("otplib", () => ({
  OTP: class {
    generateSecret = mockOtp.generateSecret;
    verifySync = mockOtp.verifySync;
  },
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,abc") },
}));

import {
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
  generateTotpSetup,
  confirmTotpSetup,
  disableTotp,
} from "@/app/(app)/settings/users/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { hash } from "bcryptjs";
import { validatePasswordPolicy } from "@/lib/password";

const adminSession = {
  user: { id: "1", name: "Admin", email: "admin@test.ch", role: "Admin" },
} as never;
const editorSession = {
  user: { id: "2", name: "Editor", email: "editor@test.ch", role: "Editor" },
} as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID_USER_FORM = {
  email: "new@user.ch",
  name: "Neuer User",
  password: "Sicher!123",
  role: "Editor",
};

describe("settings/users actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createUser", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      await expect(createUser({}, form(VALID_USER_FORM))).rejects.toThrow();
    });

    it("returns error for missing required fields", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const result = await createUser({}, form({ email: "x@x.ch" }));
      expect(result.error).toBe("Alle Felder sind Pflicht.");
    });

    it("returns password policy error", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(validatePasswordPolicy).mockReturnValue("Passwort zu schwach.");
      const result = await createUser({}, form(VALID_USER_FORM));
      expect(result.error).toBe("Passwort zu schwach.");
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns error when email is already taken", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(validatePasswordPolicy).mockReturnValue(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 99 } as never);
      const result = await createUser({}, form(VALID_USER_FORM));
      expect(result.error).toBe("E-Mail bereits vergeben.");
    });

    it("creates user, logs audit, and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(validatePasswordPolicy).mockReturnValue(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(hash).mockResolvedValue("$2b$10$hashed" as never);
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 10,
        email: "new@user.ch",
      } as never);

      const result = await createUser({}, form(VALID_USER_FORM));
      expect(result).toEqual({});
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: "new@user.ch",
          name: "Neuer User",
          passwordHash: "$2b$10$hashed",
          role: "Editor",
        }),
      });
      expect(logAudit).toHaveBeenCalledWith(
        adminSession,
        "CREATE",
        "User",
        10,
        "new@user.ch",
        expect.any(Object)
      );
      expect(revalidatePath).toHaveBeenCalledWith("/settings/users");
    });
  });

  describe("updateUser", () => {
    it("returns error for missing name or role", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const result = await updateUser(1, {}, form({ name: "Test" }));
      expect(result.error).toBe("Name und Rolle sind Pflicht.");
    });

    it("returns last-admin guard error when demoting last admin", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 1,
        role: "Admin",
        isActive: true,
      } as never);
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const result = await updateUser(
        1,
        {},
        form({ name: "Admin", role: "Editor", isActive: "true" })
      );
      expect(result.error).toContain("mindestens ein aktiver Admin");
    });

    it("updates user, logs audit, and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 2,
        role: "Editor",
        isActive: true,
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({ email: "user@test.ch" } as never);

      const result = await updateUser(
        2,
        {},
        form({ name: "Geändert", role: "Editor", isActive: "true" })
      );
      expect(result).toEqual({});
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { name: "Geändert", role: "Editor", isActive: true },
      });
      expect(logAudit).toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalledWith("/settings/users");
    });
  });

  describe("resetPassword", () => {
    it("returns password policy error", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(validatePasswordPolicy).mockReturnValue("Zu kurz.");
      const result = await resetPassword(1, {}, form({ password: "short" }));
      expect(result.error).toBe("Zu kurz.");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("resets password, logs audit, and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(validatePasswordPolicy).mockReturnValue(null);
      vi.mocked(hash).mockResolvedValue("$2b$10$newhash" as never);
      vi.mocked(prisma.user.update).mockResolvedValue({ email: "user@test.ch" } as never);

      const result = await resetPassword(5, {}, form({ password: "NewSicher!123" }));
      expect(result.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { passwordHash: "$2b$10$newhash" },
      });
      expect(logAudit).toHaveBeenCalledWith(
        adminSession,
        "UPDATE",
        "User",
        5,
        "user@test.ch",
        { action: "password-reset" }
      );
    });
  });

  describe("deleteUser", () => {
    it("returns last-admin guard error when deleting last admin", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 1,
        role: "Admin",
        isActive: true,
      } as never);
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const result = await deleteUser(1);
      expect(result.error).toContain("mindestens ein aktiver Admin");
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it("deletes user, logs audit, and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 3,
        role: "Editor",
        isActive: true,
      } as never);
      vi.mocked(prisma.user.delete).mockResolvedValue({ email: "del@test.ch" } as never);

      const result = await deleteUser(3);
      expect(result).toEqual({});
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 3 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "User", 3, "del@test.ch");
      expect(revalidatePath).toHaveBeenCalledWith("/settings/users");
    });
  });

  describe("generateTotpSetup", () => {
    it("generates TOTP secret, QR code URL, and stores pending setup", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 4,
        email: "user@test.ch",
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);
      mockOtp.generateSecret.mockReturnValue("MOCKSECRET32CHARS");

      const result = await generateTotpSetup(4);
      expect("secret" in result).toBe(true);
      if ("secret" in result) {
        expect(result.secret).toBe("MOCKSECRET32CHARS");
        expect(result.qrCodeDataUrl).toContain("data:image/png");
        expect(result.otpauthUrl).toContain("otpauth://totp/");
      }
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: expect.objectContaining({ totpEnabled: false }),
      });
    });
  });

  describe("confirmTotpSetup", () => {
    it("returns error when no TOTP secret is stored", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 5,
        totpSecret: null,
        email: "user@test.ch",
      } as never);

      const result = await confirmTotpSetup(5, "123456");
      expect(result.error).toBe("Kein TOTP-Setup gefunden.");
    });

    it("returns error when TOTP code is invalid", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 5,
        totpSecret: "enc:MOCKSECRET",
        email: "user@test.ch",
      } as never);
      mockOtp.verifySync.mockReturnValueOnce({ valid: false });

      const result = await confirmTotpSetup(5, "wrong");
      expect(result.error).toBe("Falscher Code. Bitte erneut versuchen.");
    });

    it("enables TOTP and returns backup codes on valid code", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: 6,
        totpSecret: "enc:MOCKSECRET",
        email: "user@test.ch",
      } as never);
      mockOtp.verifySync.mockReturnValueOnce({ valid: true });
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const result = await confirmTotpSetup(6, "valid");
      expect(result.success).toBe(true);
      if ("backupCodes" in result) {
        expect(Array.isArray(result.backupCodes)).toBe(true);
      }
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 6 },
        data: expect.objectContaining({ totpEnabled: true }),
      });
      expect(logAudit).toHaveBeenCalled();
    });
  });

  describe("disableTotp", () => {
    it("disables TOTP, logs audit, and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.user.update).mockResolvedValue({ email: "user@test.ch" } as never);

      await disableTotp(7);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { totpEnabled: false, totpSecret: null },
      });
      expect(logAudit).toHaveBeenCalledWith(
        adminSession,
        "UPDATE",
        "User",
        7,
        "user@test.ch",
        { action: "totp-disabled" }
      );
      expect(revalidatePath).toHaveBeenCalledWith("/settings/users");
    });
  });
});
