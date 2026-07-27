import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().optional(),
});

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
  if (env.NODE_ENV === "production" && !env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET must be set in production");
  }
  return env;
}
