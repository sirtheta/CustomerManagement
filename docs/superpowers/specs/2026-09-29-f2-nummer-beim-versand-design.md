# F2: Dokumentnummer erst beim Versand

Stand: 2026-09-29. Herkunft: Roadmap Phase 1, Punkt F2.

## Ziel

Rechnungen und Offerten haben als Entwurf keine Nummer. Die Nummer wird beim ersten Versand vergeben und ändert sich danach nicht mehr. Damit entstehen keine Lücken mehr durch gelöschte oder verworfene Entwürfe.

## Entscheidungen

- **PDF-Download eines Entwurfs:** nur Vorschau mit Wasserzeichen „ENTWURF“, ohne Nummer und ohne Seiteneffekt im GET. Es gibt keine Aktion „Nummer vergeben und PDF erzeugen“.
- **Bestehende Entwürfe:** behalten ihre Nummer. Keine Datenmigration.
- **Vergabezeitpunkt:** vor der PDF- und Mailerzeugung, weil beides die Nummer enthält. Schlägt der Mailversand fehl, bleibt die Nummer vergeben und wird beim nächsten Versuch wiederverwendet.

## Schema

`documentNumber String?` bei `Invoice` und `Quote`. `@unique` bleibt (SQLite erlaubt mehrere `NULL`). Die Migration ist eine reine Strukturänderung, bestehende Zeilen bleiben unverändert.

## Kern: `assignDocumentNumber`

In `lib/document-number.ts`: `assignDocumentNumber(kind, id, { actor?, client? })` (eigene Transaktion, ein Retry bei Kollision).

- Idempotent: hat das Dokument schon eine Nummer, wird sie unverändert zurückgegeben.
- Berechnung und Setzen laufen in derselben Transaktion. Bei einer Kollision (`isDocumentNumberCollision`) gibt es einen Retry wie heute in `createDocumentWithItems`.
- JJMM stammt vom Vergabedatum.
- `generateInvoiceNumber` und `generateQuoteNumber` müssen `null`-Nummern bei der Maximumsuche überspringen.

## Vergabestellen

| Stelle | Verhalten |
|---|---|
| `sendDocument` (Rechnung und Offerte) | Nummer vergeben, danach PDF und Mail |
| `approvePendingEmail` | Nummer vergeben vor PDF, Platzhalter im Betreff und Text ersetzen |
| Statuswechsel Draft → Sent (manuell) | Nummer vergeben |
| `sendReminder` | Rechnung hat bereits eine Nummer |
| `createDocumentWithItems` | keine Nummer mehr |
| `convertQuoteToInvoice` | neue Rechnung als Entwurf ohne Nummer |
| `lib/yearly-invoices.ts` | Entwurf ohne Nummer. Betreff und Text der Pending-Mail speichern `{documentNumber}` roh und werden beim Versand ersetzt |

## Anzeige und Konsumenten

- Listen, Detailseiten, Suche, Dashboard, Kundenseite und Exporte zeigen „Entwurf“, wenn die Nummer `null` ist. Die Suche ignoriert `null`.
- PDF-Routen für Entwürfe ohne Nummer: Vorschau mit Wasserzeichen „ENTWURF“, Dateiname `entwurf-<id>.pdf`.
- Audit-Log: `entityRef` ist bei Entwürfen `null`. Die Vergabe wird als `UPDATE` mit `{ documentNumber }` protokolliert.
- PDF-Cache-Key enthält die Nummer (`n<Nummer>` bzw. `ndraft`).
- Entwürfe ohne Nummer erhalten keinen QR-Zahlteil.
- Bankimport (`lib/import/matching.ts`, `lib/payment-matching.ts`): offene Rechnungen haben immer eine Nummer. Zeilen mit `null` werden defensiv übersprungen.

## Nicht enthalten

Festschreiben und Gutschrift (F3), Belegarchiv (F4), Nummernkreise pro Jahr.

## Tests

- Unit: `assignDocumentNumber` (idempotent, Kollisions-Retry, Monatswechsel, `null`-Zeilen beim Maximum), Anzeigehilfe „Entwurf“.
- Integration: Versand vergibt die Nummer vor der PDF-Erzeugung, fehlgeschlagener Mailversand behält die Nummer, Pending-Mail ersetzt Platzhalter, Statuswechsel vergibt die Nummer, Löschen eines Entwurfs hinterlässt keine Lücke.
