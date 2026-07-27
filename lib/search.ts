import type { InvoiceState, PrismaClient, QuoteState } from "@prisma/client";

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_RESULTS = 5;

export type CustomerHit = {
  customerId: number;
  company: string | null;
  contactPerson: string;
  contactInsteadOfCompany: boolean;
  zipCode: string;
  city: string;
};

// Plain serializable DTO: Date as ISO string, Decimal as number, so results
// can cross the server-action boundary to client components.
export type DocumentHit<TState extends string> = {
  id: number;
  documentNumber: string;
  date: string;
  totalAmount: number;
  state: TState;
  customerName: string;
};

export type GlobalSearchResults = {
  customers: CustomerHit[];
  invoices: DocumentHit<InvoiceState>[];
  quotes: DocumentHit<QuoteState>[];
};

export const EMPTY_SEARCH_RESULTS: GlobalSearchResults = {
  customers: [],
  invoices: [],
  quotes: [],
};

export function customerDisplayName(c: {
  company: string | null;
  contactPerson: string;
  contactInsteadOfCompany: boolean;
}): string {
  return c.contactInsteadOfCompany ? c.contactPerson : (c.company || c.contactPerson);
}

const documentSelect = {
  id: true,
  documentNumber: true,
  date: true,
  totalAmount: true,
  state: true,
  customer: {
    select: { company: true, contactPerson: true, contactInsteadOfCompany: true },
  },
} as const;

export async function searchGlobal(
  db: PrismaClient,
  term: string,
  limit = SEARCH_MAX_RESULTS
): Promise<GlobalSearchResults> {
  const q = term.trim();
  if (!q) return EMPTY_SEARCH_RESULTS;

  const documentWhere = {
    OR: [
      { documentNumber: { contains: q } },
      { customer: { company: { contains: q } } },
      { customer: { contactPerson: { contains: q } } },
    ],
  };

  const [customers, invoices, quotes] = await Promise.all([
    db.customer.findMany({
      where: {
        OR: [
          { company: { contains: q } },
          { contactPerson: { contains: q } },
          { email: { contains: q } },
          { city: { contains: q } },
        ],
      },
      select: {
        customerId: true,
        company: true,
        contactPerson: true,
        contactInsteadOfCompany: true,
        zipCode: true,
        city: true,
      },
      take: limit,
      orderBy: { contactPerson: "asc" },
    }),
    db.invoice.findMany({
      where: documentWhere,
      select: documentSelect,
      take: limit,
      orderBy: { date: "desc" },
    }),
    db.quote.findMany({
      where: documentWhere,
      select: documentSelect,
      take: limit,
      orderBy: { date: "desc" },
    }),
  ]);

  const toHit = <TState extends string>(doc: {
    id: number;
    documentNumber: string;
    date: Date;
    totalAmount: { toNumber(): number };
    state: TState;
    customer: { company: string | null; contactPerson: string; contactInsteadOfCompany: boolean };
  }): DocumentHit<TState> => ({
    id: doc.id,
    documentNumber: doc.documentNumber,
    date: doc.date.toISOString(),
    totalAmount: doc.totalAmount.toNumber(),
    state: doc.state,
    customerName: customerDisplayName(doc.customer),
  });

  return {
    customers,
    invoices: invoices.map(toHit),
    quotes: quotes.map(toHit),
  };
}
