export type QrBillInput = {
  invoice: {
    documentNumber: string;
    totalAmount: number;
  };
  company: {
    companyIBAN?: string | null;
    companyName?: string | null;
    companyHolderName?: string | null;
    companyAddress?: string | null;
    companyZip?: string | null;
    companyCity?: string | null;
    useHolderNameOnQR?: boolean | null;
  };
  customer: {
    contactInsteadOfCompany: boolean;
    company?: string | null;
    contactPerson: string;
    address: string;
    zipCode: string;
    city: string;
  };
};

export type QrBillData = {
  currency: "CHF";
  amount: number;
  creditor: {
    name: string;
    address: string;
    zip: string;
    city: string;
    account: string;
    country: "CH";
  };
  debtor: {
    name: string;
    address: string;
    zip: string;
    city: string;
    country: "CH";
  };
  message: string;
};

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

  const debtorName =
    customer.contactInsteadOfCompany || !customer.company
      ? customer.contactPerson
      : customer.company;

  const creditorName = company.useHolderNameOnQR
    ? (company.companyHolderName ?? company.companyName ?? "")
    : (company.companyName ?? company.companyHolderName ?? "");

  return {
    currency: "CHF",
    amount: invoice.totalAmount,
    creditor: {
      name: creditorName,
      address: company.companyAddress ?? "",
      zip: company.companyZip ?? "",
      city: company.companyCity ?? "",
      account: iban,
      country: "CH",
    },
    debtor: {
      name: debtorName,
      address: customer.address,
      zip: customer.zipCode,
      city: customer.city,
      country: "CH",
    },
    message: invoice.documentNumber,
  };
}
