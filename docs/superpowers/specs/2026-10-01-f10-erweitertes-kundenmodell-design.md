# F10 Erweitertes Kundenmodell — Design

Stand: 2026-10-01. Bezug: `FEATURE_ANALYSE.md` F10.

## Ziel

Firmenkunden mit eigener Buchhaltung und individuellen Zahlungsfristen abbilden: Kundennummer, UID, abweichende Rechnungsadresse und -E-Mail, Zahlungsfrist pro Kunde, mehrere Kontakte. Wer das nicht braucht, merkt nichts davon: alle neuen Felder sind optional, ohne Eingabe verhält sich die Software wie bisher.

## Nicht im Umfang

- Kontakte als Versandempfänger oder Mehrfachempfänger. `CustomerContact` ist rein informativ.
- Präfix oder Format für Kundennummern (nur ganze Zahl).
- Pflicht oder Abgleich der UID mit einem Register (nur Formatprüfung).
- Rückwirkende Änderung bestehender Rechnungen und bereits archivierter PDFs.
- Abweichende Adresse für Angebote: Angebote gehen immer an die Kundenadresse und `Customer.email`.

## Datenmodell (keine neue Migration)

`Customer`, alle neuen Felder optional ausser der Kundennummer:

- `customerNumber Int? @unique`: `createCustomer` vergibt automatisch `max + 1` (mindestens 1001), im Formular überschreibbar. Die Spalte ist in der DB nullable, damit Seed-Skripte und Tests, die `prisma.customer.create` direkt aufrufen, weiter funktionieren; ohne Nummer erscheint „Kunden-Nr.“ nirgends. Die Migration nummeriert bestehende Kunden nach `customerId` ab 1001 durch, bevor der eindeutige Index entsteht. Beim Bearbeiten bedeutet ein leeres Feld „Nummer unverändert lassen“.
- `uid String?`: gespeichert normalisiert als `CHE-123.456.789` (ohne MWST/TVA/IVA-Suffix), validiert mit Prüfziffer (Modulo 11).
- `billingName`, `billingStreet`, `billingHouseNumber`, `billingZipCode`, `billingCity`: `String?`; `billingCountry String?`; `billingEmail String?`.
- `paymentTermDays Int?`: `null` = globale Frist (`ApplicationSettings.defaultPaymentTermDays`), sonst 1–365.
- `contacts CustomerContact[]`.

Neues Modell `CustomerContact`: `id`, `customerId` (Relation, `onDelete: Cascade`), `name String`, `role String?`, `email String?`, `phone String?`, `createdAt`. Index auf `customerId`.

