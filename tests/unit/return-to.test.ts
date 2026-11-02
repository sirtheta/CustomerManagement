import { describe, expect, it } from "vitest";
import { afterDeleteHref, afterEditHref, fromCrumbs, parseFrom, withFrom } from "@/lib/return-to";

describe("return-to", () => {
  describe("parseFrom", () => {
    it("accepts customer pages and known overview pages", () => {
      expect(parseFrom("customers/42")).toBe("customers/42");
      expect(parseFrom("invoices/pending")).toBe("invoices/pending");
      expect(parseFrom("invoices/reminders")).toBe("invoices/reminders");
      expect(parseFrom("accounting/receivables")).toBe("accounting/receivables");
    });

    it("refuses anything else", () => {
      expect(parseFrom(null)).toBeNull();
      expect(parseFrom(undefined)).toBeNull();
      expect(parseFrom("")).toBeNull();
      expect(parseFrom("invoices/42")).toBeNull();
      expect(parseFrom("customers/42/../../settings")).toBeNull();
      expect(parseFrom("customers/42?edit=true")).toBeNull();
      expect(parseFrom("//evil.example")).toBeNull();
      expect(parseFrom("constructor")).toBeNull();
    });
  });

  it("withFrom appends with ? or &", () => {
    expect(withFrom("/invoices/5", null)).toBe("/invoices/5");
    expect(withFrom("/invoices/5", "customers/1")).toBe("/invoices/5?from=customers/1");
    expect(withFrom("/invoices/5?flash=x", "customers/1")).toBe("/invoices/5?flash=x&from=customers/1");
  });

  it("afterEditHref returns to the approval page, otherwise to the document", () => {
    expect(afterEditHref("/invoices/5", "invoices/pending")).toBe("/invoices/pending");
    expect(afterEditHref("/invoices/5", "customers/1")).toBe("/invoices/5?from=customers/1");
    expect(afterEditHref("/invoices/5", "invoices/reminders")).toBe("/invoices/5?from=invoices/reminders");
    expect(afterEditHref("/invoices/5", null)).toBe("/invoices/5");
  });

  it("afterDeleteHref goes back to the origin page with the flash", () => {
    expect(afterDeleteHref("/invoices", "invoice-deleted", "customers/7")).toBe("/customers/7?flash=invoice-deleted");
    expect(afterDeleteHref("/invoices", "invoice-deleted", null)).toBe("/invoices?flash=invoice-deleted");
  });

  it("fromCrumbs names the origin page", () => {
    const fallback = { label: "Rechnungen", href: "/invoices" };
    expect(fromCrumbs(null, "Muster AG", fallback)).toEqual([fallback]);
    expect(fromCrumbs("customers/7", "Muster AG", fallback)).toEqual([
      { label: "Kunden", href: "/customers" },
      { label: "Muster AG", href: "/customers/7" },
    ]);
    expect(fromCrumbs("invoices/pending", "Muster AG", fallback).at(-1)).toEqual({
      label: "Abo-Rechnungen freigeben",
      href: "/invoices/pending",
    });
  });
});
