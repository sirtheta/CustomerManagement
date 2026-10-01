import { customerDisplayName } from "@/lib/customer-display";

/** Optional F10 fields; all may be absent on partial customer objects (tests, previews). */
export type BillingFields = {
  customerNumber?: number | null;
  uid?: string | null;
  billingName?: string | null;
  billingStreet?: string | null;
  billingHouseNumber?: string | null;
  billingZipCode?: string | null;
  billingCity?: string | null;
  billingCountry?: string | null;
  billingEmail?: string | null;
  paymentTermDays?: number | null;
};

export type AddressCustomer = {
  contactInsteadOfCompany: boolean;
  company?: string | null;
  contactPerson: string;
  street: string;
  houseNumber?: string | null;
  zipCode: string;
  city: string;
  country?: string | null;
} & BillingFields;

export type Recipient = {
  name: string;
  /** Second line (contact person under the company name); null when not shown. */
  contactLine: string | null;
  street: string;
  houseNumber: string | null;
  zipCode: string;
  city: string;
  country: string;
  uid: string | null;
};

const filled = (value?: string | null) => !!value?.trim();

/** A billing address counts as set when street, zip and city are all filled in. */
export function hasBillingAddress(c: BillingFields): boolean {
  return filled(c.billingStreet) && filled(c.billingZipCode) && filled(c.billingCity);
}

function ownAddress(c: AddressCustomer, uid: string | null): Recipient {
  return {
    name: customerDisplayName({
      company: c.company ?? null,
      contactPerson: c.contactPerson,
      contactInsteadOfCompany: c.contactInsteadOfCompany,
    }),
    contactLine: !c.contactInsteadOfCompany && c.company ? c.contactPerson : null,
    street: c.street,
    houseNumber: c.houseNumber ?? null,
    zipCode: c.zipCode,
    city: c.city,
    country: c.country || "CH",
    uid,
  };
}

/** Recipient of invoices and reminders: the billing address if set, else the customer address. */
export function billingRecipient(c: AddressCustomer): Recipient {
  const uid = c.uid ?? null;
  if (!hasBillingAddress(c)) return ownAddress(c, uid);
  const own = ownAddress(c, uid);
  return {
    name: filled(c.billingName) ? c.billingName!.trim() : own.name,
    contactLine: null,
    street: c.billingStreet!.trim(),
    houseNumber: filled(c.billingHouseNumber) ? c.billingHouseNumber!.trim() : null,
    zipCode: c.billingZipCode!.trim(),
    city: c.billingCity!.trim(),
    country: c.billingCountry || "CH",
    uid,
  };
}

/** Recipient of quotes: always the customer address, never the UID. */
export function customerRecipient(c: AddressCustomer): Recipient {
  return ownAddress(c, null);
}

export function billingEmail(c: { email: string; billingEmail?: string | null }): string {
  return filled(c.billingEmail) ? c.billingEmail!.trim() : c.email;
}

export function effectivePaymentTermDays(
  c: { paymentTermDays?: number | null } | null | undefined,
  defaultDays: number
): number {
  return c?.paymentTermDays ?? defaultDays;
}
