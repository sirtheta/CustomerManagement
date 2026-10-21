/** German labels for the `entityType` values of the audit log (stored in English, shown as «Bereich»). */
export const ENTITY_LABELS: Record<string, string> = {
  Invoice: "Rechnung",
  Quote: "Offerte",
  Payment: "Zahlung",
  Customer: "Kunde",
  CustomerContact: "Kontaktperson",
  CustomerNote: "Notiz",
  CustomerDocument: "Kundendokument",
  Expense: "Ausgabe",
  ExpenseReceipt: "Ausgabenbeleg",
  InvoiceTemplate: "Rechnungsvorlage",
  PendingEmail: "Abo-Rechnung (zur Freigabe)",
  Reminder: "Mahnung",
  SentDocument: "Versand-PDF",
  Settings: "Einstellungen",
  Subscription: "Abo",
  Task: "Aufgabe",
  User: "Benutzer",
  WorkEntry: "Zeiteintrag",
  BankStatementImport: "Kontoauszug-Import",
  Service: "Leistung",
  Category: "Kategorie",
  LogFile: "Logdatei",
  Backup: "Datensicherung",
  YearPackage: "Jahrespaket",
};

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}
