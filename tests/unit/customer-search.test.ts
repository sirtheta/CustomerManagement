import { describe, it, expect } from "vitest";
import { customerSearchConditions } from "@/lib/customer-search";

describe("customerSearchConditions", () => {
  it("matches a UID partially and in its normalized form", () => {
    const c = customerSearchConditions("116281710");
    expect(c).toContainEqual({ uid: { contains: "116281710" } });
    expect(c).toContainEqual({ uid: "CHE-116.281.710" });
  });

  it("matches a purely numeric term as customer number", () => {
    expect(customerSearchConditions("1001")).toContainEqual({ customerNumber: 1001 });
    expect(customerSearchConditions("Muster")).not.toContainEqual({ customerNumber: expect.anything() });
  });

  it("matches additional contacts and the billing e-mail", () => {
    const c = customerSearchConditions("buchhaltung@example.ch");
    expect(c).toContainEqual({ billingEmail: { contains: "buchhaltung@example.ch" } });
    expect(c).toContainEqual({
      contacts: { some: { OR: expect.arrayContaining([{ email: { contains: "buchhaltung@example.ch" } }]) } },
    });
  });
});
