import { describe, it, expect, vi } from "vitest";
import {
  applySenderProfile,
  resolveSenderProfileId,
  senderDisplayName,
  senderProfileCacheSuffix,
  SENDER_PROFILE_INACTIVE_ERROR,
  SENDER_PROFILE_NOT_FOUND_ERROR,
} from "@/lib/sender-profile";

const company = {
  companyName: "Muster GmbH",
  companyHolderName: "Hans Muster",
  companyEmail: "hans@muster.ch",
  companyPhone: "044 111 11 11",
  companyLogo: Buffer.from("company-logo"),
  companyIBAN: "CH9300762011623852957",
};

const emptyProfile = { companyName: null, companyHolderName: null, companyEmail: null, companyPhone: null, logo: null };

describe("applySenderProfile", () => {
  it("returns the company data when no profile is selected", () => {
    expect(applySenderProfile(company, null)).toBe(company);
    expect(applySenderProfile(company, undefined)).toBe(company);
  });

  it("takes everything from the company data when the profile has nothing filled in", () => {
    expect(applySenderProfile(company, emptyProfile)).toEqual(company);
  });

  it("treats blank strings like empty fields", () => {
    expect(applySenderProfile(company, { ...emptyProfile, companyName: "   ", companyPhone: "" })).toEqual(company);
  });

  it("overrides only the fields the profile has set", () => {
    const logo = Buffer.from("erika-logo");
    const merged = applySenderProfile(company, {
      ...emptyProfile,
      companyHolderName: "Erika Muster",
      companyEmail: "erika@muster.ch",
      logo,
    });
    expect(merged).toMatchObject({
      companyName: "Muster GmbH",
      companyHolderName: "Erika Muster",
      companyEmail: "erika@muster.ch",
      companyPhone: "044 111 11 11",
      companyIBAN: company.companyIBAN,
    });
    expect(merged.companyLogo).toBe(logo);
  });

  it("does not change the company object", () => {
    applySenderProfile(company, { ...emptyProfile, companyName: "Erika" });
    expect(company.companyName).toBe("Muster GmbH");
  });
});

describe("senderDisplayName", () => {
  it("prefers the profile's company name and falls back to the company", () => {
    expect(senderDisplayName(company, { companyName: "Atelier Erika" })).toBe("Atelier Erika");
    expect(senderDisplayName(company, { companyName: " " })).toBe("Muster GmbH");
    expect(senderDisplayName(company, null)).toBe("Muster GmbH");
    expect(senderDisplayName({}, null)).toBe("");
  });
});

describe("senderProfileCacheSuffix", () => {
  it("is empty without a profile and changes when the profile is edited", () => {
    expect(senderProfileCacheSuffix(null)).toBe("");
    const a = senderProfileCacheSuffix({ id: 2, updatedAt: new Date(1000) });
    const b = senderProfileCacheSuffix({ id: 2, updatedAt: new Date(2000) });
    expect(a).not.toBe(b);
  });
});

describe("resolveSenderProfileId", () => {
  const db = (profile: { isActive: boolean } | null) =>
    ({ senderProfile: { findUnique: vi.fn().mockResolvedValue(profile) } }) as never;

  it("maps an empty choice to the first profile without a lookup", async () => {
    const prisma = db(null);
    expect(await resolveSenderProfileId(prisma, "")).toEqual({ id: null });
    expect(await resolveSenderProfileId(prisma, null)).toEqual({ id: null });
    expect((prisma as never as { senderProfile: { findUnique: unknown } }).senderProfile.findUnique).not.toHaveBeenCalled();
  });

  it("accepts an active profile", async () => {
    expect(await resolveSenderProfileId(db({ isActive: true }), "3")).toEqual({ id: 3 });
  });

  it("refuses an unknown or malformed id", async () => {
    expect(await resolveSenderProfileId(db(null), "3")).toEqual({ error: SENDER_PROFILE_NOT_FOUND_ERROR });
    expect(await resolveSenderProfileId(db({ isActive: true }), "abc")).toEqual({ error: SENDER_PROFILE_NOT_FOUND_ERROR });
  });

  it("refuses an inactive profile unless the document already uses it", async () => {
    expect(await resolveSenderProfileId(db({ isActive: false }), "3")).toEqual({ error: SENDER_PROFILE_INACTIVE_ERROR });
    expect(await resolveSenderProfileId(db({ isActive: false }), "3", 3)).toEqual({ id: 3 });
  });
});
