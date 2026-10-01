import { describe, it, expect } from "vitest";
import {
  hasBillingAddress,
  billingRecipient,
  customerRecipient,
  billingEmail,
  effectivePaymentTermDays,
} from "@/lib/customer-billing";

const base = {
  contactInsteadOfCompany: false,
  company: "Muster AG",
  contactPerson: "Anna Beispiel",
  street: "Weg",
  houseNumber: "1",
  zipCode: "8000",
  city: "Zürich",
  country: "CH",
  email: "anna@muster.ch",
};

const withBilling = {
  ...base,
  uid: "CHE-116.281.710",
  billingName: "Muster AG, Buchhaltung",
  billingStreet: "Postfach",
  billingHouseNumber: null,
  billingZipCode: "3000",
  billingCity: "Bern",
  billingCountry: "CH",
  billingEmail: "buchhaltung@muster.ch",
};

describe("hasBillingAddress", () => {
  it("needs street, zip and city", () => {
    expect(hasBillingAddress(withBilling)).toBe(true);
    expect(hasBillingAddress({ ...withBilling, billingCity: null })).toBe(false);
    expect(hasBillingAddress({ billingName: "Nur Name" })).toBe(false);
    expect(hasBillingAddress({})).toBe(false);
  });
});

describe("billingRecipient", () => {
  it("falls back to the customer address", () => {
    expect(billingRecipient(base)).toEqual({
      name: "Muster AG",
      contactLine: "Anna Beispiel",
      street: "Weg",
      houseNumber: "1",
      zipCode: "8000",
      city: "Zürich",
      country: "CH",
      uid: null,
    });
  });

  it("uses the billing address and keeps the UID", () => {
    expect(billingRecipient(withBilling)).toEqual({
      name: "Muster AG, Buchhaltung",
      contactLine: null,
      street: "Postfach",
      houseNumber: null,
      zipCode: "3000",
      city: "Bern",
      country: "CH",
      uid: "CHE-116.281.710",
    });
  });

  it("uses the display name when the billing address has no name", () => {
    const r = billingRecipient({ ...withBilling, billingName: null });
    expect(r.name).toBe("Muster AG");
    expect(r.street).toBe("Postfach");
  });

  it("shows the UID even without a billing address", () => {
    expect(billingRecipient({ ...base, uid: "CHE-116.281.710" }).uid).toBe("CHE-116.281.710");
  });

  it("uses the contact person when contactInsteadOfCompany is set", () => {
    const r = billingRecipient({ ...base, contactInsteadOfCompany: true });
    expect(r.name).toBe("Anna Beispiel");
    expect(r.contactLine).toBeNull();
  });

  it("defaults a missing billing country to CH", () => {
    expect(billingRecipient({ ...withBilling, billingCountry: null }).country).toBe("CH");
  });
});

describe("customerRecipient", () => {
  it("ignores billing data and UID", () => {
    const r = customerRecipient(withBilling);
    expect(r.street).toBe("Weg");
    expect(r.zipCode).toBe("8000");
    expect(r.uid).toBeNull();
  });
});

describe("billingEmail", () => {
  it("prefers the billing e-mail", () => {
    expect(billingEmail({ email: "a@x.ch", billingEmail: "b@x.ch" })).toBe("b@x.ch");
    expect(billingEmail({ email: "a@x.ch", billingEmail: null })).toBe("a@x.ch");
    expect(billingEmail({ email: "a@x.ch" })).toBe("a@x.ch");
    expect(billingEmail({ email: "a@x.ch", billingEmail: "  " })).toBe("a@x.ch");
  });
});

describe("effectivePaymentTermDays", () => {
  it("uses the customer term, else the default", () => {
    expect(effectivePaymentTermDays({ paymentTermDays: 10 }, 30)).toBe(10);
    expect(effectivePaymentTermDays({ paymentTermDays: null }, 30)).toBe(30);
    expect(effectivePaymentTermDays({}, 30)).toBe(30);
    expect(effectivePaymentTermDays(null, 30)).toBe(30);
    expect(effectivePaymentTermDays(undefined, 30)).toBe(30);
  });
});
