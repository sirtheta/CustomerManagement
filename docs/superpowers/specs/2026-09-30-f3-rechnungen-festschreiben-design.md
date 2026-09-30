# F3: Rechnungen festschreiben, Gutschrift und Storno

Stand: 2026-09-30. Herkunft: Roadmap Phase 1, Punkt F3 (Befunde U1–U4).

## Ziel

Eine Rechnung, die den Entwurfsstatus verlassen hat, ist nicht mehr änderbar und nicht löschbar. Korrekturen laufen über eine Gutschrift mit Bezug zur Originalrechnung. Kunden mit Rechnungen lassen sich nicht löschen, nur archivieren. Statuswechsel folgen einer Tabelle erlaubter Übergänge.

## Entscheidungen

- **Gutschrift als `Invoice`:** Eine Gutschrift ist eine `Invoice` mit `creditNoteForId` und negativen Beträgen. Kein eigenes Modell. Payments, Einnahmen, Analytics und Export laufen weiter über dieselbe Tabelle.
- **Erstellung:** Aus einer versendeten Rechnung entsteht ein Gutschrift-Entwurf mit allen Positionen. Positionen lassen sich streichen oder anpassen (Teilgutschrift). Danach wird die Gutschrift versendet.
- **Verrechnung:** Restbetrag der Originalrechnung = Total − Zahlungen − versendete Gutschriften. Die Gutschrift ist keine eigene Zeile in der OP-Liste.
- **Kunden:** archivieren statt löschen, sobald Rechnungen existieren.
- **Umfang:** nur Rechnungen. Offerten bleiben bearbeitbar und löschbar wie bisher.
- **Ausgeklammert:** Rückzahlungen an Kunden (etwa als negative Zahlung), Einfluss von Gutschriften auf die Einnahmenrechnung, eigener Nummernkreis für Gutschriften. Die Einnahmen folgen weiter `Payment.date`. Eine Gutschrift über eine unbezahlte Rechnung darf sie nicht verändern.

## Schema

- `Invoice.creditNoteForId Int?`: Selbstbezug auf die Originalrechnung, `onDelete: Restrict`. Index darauf.
- `Invoice.customer`: `onDelete: Restrict` (bisher `Cascade`). `Quote.customer` bleibt `Cascade`.
- `Customer.archivedAt DateTime?`.
- Die Migration ist reines SQL (Produktion wendet Migrationen über `scripts/startup.js` ohne Prisma CLI an). SQLite baut die `Invoice`-Tabelle für die geänderte Fremdschlüsselregel neu auf. Ein Test prüft, dass dabei keine Rechnungen, Positionen oder Zahlungen verloren gehen.

## Festschreiben

- Bearbeitbar sind nur Rechnungen mit `state = Draft`.
- `updateDocumentWithItems` lehnt Rechnungen ausserhalb von `Draft` serverseitig ab, mit einer Fehlermeldung. Das gilt auch bei direktem Aufruf.
- `invoices/[id]/edit/page.tsx` leitet für nicht-Entwürfe auf die Detailseite um. Der Button „Bearbeiten“ erscheint nur bei Entwürfen.

## Statusübergänge

Eine Tabelle erlaubter Übergänge in `lib/state-manager.ts`, geprüft in `updateInvoiceStatus`:

- `Draft` → `Sent` oder `Paid` (weist die Nummer zu, wie heute).
- `Sent` ↔ `Overdue`.
- Ziel `Paid` nur über eine Zahlung (F5).
- Kein Übergang zurück nach `Draft`.
- `Canceled` ist kein manuelles Ziel mehr. Der Status ergibt sich nur aus einer Gutschrift (siehe unten). Bereits stornierte Rechnungen bleiben stornierte, gesperrte Rechnungen.
- Weg von `Paid` oder `PartiallyPaid` geht nur über das Löschen der Zahlungen (F5, unverändert).

## Löschen und Kunden

- `deleteInvoice` (Admin) gilt nur für Entwürfe. Sonst: „Versendete Rechnungen können nicht gelöscht werden. Stattdessen eine Gutschrift erstellen.“ Gutschrift-Entwürfe sind löschbar.
- `deleteCustomer` meldet „Kunde hat Rechnungen. Bitte archivieren.“ Die Datenbank sichert das zusätzlich über `Restrict` ab. Kunden ohne Rechnungen bleiben löschbar, ihre Offerten werden mitgelöscht.
- Archivieren und Wiederherstellen: Server Actions für Editor. Archivierte Kunden fehlen in den Auswahllisten (neue Rechnung, neue Offerte) und in der Kundenliste. Ein Filter „Archiv“ zeigt sie.
- Der Job für Jahresrechnungen (`lib/yearly-invoices.ts`) überspringt archivierte Kunden.

