import { billingRecipient, type AddressCustomer } from "@/lib/customer-billing";

export type QrBillInput = {
  invoice: {
    documentNumber: string | null;
    totalAmount: number;
  };
  company: {
    companyIBAN?: string | null;
    companyName?: string | null;
    companyHolderName?: string | null;
    companyStreet?: string | null;
    companyHouseNumber?: string | null;
    companyZip?: string | null;
    companyCity?: string | null;
    companyCountry?: string | null;
    useHolderNameOnQR?: boolean | null;
  };
  customer: AddressCustomer;
};

export type QrBillData = {
  currency: "CHF";
  amount: number;
  creditor: {
    name: string;
    address: string;
    buildingNumber?: string;
    zip: string;
    city: string;
    account: string;
    country: string;
  };
  debtor: {
    name: string;
    address: string;
    buildingNumber?: string;
    zip: string;
    city: string;
    country: string;
  };
  message?: string;
};

// The building number is optional; an empty string would still be emitted as a
// (blank) field, so only include the key when there is a value.
function buildingNumberField(value?: string | null): { buildingNumber?: string } {
  const trimmed = value?.trim();
  return trimmed ? { buildingNumber: trimmed } : {};
}

/**
 * Builds the SwissQRBill options object from invoice, company, and customer data.
 * Returns null when no IBAN is configured (QR bill cannot be generated).
 */
export function buildQrBillData({
  invoice,
  company,
  customer,
}: QrBillInput): QrBillData | null {
  if (!company.companyIBAN) return null;

  const iban = company.companyIBAN.replace(/\s/g, "");

  const debtor = billingRecipient(customer);

  const creditorName = company.useHolderNameOnQR
    ? (company.companyHolderName ?? company.companyName ?? "")
    : (company.companyName ?? company.companyHolderName ?? "");

  return {
    currency: "CHF",
    amount: invoice.totalAmount,
    creditor: {
      name: creditorName,
      address: company.companyStreet ?? "",
      ...buildingNumberField(company.companyHouseNumber),
      zip: company.companyZip ?? "",
      city: company.companyCity ?? "",
      account: iban,
      country: company.companyCountry || "CH",
    },
    debtor: {
      name: debtor.name,
      address: debtor.street,
      ...buildingNumberField(debtor.houseNumber),
      zip: debtor.zipCode,
      city: debtor.city,
      country: debtor.country,
    },
    message: invoice.documentNumber ?? undefined,
  };
}
