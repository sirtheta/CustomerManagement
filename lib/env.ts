import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z.string().optional(),
  ALLOW_INSECURE_AUTH_SECRET: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().optional(),
});

const MIN_AUTH_SECRET_LENGTH = 32;
// Values copied unchanged from .env.example and .env.test.example (docker-compose.test.yml
// loads the latter with NODE_ENV=production). The AUTH_SECRET ones are long enough to pass
// the length check, so they are rejected by pattern.
const AUTH_SECRET_PLACEHOLDER = /^ersetzen-mit|^<.*>$|hier-eintragen/i;
const AUTH_URL_PLACEHOLDER = /deine-?domain\.ch/i;

export type Env = z.infer<typeof schema>;

export function validateEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`\n\n❌ Invalid environment variables:\n${errors}\n`);
  }
  const env = result.data;
  // NextAuth v5 auto-generates a secret in development; require it explicitly in production.
  if (env.NODE_ENV === "production") {
    if (!env.AUTH_SECRET) {
      throw new Error("AUTH_SECRET must be set in production");
    }
    checkAuthSecret(env.AUTH_SECRET, env.ALLOW_INSECURE_AUTH_SECRET === "true");
    if (env.AUTH_URL && AUTH_URL_PLACEHOLDER.test(env.AUTH_URL)) {
      throw new Error("AUTH_URL is still the placeholder from .env.example; set the real address");
    }
  }
  return env;
}

/**
 * AUTH_SECRET signs sessions AND derives the key for stored secrets (SMTP
 * password, Telegram token, TOTP secrets), so changing it makes those
 * unreadable until they are re-entered. A secret that is merely short only
 * warns, so an update does not force that on existing deployments. The
 * publicly known placeholder lets anyone forge a session: refused, unless
 * the operator explicitly accepts the risk for the time of a planned rotation.
 */
function checkAuthSecret(secret: string, allowInsecure: boolean): void {
  if (AUTH_SECRET_PLACEHOLDER.test(secret)) {
    const message =
      "AUTH_SECRET is still a placeholder from .env.example / .env.test.example. It is public, so anyone can forge a login session with it. " +
      "Set a random value (min. 32 characters). Changing AUTH_SECRET makes stored secrets unreadable: re-enter the SMTP password and the Telegram bot token " +
      "in the settings, and set up TOTP again for users with 2FA. " +
      "To keep running for now, set ALLOW_INSECURE_AUTH_SECRET=true (not recommended).";
    if (!allowInsecure) throw new Error(message);
    console.warn(`[env] ${message}`);
    return;
  }
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    console.warn(
      `[env] AUTH_SECRET has only ${secret.length} characters; use at least ${MIN_AUTH_SECRET_LENGTH}. ` +
        "Changing it makes stored secrets (SMTP password, Telegram bot token, TOTP secrets) unreadable: re-enter them afterwards."
    );
  }
}