## Gutschrift

- Aktion `createCreditNote(invoiceId)` (Editor). Vorbedingung: Original ist nicht `Draft`, keine Gutschrift und nicht `Canceled`. Sie legt einen Entwurf an mit den Positionen des Originals, Betrag negiert, `creditNoteForId` gesetzt, und leitet zur Bearbeitung weiter.
- Im Formular stehen die Beträge positiv. Beim Speichern negiert der Server Positionen und Total. Für Gutschriften fehlen Fälligkeit und Zahlungsziel im Formular.
- Nummer: dieselbe Reihe wie bei Rechnungen, vergeben beim Versand (`assignDocumentNumber`).
- Grenze: Die Summe aller Gutschriften einer Rechnung darf den Originalbetrag nicht übersteigen. Geprüft beim Speichern und beim Versand, in Rappen als Integer.
- Eine Gutschrift hat keine Zahlungen, keine Mahnung, keinen Übergang zu `Overdue` und keinen QR-Zahlteil. Zahlungen darauf werden in `createPayment` abgelehnt. Der Cron-Job für `Overdue` und die Mahnliste schliessen sie aus.
- PDF: Titel „Gutschrift zu Rechnung X“, ohne QR-Zahlteil. Versand über `sendDocument`, Status danach `Sent`.
- Das Original bleibt bei versendeter Gutschrift unverändert bearbeitungsgesperrt. Es zeigt eine Liste der zugehörigen Gutschriften. Die Gutschrift verweist auf das Original.

## Wirkung auf das Original

- `computeInvoiceState` und `getPaymentSummary` (`lib/payments.ts`) bekommen `creditedRappen` (Summe der versendeten Gutschriften, als positiver Betrag). Gesetzt ist `settled = paid + credited`.
  - `settled >= total` und `credited > 0` und `paid = 0` → `Canceled`.
  - `settled >= total` sonst → `Paid`.
  - `paid > 0` (und `settled < total`) → `PartiallyPaid`. Eine teilweise gutgeschriebene Rechnung ohne Zahlungen behält `Sent` bzw. `Overdue` und wird damit weiterhin gemahnt (Mahnbetrag und QR-Zahlteil = Restbetrag).
- Nach Versand einer Gutschrift läuft `recalculateInvoiceState` für das Original.
- `sumOpenAmount` und `lib/receivables.ts` nutzen den Restbetrag inklusive Gutschriften. Ist `paid > total − credited`, erscheint der Überschuss wie in F5 als Guthaben. Gutschriften sind keine eigenen Zeilen.
- Alle Stellen mit Rechnungs-Queries werden geprüft, damit negative Beträge keine Summen verfälschen: `analytics-queries.ts`, `dashboard/page.tsx`, `invoices/page.tsx`, `customers/[id]/page.tsx`, `invoices/import/actions.ts`, `lib/search.ts`, `lib/reminders.ts`, `lib/receivables.ts`, `income-statement-queries.ts`, `api/export/invoices/route.ts`. Der Rechnungs-CSV-Export bekommt die Spalte „Gutschrift zu“.

## Audit

Einträge für: Gutschrift erstellen, Gutschrift versenden, Kunde archivieren, Kunde wiederherstellen. Bestehende Einträge für Statuswechsel und Löschen bleiben.

## Tests

- Unit: Übergangstabelle, `computeInvoiceState` und `getPaymentSummary` mit Gutschriften (Teil, voll, mit Zahlung, Überschuss), Gutschriftsobergrenze.
- Integration: Bearbeiten und Löschen einer versendeten Rechnung wird abgelehnt. `deleteCustomer` mit Rechnungen wird abgelehnt. Archivieren blendet aus, der Jahresjob überspringt archivierte Kunden. Gutschrift von Entwurf über Versand bis Restbetrag und Status des Originals, für Teil- und Vollgutschrift. Gutschrift ohne Zahlung, Mahnung und QR-Teil.
- Migration: `Restrict`-Umbau erhält alle Daten.

## Offene Punkte

Keine. Rückzahlungen und Einnahmen bei Gutschrift bleiben bewusst ausserhalb von F3.
