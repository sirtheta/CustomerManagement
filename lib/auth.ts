import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { verifyTotpOrBackup } from "@/lib/backup-codes";
import { decryptSecret } from "@/lib/crypto";
import { dummyCompare } from "@/lib/password";
import logger from "@/lib/logger";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/config";

const log = logger.child({ module: "auth" });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.preprocess(
    (v) => (typeof v === "string" && v === "" ? undefined : v),
    z.string().min(6).max(9).optional()
  ),
});

// Thrown from authorize() to tell the login form apart from a plain wrong
// email/password: the client needs to show the TOTP code field instead of a
// generic error. `code` ends up on the error instance (see CredentialsSignin
// in next-auth), which the login action reads to decide which state to return.
class TotpRequiredError extends CredentialsSignin {
  code = "totp_required";
}
class TotpInvalidError extends CredentialsSignin {
  code = "totp_invalid";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
        totpCode: { label: "Authenticator Code", type: "text" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password, totpCode } = parsed.data;

        const rateLimitKey = `login:${email}`;
        if (!checkRateLimit(rateLimitKey)) {
          log.warn({ email }, "login blocked: rate limit exceeded");
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          // Equalize response time with the real password check so the
          // duration does not reveal whether the email exists.
          await dummyCompare(password);
          log.warn({ email }, "login failed: user not found or inactive");
          return null;
        }

        const passwordValid = await compare(password, user.passwordHash);
        if (!passwordValid) {
          log.warn({ email }, "login failed: wrong password");
          return null;
        }

        if (user.totpEnabled) {
          if (!totpCode || !user.totpSecret) {
            log.warn({ email }, "login failed: totp required but code missing");
            throw new TotpRequiredError();
          }
          let backupCodes: string[] = [];
          if (user.totpBackupCodes) {
            try {
              backupCodes = JSON.parse(user.totpBackupCodes);
            } catch {
              log.error({ userId: user.id }, "invalid totpBackupCodes JSON — ignoring backup codes");
            }
          }
          const verify = verifyTotpOrBackup(totpCode, decryptSecret(user.totpSecret), backupCodes);
          if (!verify.valid) {
            log.warn({ email }, "login failed: invalid totp code");
            throw new TotpInvalidError();
          }
          if (verify.consumedIndex !== null) {
            const remaining = backupCodes.filter((_, i) => i !== verify.consumedIndex);
            // Conditional update so two concurrent logins can't both spend
            // the same backup code: only succeeds if the stored value is
            // still the one we verified against.
            const { count } = await prisma.user.updateMany({
              where: { id: user.id, totpBackupCodes: user.totpBackupCodes },
              data: { totpBackupCodes: JSON.stringify(remaining) },
            });
            if (count === 0) {
              log.warn({ email }, "login failed: backup code concurrently consumed");
              throw new TotpInvalidError();
            }
            log.info({ email, userId: user.id }, "login: backup code consumed");
          }
        }

        resetRateLimit(rateLimitKey);
        log.info({ email, userId: user.id }, "login success");
        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: config.session.maxAgeSec,
    updateAge: config.session.updateAgeSec,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: UserRole }).role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as UserRole;
      return session;
    },
  },
});
