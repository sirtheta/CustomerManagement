export interface CustomerNameFields {
  company: string | null;
  contactPerson: string | null;
  contactInsteadOfCompany: boolean;
}

export function customerDisplayName(c: CustomerNameFields): string {
  return c.contactInsteadOfCompany
    ? (c.contactPerson ?? "")
    : (c.company || c.contactPerson || "");
}