Es wird **keine neue Migration angelegt**. Die SQL-Befehle werden an `20261001120000_invoicing_and_banking` angehängt (Projektpraxis, siehe #125; die Migration steckt in keinem Release-Tag). Steckt sie bei Umsetzung doch in einem Release, ist das nicht zulässig und es wird neu entschieden. Lokale DBs, die sie schon angewendet haben, müssen zurückgesetzt werden (`scripts/startup.js` und `migrate deploy` vergleichen nur den Namen).

Die Migration muss zuerst die Spalte ohne `UNIQUE` anlegen, die Kunden nummerieren und erst dann den eindeutigen Index erstellen.

## Verhalten

Neuer Helfer `lib/customer-billing.ts` (rein, ohne Prisma):

- `billingRecipient(customer)`: Rechnungsadresse (Name, Strasse, Hausnummer, PLZ, Ort, Land) wenn `billingStreet`, `billingZipCode` und `billingCity` gesetzt sind, sonst die Kundenadresse. Name: `billingName`, sonst der bisherige Empfängername. Liefert zusätzlich `uid`.
- `billingEmail(customer)`: `billingEmail` wenn gesetzt, sonst `email`.
- `effectivePaymentTermDays(customer, settings)`: `customer.paymentTermDays ?? settings.defaultPaymentTermDays`.

Anwendung:

| Stelle | Änderung |
|---|---|
| `lib/pdf/document-pdf.ts` (Rechnung, Mahnung) | Empfängerblock aus `billingRecipient`, UID darunter wenn gesetzt, „Kunden-Nr.“ im Kopf |
| `lib/pdf/document-pdf.ts` (Angebot) | Kundenadresse wie bisher, „Kunden-Nr.“ im Kopf, keine UID-Zeile |
| `lib/pdf/qrbill-helpers.ts` | Zahlungspflichtiger aus `billingRecipient` |
| `lib/receivables.ts` | Adresse in der OP-Liste aus `billingRecipient` |
| `lib/email.ts` (Rechnung, Mahnung) und `lib/subscriptions.ts` | Empfänger `billingEmail` (ein explizit übergebenes `overrides.to` gewinnt weiterhin) |
| `lib/email.ts` (Angebot) | unverändert, `customer.email` |
| `InvoiceForm` | Fälligkeit wird beim Kundenwechsel mit `effectivePaymentTermDays` vorbelegt, bleibt editierbar |
| `quotes/actions.ts` (Angebot → Rechnung), `lib/subscriptions.ts` | Frist aus `effectivePaymentTermDays` |

Bestehende Rechnungen behalten ihr `dueDate`. Archivierte PDFs werden nie neu gerendert, deshalb ändern spätere Adressänderungen sie nicht.

Kundennummer, UID und Rechnungsadresse sind Pflege-Felder des Kunden: Änderungen laufen über `updateCustomer` und werden wie bisher mit `logAudit(… "UPDATE", "Customer" …)` protokolliert (kein Feld-Diff). Neu ist nur der Audit-Entitätstyp `CustomerContact`.

## Validierung (`customers/actions.ts`, Zod)

- `uid`: leer erlaubt; sonst Muster `CHE-?\d{3}\.?\d{3}\.?\d{3}` (optional gefolgt von `MWST|TVA|IVA`), Prüfziffer Modulo 11, Ablehnung mit deutscher Meldung. Speicherung normalisiert.
- `customerNumber`: ganze Zahl ≥ 1, eindeutig (Fehler „Kundennummer bereits vergeben“, auch bei Race über `P2002`); leer beim Anlegen = automatisch.
- `billingEmail`: gültige E-Mail oder leer.
- Rechnungsadresse: entweder Strasse, PLZ und Ort alle gesetzt oder alle leer (Name, Hausnummer, Land optional). Teilweise Angaben werden abgelehnt.
- `paymentTermDays`: leer oder 1–365.
- Kontakte: `name` Pflicht, `email` gültig oder leer.

## UI

- `CustomerForm`: bisheriges Formular unverändert, darunter ein eingeklappter Abschnitt „Weitere Angaben“ mit Kundennummer, UID, Zahlungsfrist, Rechnungsadresse und Rechnungs-E-Mail. Der Abschnitt ist offen, wenn dort schon etwas gesetzt ist.
- `customers/[id]/page.tsx`: neue Karte „Kontakte“ (Liste, Hinzufügen, Bearbeiten, Löschen) mit Server Actions in `customers/contact-actions.ts` (`requireEditor`), Audit-Einträge `CREATE/UPDATE/DELETE CustomerContact`. Nur Admin/Editor sehen die Bedienelemente (`hasRole`).
- Kundenliste und -suche: Kundennummer als Spalte und durchsuchbar. Detailseite zeigt UID, Rechnungsadresse und Frist, wenn gesetzt.
- Kunden-Export (`app/api/export/customers/route.ts`): neue Spalten Kundennummer, UID, Rechnungsname/-adresse, Rechnungs-E-Mail, Zahlungsfrist; Kontakte als eine Spalte „Weitere Kontakte“ (`Name (Rolle) <E-Mail>`, getrennt durch `; `).

## Fehlerfälle

- Kunde löschen: Kontakte werden per Cascade mitgelöscht; archivierte Kunden behalten alle Felder.
- `billingEmail` gesetzt, aber ungültig gespeichert (Altdaten gibt es nicht): Versand schlägt wie bisher mit dem Mailfehler fehl.
- Gleichzeitiges Anlegen: automatische Nummer wird bei `P2002` einmal neu berechnet und wiederholt.

## Tests

Unit (`tests/unit/`):
- UID: gültige und ungültige Prüfziffer, Normalisierung, Suffix.
- `billingRecipient` / `billingEmail` / `effectivePaymentTermDays` mit und ohne Daten, mit teilweise gefüllter Adresse.

Integration (`tests/integration/`):
- Kundennummer: automatische Vergabe, Eindeutigkeit, Überschreiben, Kollision.
- Migration: bestehende Kunden werden ab 1001 nach ID nummeriert.
- Rechnungs-PDF und QR-Bill mit und ohne Rechnungsadresse; Angebots-PDF bleibt bei Kundenadresse.
- Mailversand: Rechnung/Mahnung an `billingEmail`, Angebot an `email`.
- Fälligkeit bei Angebot → Rechnung und Abo mit Kundenfrist und ohne.
- Kontakte: anlegen, ändern, löschen, Rollenprüfung, Cascade beim Löschen des Kunden.
- Export enthält die neuen Spalten.

## Dokumentation

`CLAUDE.md` (Abschnitt Business document workflow): ein Absatz zu Kundenmodell und `lib/customer-billing.ts`. `FEATURE_ANALYSE.md`: Punkt 12 abhaken.
