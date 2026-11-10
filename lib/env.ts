import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z.string().optional(),
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
    // The secret signs sessions and derives the key that encrypts stored secrets.
    if (env.AUTH_SECRET.length < MIN_AUTH_SECRET_LENGTH) {
      throw new Error(`AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters in production`);
    }
    if (AUTH_SECRET_PLACEHOLDER.test(env.AUTH_SECRET)) {
      throw new Error("AUTH_SECRET is still the placeholder from .env.example; set a random value");
    }
    if (env.AUTH_URL && AUTH_URL_PLACEHOLDER.test(env.AUTH_URL)) {
      throw new Error("AUTH_URL is still the placeholder from .env.example; set the real address");
    }
  }
  return env;
}
