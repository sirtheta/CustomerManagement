import { describe, it, expect, afterEach, vi } from "vitest";
import { validateEnv } from "@/lib/env";

const originalEnv = process.env;

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
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

  it("passes in production when AUTH_SECRET is long enough", () => {
    process.env = { NODE_ENV: "production", AUTH_SECRET: "k3Jx9mQ2vLp7TnR4wY8zB1cD6fG0hA5s" };
    expect(() => validateEnv()).not.toThrow();
  });

  // AUTH_SECRET also derives the key for stored secrets (SMTP password, Telegram
  // token, TOTP secrets): swapping it makes them unreadable. An existing
  // deployment with a short (not publicly known) secret must therefore keep
  // starting, with a warning, instead of being forced to rotate on update.
  it("only warns in production when AUTH_SECRET is shorter than 32 characters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env = { NODE_ENV: "production", AUTH_SECRET: "prod-secret-value" };
    expect(() => validateEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("32");
  });

  it("does not warn for a long enough AUTH_SECRET", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env = { NODE_ENV: "production", AUTH_SECRET: "k3Jx9mQ2vLp7TnR4wY8zB1cD6fG0hA5s" };
    validateEnv();
    expect(warn).not.toHaveBeenCalled();
  });

  it("explains the consequences of changing AUTH_SECRET when it refuses a placeholder", () => {
    process.env = { NODE_ENV: "production", AUTH_SECRET: "ersetzen-mit-zufaelligem-string-min-32-zeichen" };
    expect(() => validateEnv()).toThrow(/SMTP/);
    expect(() => validateEnv()).toThrow(/TOTP/);
    expect(() => validateEnv()).toThrow("ALLOW_INSECURE_AUTH_SECRET");
  });

  it("starts with a placeholder AUTH_SECRET only when ALLOW_INSECURE_AUTH_SECRET=true (and warns)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env = {
      NODE_ENV: "production",
      AUTH_SECRET: "ersetzen-mit-zufaelligem-string-min-32-zeichen",
      ALLOW_INSECURE_AUTH_SECRET: "true",
    };
    expect(() => validateEnv()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("throws in production when AUTH_SECRET is the placeholder from .env.example", () => {
    process.env = {
      NODE_ENV: "production",
      AUTH_SECRET: "ersetzen-mit-zufaelligem-string-min-32-zeichen",
    };
    expect(() => validateEnv()).toThrow("placeholder");
  });

  it("throws in production when AUTH_URL is the placeholder from .env.example", () => {
    process.env = {
      NODE_ENV: "production",
      AUTH_SECRET: "k3Jx9mQ2vLp7TnR4wY8zB1cD6fG0hA5s",
      AUTH_URL: "https://customers.deine-domain.ch",
    };
    expect(() => validateEnv()).toThrow("AUTH_URL");
  });

  // docker-compose.test.yml loads .env.test (copied from .env.test.example) with NODE_ENV=production.
  it("throws in production when AUTH_SECRET is the placeholder from .env.test.example", () => {
    process.env = {
      NODE_ENV: "production",
      AUTH_SECRET: "<zufaelliger-32-Zeichen-String-hier-eintragen>",
    };
    expect(() => validateEnv()).toThrow("placeholder");
  });

  it("throws in production when AUTH_URL is the placeholder from .env.test.example", () => {
    process.env = {
      NODE_ENV: "production",
      AUTH_SECRET: "k3Jx9mQ2vLp7TnR4wY8zB1cD6fG0hA5s",
      AUTH_URL: "https://test.deinedomain.ch",
    };
    expect(() => validateEnv()).toThrow("AUTH_URL");
  });

  it("passes in production with a real AUTH_URL", () => {
    process.env = {
      NODE_ENV: "production",
      AUTH_SECRET: "k3Jx9mQ2vLp7TnR4wY8zB1cD6fG0hA5s",
      AUTH_URL: "https://kunden.example.ch",
    };
    expect(() => validateEnv()).not.toThrow();
  });

  it("does not enforce the length or placeholder rules in development", () => {
    process.env = { NODE_ENV: "development", AUTH_SECRET: "ersetzen-mit-zufaelligem-string-min-32-zeichen" };
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
