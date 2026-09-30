# F11 Flexible Abos – Design

Ersetzt die leere Jahresrechnung (`Customer.yearlyInvoice` / `nextInvoiceDate`) durch mehrere Abos pro Kunde mit Intervall und Vorlage. Die erzeugte Rechnung enthält Positionen statt CHF 0 (Z7).

## Ziele
- Mehrere Abos pro Kunde (monatlich, quartalsweise, jährlich), je mit `InvoiceTemplate`.
- Rechnung wird mit Positionen und korrekter Summe als Entwurf erzeugt.
- Optional automatischer Versand pro Abo.
- Bestehende Jahreskunden werden migriert.

## Nicht enthalten
Laufzeit-Ende/Kündigungsdatum, Preisindexierung, pro-rata-Rechnungen, Abo-Verlauf.

## Datenmodell
Neues Modell `Subscription`:
- `id`, `customerId` (`onDelete: Cascade`), `templateId?` (`InvoiceTemplate`, `onDelete: SetNull`)
- `interval` (`Monthly | Quarterly | Yearly`), `nextInvoiceDate`, `autoSend` (Standard `false`), `active` (Standard `true`)
- Indizes: `nextInvoiceDate`, `customerId`.

`Customer.yearlyInvoice` und `Customer.nextInvoiceDate` (samt Index) entfallen.

**Migration** (SQL, läuft auch über `scripts/startup.js`): pro Kunde mit `yearlyInvoice = true` und gesetztem `nextInvoiceDate` ein `Yearly`-Abo ohne Vorlage, `autoSend = false`, `active = true`, mit dem bisherigen Datum. Danach werden die Spalten entfernt.

## Job `checkSubscriptions`
Ersetzt `checkYearlyInvoices` (`lib/yearly-invoices.ts` → `lib/subscriptions.ts`, gleicher Hook in `lib/notifications.ts` und `settings/actions.ts`).

- Auswahl: `active`, `nextInvoiceDate <= heute`, Kunde nicht archiviert.
- Pro Abo eine Transaktion: Rechnung (`Draft`) mit Positionen aus der Vorlage, Summe wie bei manuell erstellten Rechnungen; `PendingEmail` mit echtem Betrag; `nextInvoiceDate` vorrücken.
- Vorrücken ab dem bisherigen Datum um 1/3/12 Monate, Monatsende wird geklemmt (31.1. → 28.2.). Liegt das Ergebnis noch in der Vergangenheit, wird aufgeholt. Es entsteht pro Lauf **eine** Rechnung.
- `autoSend`: nach der Transaktion derselbe Pfad wie beim Freigeben (Nummer vergeben, `renderArchiveAndSend`). Bei Fehler bleiben Entwurf und `PendingEmail` bestehen, Admins werden benachrichtigt; kein doppelter Versand.
- Ohne Vorlage: leerer Entwurf wie bisher, nie Auto-Versand.
- `logAudit` ausserhalb der Transaktion.

## UI
- Kundenseite: Sektion «Abos» (Liste mit Vorlage, Intervall, nächstem Datum, Auto-Versand, Badge «Vorlage fehlt»; Dialoge zum Anlegen/Bearbeiten, Pausieren/Fortsetzen, Löschen).
- `customers/subscription-actions.ts`: `requireEditor()`, Validierung (Intervall, Datum, Vorlage existiert; `autoSend` nur mit Vorlage), Audit.
- Kundenformular und `customers/actions.ts` verlieren die Jahresfelder.
- Dashboard: geplante Abos (Kunde, Intervall, Datum).
- Kundenfilter «Geplante Abos» (`?subscription=true`, `subscriptions: { some: { active: true } }`).
- Kunden-Export: Spalte «Abos» statt «Jahresrechnung».
- Seeds (`prisma/seed.ts`, `scripts/seed-manual-demo.ts`), Benutzerhandbuch, CLAUDE.md und `FEATURE_ANALYSE.md` (F11 abhaken) werden angepasst.

## Tests (TDD)
- Unit: Datumsberechnung (Monatsende, Schaltjahr, Aufholen).
- Integration Job: Vorlage → Positionen/Summe; ohne Vorlage → leerer Entwurf; archivierter Kunde und pausiertes Abo übersprungen; kein Doppellauf; `autoSend` versendet und archiviert; Fehlschlag lässt Entwurf und `PendingEmail` stehen.
- Migration: Altkunde → Yearly-Abo ohne Vorlage.
- Bestehende Tests (`yearly-invoices`, `customer-actions`, `notifications`, `settings-actions`, Export) werden angepasst.
