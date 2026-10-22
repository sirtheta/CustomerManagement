import type { PrismaClient, SenderProfile } from "@prisma/client";

/** What a profile may override; everything else (address, IBAN) always comes from the company data. */
export type SenderOverrides = Pick<
  SenderProfile,
  "companyName" | "companyHolderName" | "companyEmail" | "companyPhone"
> & { logo: Uint8Array | Buffer | null };

type CompanyLike = {
  companyName?: string | null;
  companyHolderName?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  companyLogo?: Uint8Array | Buffer | null;
};

const blankToNull = (value: string | null | undefined) => value?.trim() || null;

/**
 * The company data are the first profile. A selected profile replaces only the fields it has
 * filled in; an empty field (and no profile at all) keeps the company value. The QR bill creditor
 * and the IBAN are never overridden: they must match the account, so callers pass the unchanged
 * company data to `buildQrBillData`.
 */
export function applySenderProfile<T extends CompanyLike>(
  company: T,
  profile: SenderOverrides | null | undefined
): T {
  if (!profile) return company;
  return {
    ...company,
    companyName: blankToNull(profile.companyName) ?? company.companyName,
    companyHolderName: blankToNull(profile.companyHolderName) ?? company.companyHolderName,
    companyEmail: blankToNull(profile.companyEmail) ?? company.companyEmail,
    companyPhone: blankToNull(profile.companyPhone) ?? company.companyPhone,
    companyLogo: profile.logo ?? company.companyLogo,
  };
}

/** Name used in mail subjects and signatures («Mit freundlichen Grüssen {companyName}»). */
export function senderDisplayName(
  company: { companyName?: string | null },
  profile: Pick<SenderProfile, "companyName"> | null | undefined
): string {
  return blankToNull(profile?.companyName) ?? company.companyName ?? "";
}

/** Suffix of a PDF cache key: empty without a profile (keeps existing keys), changes whenever the profile is edited. */
export function senderProfileCacheSuffix(profile: Pick<SenderProfile, "id" | "updatedAt"> | null | undefined): string {
  return profile ? `-s${profile.id}-${profile.updatedAt.getTime()}` : "";
}

export const SENDER_PROFILE_NOT_FOUND_ERROR = "Das gewählte Absender-Profil existiert nicht mehr.";
export const SENDER_PROFILE_INACTIVE_ERROR = "Das gewählte Absender-Profil ist inaktiv.";

/**
 * Reads the profile choice of a document form. An empty value means the first profile (`null`).
 * An inactive profile stays valid for the document that already uses it (`currentId`).
 */
export async function resolveSenderProfileId(
  prisma: Pick<PrismaClient, "senderProfile">,
  raw: FormDataEntryValue | null,
  currentId: number | null = null
): Promise<{ id: number | null; error?: undefined } | { error: string }> {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { id: null };
  const id = parseInt(text, 10);
  if (Number.isNaN(id)) return { error: SENDER_PROFILE_NOT_FOUND_ERROR };
  const profile = await prisma.senderProfile.findUnique({ where: { id }, select: { isActive: true } });
  if (!profile) return { error: SENDER_PROFILE_NOT_FOUND_ERROR };
  if (!profile.isActive && id !== currentId) return { error: SENDER_PROFILE_INACTIVE_ERROR };
  return { id };
}
