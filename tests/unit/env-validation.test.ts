import { describe, it, expect, afterEach } from "vitest";
import { validateEnv } from "@/lib/env";

const originalEnv = process.env;

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("validateEnv", () => {
  it("passes in development without AUTH_SECRET (NextAuth auto-generates one)", () => {
    process.env = { NODE_ENV: "development" };
    expect(() => validateEnv()).not.toThrow();
  });

  it("passes in development with AUTH_SECRET set", () => {
    process.env = { NODE_ENV: "development", AUTH_SECRET: "some-secret" };
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws in production when AUTH_SECRET is missing", () => {
    process.env = { NODE_ENV: "production" };
    expect(() => validateEnv()).toThrow("AUTH_SECRET must be set in production");
  });

  it("passes in production when AUTH_SECRET is set", () => {
    process.env = { NODE_ENV: "production", AUTH_SECRET: "prod-secret-value" };
    expect(() => validateEnv()).not.toThrow();
  });

  it("passes with optional DATABASE_URL set", () => {
    process.env = { NODE_ENV: "development", DATABASE_URL: "file:./data/test.db" };
    expect(() => validateEnv()).not.toThrow();
  });

  it("rejects an invalid NODE_ENV value", () => {
    process.env = { NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv;
    expect(() => validateEnv()).toThrow();
  });
});
