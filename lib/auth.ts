import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { verifyTotpOrBackup, claimTotpStep } from "@/lib/backup-codes";
import { decryptSecret } from "@/lib/crypto";
import { dummyCompare } from "@/lib/password";
import logger from "@/lib/logger";
import { checkRateLimit, refundAttempt, resetRateLimit } from "@/lib/rate-limit";
import { clientIp, ipBucket } from "@/lib/client-ip";
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
  logger: {
    error(error) {
      if (error instanceof CredentialsSignin) {
        const code = "code" in error ? error.code : undefined;
        log.info({ code }, "auth: sign-in rejected");
        return;
      }
      log.error(error);
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
        totpCode: { label: "Authenticator Code", type: "text" },
      },
      async authorize(credentials, request) {
        // null unless TRUST_PROXY_HEADERS is configured (see lib/client-ip.ts).
        const ip = clientIp(request?.headers);

        // Per-IP throttle on top of the per-account one below: without it a
        // single host can spray many different accounts and never trip the
        // account limit. The attempt is counted *before* the awaits below, so
        // parallel requests cannot all pass the check before any has failed,
        // and handed back (refundIp) on every path that is not a failed
        // credential check, so shared IPs (office NAT) are not locked out by
        // normal use. The ceiling is deliberately higher than the per-account
        // one for the same reason.
        const ipKey = ip ? `login-ip:${ipBucket(ip)}` : null;
        const ipLimit = { maxAttempts: config.rateLimit.maxAttempts * 4 };
        if (ipKey && !checkRateLimit(ipKey, ipLimit)) {
          log.warn({ ip }, "login blocked: ip rate limit exceeded");
          return null;
        }
        const refundIp = () => {
          if (ipKey) refundAttempt(ipKey);
        };

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          log.warn({ ip }, "login failed: malformed credentials");
          // Nothing was checked (e.g. a mistyped, too short TOTP code).
          refundIp();
          return null;
        }

        const { email, password, totpCode } = parsed.data;

        const rateLimitKey = `login:${email}`;
        if (!checkRateLimit(rateLimitKey)) {
          log.warn({ email, ip }, "login blocked: rate limit exceeded");
          // No credential was checked; don't let a locked account drain the
          // shared IP bucket of everyone behind the same NAT.
          refundIp();
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          // Equalize response time with the real password check so the
          // duration does not reveal whether the email exists.
          await dummyCompare(password);
          log.warn({ email, ip }, "login failed: user not found or inactive");
          return null;
        }

        const passwordValid = await compare(password, user.passwordHash);
        if (!passwordValid) {
          log.warn({ email, ip }, "login failed: wrong password");
          return null;
        }

        if (user.totpEnabled) {
          if (!totpCode || !user.totpSecret) {
            log.warn({ email, ip }, "login failed: totp required but code missing");
            // The password was right; asking for the code is the normal flow.
            refundIp();
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
          const verify = verifyTotpOrBackup(
            totpCode,
            decryptSecret(user.totpSecret),
            backupCodes,
            user.totpLastStep
          );
          if (!verify.valid) {
            log.warn({ email, ip }, "login failed: invalid totp code");
            throw new TotpInvalidError();
          }
          if (verify.consumedIndex === null) {
            // A TOTP code stays valid for its whole time step: remember the
            // step so the same code cannot be used for a second login.
            if (!(await claimTotpStep(prisma, user.id, verify.timeStep))) {
              log.warn({ email, ip }, "login failed: totp code already used");
              throw new TotpInvalidError();
            }
          } else {
            const remaining = backupCodes.filter((_, i) => i !== verify.consumedIndex);
            // Conditional update so two concurrent logins can't both spend
            // the same backup code: only succeeds if the stored value is
            // still the one we verified against.
            const { count } = await prisma.user.updateMany({
              where: { id: user.id, totpBackupCodes: user.totpBackupCodes },
              data: { totpBackupCodes: JSON.stringify(remaining) },
            });
            if (count === 0) {
              log.warn({ email, ip }, "login failed: backup code concurrently consumed");
              throw new TotpInvalidError();
            }
            log.info({ email, userId: user.id, ip }, "login: backup code consumed");
          }
        }

        resetRateLimit(rateLimitKey);
        refundIp();
        log.info({ email, userId: user.id, ip }, "login success");
        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
          sessionEpoch: user.sessionEpoch,
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
        token.sessionEpoch = (user as { sessionEpoch?: number }).sessionEpoch ?? 0;
        return token;
      }
      // Re-check on every subsequent request so a password reset (which bumps
      // User.sessionEpoch) kills sessions that are already out there, instead
      // of leaving them valid until the JWT naturally expires.
      const userId = parseInt(String(token.id), 10);
      if (!Number.isInteger(userId)) return null;
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { sessionEpoch: true, isActive: true, role: true },
      });
      if (!dbUser) {
        log.info({ userId: token.id }, "session invalidated: user missing");
        return null;
      }
      if (!dbUser.isActive) {
        log.info({ userId: token.id }, "session invalidated: user deactivated");
        return null;
      }
      // Role from the database, so a demotion applies to sessions already out there.
      token.role = dbUser.role;
      const tokenEpoch = typeof token.sessionEpoch === "number" ? token.sessionEpoch : 0;
      if (tokenEpoch !== dbUser.sessionEpoch) {
        log.info({ userId: token.id }, "session invalidated: credentials changed");
        return null;
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
