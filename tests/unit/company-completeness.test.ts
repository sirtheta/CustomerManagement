import { describe, expect, it } from "vitest";
import { holderNameOnQrBlocker, holderNameOnQrForced, missingCompanyFields } from "@/lib/company-completeness";

const complete = {
  companyName: "Muster AG",
  companyHolderName: null,
  companyIBAN: "CH9300762011623852957",
  companyStreet: "Bahnhofstrasse",
  companyZip: "8001",
  companyCity: "Zürich",
  companyEmail: "info@muster.ch",
  companyPhone: "044 123 45 67",
  companyLogo: Buffer.from([1]),
};

describe("missingCompanyFields", () => {
  it("returns nothing for complete data", () => {
    expect(missingCompanyFields(complete)).toEqual([]);
  });

  it("asks for the creditor name when there is no company row", () => {
    expect(missingCompanyFields(null)).toEqual(["Inhaber-Name", "IBAN", "Strasse", "PLZ", "Ort"]);
  });

  it("also reports optional fields when a company name is set", () => {
    expect(
      missingCompanyFields({ ...complete, companyPhone: "  ", companyEmail: null, companyLogo: Buffer.alloc(0) })
    ).toEqual(["E-Mail", "Telefon", "Logo"]);
  });

  it("is done with the mandatory fields and a holder name when the company name is empty", () => {
    expect(
      missingCompanyFields({
        ...complete,
        companyName: " ",
        companyHolderName: "Hans Muster",
        companyEmail: null,
        companyPhone: null,
        companyLogo: null,
      })
    ).toEqual([]);
  });

  it("still needs a holder name without a company name", () => {
    expect(missingCompanyFields({ ...complete, companyName: null })).toEqual(["Inhaber-Name"]);
  });
});

describe("holderNameOnQrForced", () => {
  it("is forced exactly when the company name is empty", () => {
    expect(holderNameOnQrForced(complete)).toBe(false);
    expect(holderNameOnQrForced({ ...complete, companyName: "  " })).toBe(true);
    expect(holderNameOnQrForced(null)).toBe(true);
  });
});

describe("holderNameOnQrBlocker", () => {
  it("allows the switch once holder name, IBAN and address exist", () => {
    expect(holderNameOnQrBlocker({ ...complete, companyHolderName: "Hans Muster" })).toBeNull();
  });

  it("names every missing field", () => {
    expect(holderNameOnQrBlocker({ ...complete, companyHolderName: " ", companyCity: null })).toBe(
      "Zuerst Inhaber / Name, Ort bei den Firmendaten ausfüllen und speichern."
    );
  });

  it("blocks without a company row", () => {
    expect(holderNameOnQrBlocker(null)).toContain("Inhaber / Name, IBAN, Strasse, PLZ, Ort");
  });
});
