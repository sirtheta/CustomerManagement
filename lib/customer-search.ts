import { normalizeUid } from "@/lib/customer-uid";

/** OR conditions for a free-text customer search, shared by the customer list and the global search. */
export function customerSearchConditions(term: string) {
  // A UID typed without prefix or separators (116281710) still finds the stored CHE-116.281.710.
  const uid = normalizeUid(term) ?? normalizeUid(`CHE${term}`);
  return [
    { company: { contains: term } },
    { contactPerson: { contains: term } },
    { email: { contains: term } },
    { city: { contains: term } },
    { billingEmail: { contains: term } },
    { uid: { contains: term } },
    {
      contacts: {
        some: {
          OR: [
            { name: { contains: term } },
            { role: { contains: term } },
            { email: { contains: term } },
            { phone: { contains: term } },
          ],
        },
      },
    },
    ...(uid ? [{ uid }] : []),
    // Customer numbers are integers: match them exactly, only for purely numeric terms.
    ...(/^\d{1,9}$/.test(term) ? [{ customerNumber: Number(term) }] : []),
  ];
}
