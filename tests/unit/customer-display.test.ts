import { describe, it, expect } from "vitest";
import { customerDisplayName } from "@/lib/customer-display";

describe("customerDisplayName", () => {
  it("should return the company when contactInsteadOfCompany is false", () => {
    expect(
      customerDisplayName({
        company: "Muster AG",
        contactPerson: "Hans Muster",
        contactInsteadOfCompany: false,
      })
    ).toBe("Muster AG");
  });

  it("should return the contact person when contactInsteadOfCompany is true", () => {
    expect(
      customerDisplayName({
        company: "Muster AG",
        contactPerson: "Hans Muster",
        contactInsteadOfCompany: true,
      })
    ).toBe("Hans Muster");
  });

  it("should fall back to the contact person when company is missing", () => {
    expect(
      customerDisplayName({
        company: null,
        contactPerson: "Hans Muster",
        contactInsteadOfCompany: false,
      })
    ).toBe("Hans Muster");

    expect(
      customerDisplayName({
        company: "",
        contactPerson: "Hans Muster",
        contactInsteadOfCompany: false,
      })
    ).toBe("Hans Muster");
  });

  it("should return an empty string when contactPerson is null and contactInsteadOfCompany is true", () => {
    expect(
      customerDisplayName({
        company: "Muster AG",
        contactPerson: null,
        contactInsteadOfCompany: true,
      })
    ).toBe("");
  });
});
