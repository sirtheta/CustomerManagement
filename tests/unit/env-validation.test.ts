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

  it("passes in production when AUTH_SECRET is long enough", () => {
    process.env = { NODE_ENV: "production", AUTH_SECRET: "k3Jx9mQ2vLp7TnR4wY8zB1cD6fG0hA5s" };
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws in production when AUTH_SECRET is shorter than 32 characters", () => {
    process.env = { NODE_ENV: "production", AUTH_SECRET: "prod-secret-value" };
    expect(() => validateEnv()).toThrow("at least 32 characters");
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
