# F5: Zahlungen und offene Posten

Stand: 2026-09-30. Herkunft: Roadmap Phase 2, Punkt F5.

## Ziel

Rechnungen können in mehreren Teilzahlungen beglichen werden. Der Status ergibt sich aus der Summe der Zahlungen. Eine Offene-Posten-Liste (Debitoren) zeigt die Forderungen zu einem Stichtag mit Altersstruktur.

## Entscheidungen

- **Umfang:** Teilzahlungen, Restbetrag, OP-Liste per Stichtag. Skonto, Debitorenverlust (Ausbuchung) und Kundenguthaben kommen später als eigene Zahlungsarten.
- **Status:** neuer Wert `PartiallyPaid` im Enum `InvoiceState`. Der Status wird bei jeder Änderung der Zahlungen neu berechnet und in `Invoice.state` gespeichert. Bestehende Filter auf `state` bleiben gültig.
- **Auswertungen:** Einnahmen sind die Summe der `Payment`-Beträge nach `Payment.date` (Geldfluss), nicht `Invoice.totalAmount` nach `paidDate`.
- **Überzahlung:** wird erfasst (z. B. Trinkgeld). Die Rechnung wird `Paid`, die Überzahlung erscheint als Hinweis und in der OP-Liste als Guthaben. Sie zählt voll als Einnahme. Rückzahlung oder Verrechnung erfolgt vorerst von Hand.
- **Mahnwesen:** unverändert an `Overdue` gebunden. `PartiallyPaid` wird nicht automatisch zu `Overdue` und löst keine Mahnung aus. Mahnungen auf den Restbetrag gehören zu F8.

## Schema

- Neues Modell `Payment`: `id`, `invoiceId` (Relation `onDelete: Cascade`), `date`, `amount` (Decimal), `source` (`manual` | `camt-import` | `budget-import` | `migration`), `bankReference String?`, `createdAt`. Indizes auf `invoiceId` und `date`.
- `InvoiceState` bekommt `PartiallyPaid`.
- `Invoice.paidDate` bleibt. Es ist abgeleitet: Datum der letzten Zahlung, sobald `Paid`, sonst `null`.
- Die Migration ist reines SQL (Produktion wendet Migrationen über `scripts/startup.js` ohne Prisma CLI an). Sie legt pro bestehender `Paid`-Rechnung eine Zahlung an: `amount = totalAmount`, `date = paidDate`, bei fehlendem `paidDate` das Rechnungsdatum, `source = migration`.

## Kern: `lib/payments.ts`

- `recordPayment({ invoiceId, amount, date, source, bankReference?, actor })`, `recordRemainingPayment` (Restbetrag, in derselben Transaktion berechnet, damit ein Doppelklick nicht zweimal bucht) und `deletePayment`. Jede Funktion schreibt einen Audit-Eintrag und ruft `recalculateInvoiceState` auf. Zahlungen werden nicht bearbeitet, sondern gelöscht und neu erfasst.
- `syncInvoiceState` berechnet den Status nach einer Änderung des Rechnungsbetrags neu (`updateInvoice`).
- `recalculateInvoiceState(invoiceId)` mit Summe S aller Zahlungen und Rechnungsbetrag T (beide in Rappen als Integer):
  - `S >= T` → `Paid`, `paidDate` = Datum der letzten Zahlung
  - `0 < S < T` → `PartiallyPaid`, `paidDate = null`
  - `S = 0` und Status war `Paid` oder `PartiallyPaid` → `Sent`, bzw. `Overdue`, wenn `dueDate` überschritten ist
  - `Draft` und `Canceled` werden nicht verändert. Zahlungen auf diese Status werden abgelehnt.
- Bei `Paid` wird ein vorhandener `PendingReminder` gelöscht (Verhalten wie heute in `markInvoicePaid`).
- Validierung: `amount > 0`, gültiges Datum.

## Bestehende Stellen

- `markInvoicePaid` in `lib/payment-matching.ts` wird durch `recordPayment` ersetzt. `matchAndMarkPaid` bucht nur bei exakt passendem Restbetrag. Der CAMT-Import (`markInvoicesPaidFromImport`) bucht den Betrag der Bankbewegung, nicht den Restbetrag, denn die Vorschau bietet auch Referenztreffer mit abweichendem Betrag an. Er akzeptiert zusätzlich `PartiallyPaid` als Ausgangsstatus, vergleicht in der Vorschau mit dem Restbetrag und überspringt eine Bewegung, deren `bankReference` auf der Rechnung schon als Zahlung existiert.
- Rechnungen mit Zahlungen lassen sich nicht löschen (sonst verschwänden Einnahmen ohne Payment-Audit). Zuerst die Zahlungen löschen.
- `updateInvoiceStatus`: Die Auswahl `Paid` bleibt und erfasst eine Zahlung über den Restbetrag mit Datum heute (wie der Button „Als bezahlt markieren“ unten). `PartiallyPaid` ist kein manuelles Ziel. Der Wechsel auf `Sent`, `Overdue` und `Canceled` bleibt, ausser weg von `Paid` oder `PartiallyPaid`: Das geht nur über das Löschen der Zahlungen, damit keine Zahlungen ohne passenden Status stehen bleiben.
- `PaidDateField` und `updateInvoicePaidDate` entfallen. Die Rechnungsseite zeigt stattdessen einen Zahlungsblock mit Bezahlt, Restbetrag (bzw. Überzahlung), Liste der Zahlungen (Datum, Betrag, Quelle, Löschen) einen Button „Als bezahlt markieren“ (Restbetrag, Datum heute, bei Status `Sent`, `Overdue` und `PartiallyPaid`) und ein Formular „Zahlung erfassen“ (Betrag mit Restbetrag vorbelegt, Datum heute). Bei Überzahlung warnt das Formular vor dem Speichern und verlangt eine Bestätigung. Nur ab Rolle Editor.
- Queries in `income-statement-queries.ts`, `analytics-queries.ts`, `dashboard/page.tsx` und `app/api/export/accounting/route.ts` summieren `Payment.amount` nach `Payment.date`. Der Export liefert eine Zeile pro Zahlung. Kundenbezogene Analytics laufen über `Payment` → `Invoice` → `Customer`. Kategorie-Auswertung und Kategorie-Drilldown bleiben rechnungsbasiert (vollständig bezahlte Rechnungen nach `paidDate`), weil Zahlungen keine Kategorie haben. Bei Teilzahlungen über Jahresgrenzen können Summen und Kategorien deshalb abweichen.
- Audit-Aktionen für Zahlungen sind `CREATE`, `UPDATE` und `DELETE` mit Entität `Payment`, dazu `STATUS` auf der Rechnung bei Statuswechsel.

## Offene-Posten-Liste

- Seite `app/(app)/accounting/receivables/` mit Stichtag (Standard heute, Schnellwahl 31.12.).
- Berechnung in `lib/receivables.ts`: Rechnungen mit Rechnungsdatum ≤ Stichtag, Status ausser `Draft` und `Canceled`, Rest zum Stichtag ≠ 0, wobei nur Zahlungen mit Datum ≤ Stichtag zählen. Ein positiver Rest ist ein offener Posten, ein negativer Rest ist Guthaben (eigene Spalte, nicht verrechnet).
- Altersstruktur nach Tagen seit Fälligkeit: nicht fällig, 0–30, 31–60, 61–90, >90. Summen pro Altersklasse, pro Kunde und gesamt.
- CSV-Export der Liste. Zugriff ab Rolle Editor.
- Einschränkung: Der Filter nutzt den heutigen Status. Eine Rechnung, die zum Stichtag offen war und später storniert wurde, fehlt in der historischen Liste, weil das Stornodatum nicht gespeichert wird.

## Tests

- Unit: `recalculateInvoiceState` (alle Übergänge, Überzahlung, Rundung), `lib/receivables.ts` (Stichtag, Altersklassen, Guthaben).
- Integration: `recordPayment`, `recordRemainingPayment` (auch parallel), `deletePayment`, `syncInvoiceState` gegen die Test-DB, die Migration (Paid → eine Zahlung), die umgestellten Queries, CAMT-Import mit Teilzahlung.

## Ausser Umfang

Skonto, Debitorenverlust, Kundenguthaben und automatische Verrechnung, Gutschrift (F3), gespeicherte Bankbewegungen mit Duplikatschutz (F7), Mahnung auf Restbetrag (F8).
